import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { generateText, NoOutputGeneratedError } from "ai";
import { z } from "zod";
import {
  AI_AGENT_ID_REGEX,
  BOOK_ID_REGEX,
  CHAPTER_BATCH_DEFAULT_OVERWRITE,
  CHAPTER_BATCH_MAX_CHAPTER,
  CHAPTER_BATCH_MAX_COUNT,
  CHAPTER_BATCH_MIN_CHAPTER,
  CURRENT_CHAPTER_OUTLINE_FILE,
  NOVEL_SPEC_FILE,
  PLOT_FILE,
  STYLE_SAMPLE_FILE,
  STORY_STATUS_FILE,
  chapterDraftPath,
  type AiAgentConfig,
  type ChapterBatchChapterSnapshot,
  type ChapterBatchRunEvent,
  type ChapterBatchRunSnapshot,
  type ChapterBatchRunStatus,
  type ChapterBatchStepStatus,
  type KnowledgeBaseItemDoc,
  type StartChapterBatchRunRequest,
} from "@novelloom/shared";
import {
  ConflictError,
  InvalidIdError,
  NotFoundError,
  archiveCurrentChapterOutline,
  listProjectFiles,
  readAiAgentById,
  readAllKnowledgeBaseDocs,
  readProjectFile,
  upsertProjectFile,
} from "../books/storage.js";
import { env } from "../env.js";
import {
  assertModelConfigured,
  currentModelLabel,
  llmProvider,
} from "../ai/modelClient.js";

const OUTLINE_INDEX_FILE = "outline/index.md";
const CHAPTER_BATCH_RUN_MAX_COUNT = 50;
const KNOWLEDGE_CONTEXT_MAX_LEN = 80_000;

const IdSchema = z.string().regex(BOOK_ID_REGEX);
const AgentIdSchema = z.string().regex(AI_AGENT_ID_REGEX);
const BookIdParams = z.object({ bookId: IdSchema });
const RunParams = z.object({
  bookId: IdSchema,
  runId: z.string().trim().min(1).max(128),
});
const StartChapterBatchRunBody = z.object({
  fromChapter: z
    .number()
    .int()
    .min(CHAPTER_BATCH_MIN_CHAPTER)
    .max(CHAPTER_BATCH_MAX_CHAPTER),
  toChapter: z
    .number()
    .int()
    .min(CHAPTER_BATCH_MIN_CHAPTER)
    .max(CHAPTER_BATCH_MAX_CHAPTER),
  overwrite: z.boolean().optional().default(CHAPTER_BATCH_DEFAULT_OVERWRITE),
  agentId: AgentIdSchema.optional(),
});

interface ChapterBatchRunInternal {
  runId: string;
  bookId: string;
  status: ChapterBatchRunStatus;
  fromChapter: number;
  toChapter: number;
  overwrite: boolean;
  currentChapter: number | null;
  chapters: ChapterBatchChapterSnapshot[];
  events: ChapterBatchRunEvent[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  abortController: AbortController;
  agent: AiAgentConfig | null;
}

interface ChapterGenerationContext {
  idea: string;
  novelSpec: string;
  styleSample: string;
  plot: string;
  storyStatus: string;
  outlineIndex: string;
  recentChapters: Array<{ path: string; content: string }>;
  knowledgeBase: string;
  agent: AiAgentConfig | null;
}

const chapterBatchRuns = new Map<string, ChapterBatchRunInternal>();

function jsonError(
  reply: FastifyReply,
  status: number,
  message: string,
  details?: unknown,
) {
  reply.code(status);
  return { error: message, ...(details !== undefined ? { details } : {}) };
}

function errorMessage(err: unknown): string {
  if (NoOutputGeneratedError.isInstance(err)) {
    return "模型没有产生可用输出，请检查模型服务、API key、模型名称或上下文长度。";
  }
  return err instanceof Error ? err.message : String(err);
}

function nowIso(): string {
  return new Date().toISOString();
}

function snapshotRun(run: ChapterBatchRunInternal): ChapterBatchRunSnapshot {
  return {
    runId: run.runId,
    bookId: run.bookId,
    status: run.status,
    fromChapter: run.fromChapter,
    toChapter: run.toChapter,
    overwrite: run.overwrite,
    currentChapter: run.currentChapter,
    chapters: run.chapters,
    events: run.events,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function emitRunEvent(
  run: ChapterBatchRunInternal,
  event: Omit<ChapterBatchRunEvent, "id" | "createdAt">,
): void {
  const createdAt = nowIso();
  run.events.push({
    id: `event-${crypto.randomUUID()}`,
    createdAt,
    ...event,
  });
  run.updatedAt = createdAt;
}

function updateChapterStatus(
  run: ChapterBatchRunInternal,
  chapterNumber: number,
  status: ChapterBatchStepStatus,
  patch: Partial<
    Pick<ChapterBatchChapterSnapshot, "archivedOutlinePath" | "error">
  > = {},
): void {
  const updatedAt = nowIso();
  run.chapters = run.chapters.map((chapter) =>
    chapter.chapterNumber === chapterNumber
      ? { ...chapter, status, updatedAt, ...patch }
      : chapter,
  );
  run.updatedAt = updatedAt;
}

function finishRun(
  run: ChapterBatchRunInternal,
  status: ChapterBatchRunStatus,
  error?: string,
): void {
  const updatedAt = nowIso();
  run.status = status;
  run.updatedAt = updatedAt;
  run.finishedAt = updatedAt;
  run.currentChapter = null;
  if (error) run.error = error;
}

function pruneChapterBatchRuns(): void {
  if (chapterBatchRuns.size <= CHAPTER_BATCH_RUN_MAX_COUNT) return;
  const terminalRuns = [...chapterBatchRuns.values()]
    .filter((run) => run.status !== "running")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const run of terminalRuns) {
    if (chapterBatchRuns.size <= CHAPTER_BATCH_RUN_MAX_COUNT) return;
    chapterBatchRuns.delete(run.runId);
  }
}

function assertNotCancelled(run: ChapterBatchRunInternal): void {
  if (run.abortController.signal.aborted) {
    throw new DOMException("Chapter batch run cancelled", "AbortError");
  }
}

async function readProjectFileOrEmpty(
  bookId: string,
  path: string,
): Promise<string> {
  try {
    return (await readProjectFile(bookId, path)).content;
  } catch (err) {
    if (err instanceof NotFoundError) return "";
    throw err;
  }
}

async function readRecentChapters(
  bookId: string,
  chapterNumber: number,
): Promise<Array<{ path: string; content: string }>> {
  const chapters: Array<{ path: string; content: string }> = [];
  for (const previous of [chapterNumber - 2, chapterNumber - 1]) {
    if (previous < CHAPTER_BATCH_MIN_CHAPTER) continue;
    const path = chapterDraftPath(previous);
    const content = await readProjectFileOrEmpty(bookId, path);
    if (content.trim()) chapters.push({ path, content });
  }
  return chapters;
}

function renderKnowledgeBase(docs: KnowledgeBaseItemDoc[]): string {
  const rendered = docs
    .map((doc) => `--- ${doc.path} (${doc.title}) ---\n${doc.content}`)
    .join("\n\n");
  if (rendered.length <= KNOWLEDGE_CONTEXT_MAX_LEN) return rendered;
  return `${rendered.slice(0, KNOWLEDGE_CONTEXT_MAX_LEN)}\n\n[资料库内容过长，后续内容已截断。]`;
}

async function buildGenerationContext(
  run: ChapterBatchRunInternal,
  chapterNumber: number,
): Promise<ChapterGenerationContext> {
  await listProjectFiles(run.bookId);
  const [idea, novelSpec, styleSample, plot, storyStatus, outlineIndex, recentChapters, docs] =
    await Promise.all([
      readProjectFileOrEmpty(run.bookId, "idea.md"),
      readProjectFileOrEmpty(run.bookId, NOVEL_SPEC_FILE),
      readProjectFileOrEmpty(run.bookId, STYLE_SAMPLE_FILE),
      readProjectFileOrEmpty(run.bookId, PLOT_FILE),
      readProjectFileOrEmpty(run.bookId, STORY_STATUS_FILE),
      readProjectFileOrEmpty(run.bookId, OUTLINE_INDEX_FILE),
      readRecentChapters(run.bookId, chapterNumber),
      readAllKnowledgeBaseDocs(run.bookId),
    ]);
  return {
    idea,
    novelSpec,
    styleSample,
    plot,
    storyStatus,
    outlineIndex,
    recentChapters,
    knowledgeBase: renderKnowledgeBase(docs),
    agent: run.agent,
  };
}

function renderAgentContext(agent: AiAgentConfig | null): string {
  if (!agent) return "当前未启用自定义 Agent。";
  return [
    "当前启用 Agent：",
    `名称：${agent.name}`,
    `描述：${agent.description || "无"}`,
    "角色提示词：",
    agent.systemPrompt,
  ].join("\n");
}

function renderBaseContext(ctx: ChapterGenerationContext): string {
  const recent = ctx.recentChapters.length
    ? ctx.recentChapters
        .map((chapter) => `--- ${chapter.path} ---\n${chapter.content}`)
        .join("\n\n")
    : "暂无可读取的最近章节正文。";
  return [
    "【用户思路 idea.md】",
    ctx.idea || "暂无内容。",
    "",
    `【创作规格 ${NOVEL_SPEC_FILE}】`,
    ctx.novelSpec || "暂无内容。",
    "",
    `【写作风格示例 ${STYLE_SAMPLE_FILE}】`,
    ctx.styleSample || "暂无内容。",
    "",
    `【剧情规划 ${PLOT_FILE}】`,
    ctx.plot || "暂无内容。",
    "",
    `【创作状态 ${STORY_STATUS_FILE}】`,
    ctx.storyStatus || "暂无内容。",
    "",
    `【大纲索引 ${OUTLINE_INDEX_FILE}】`,
    ctx.outlineIndex || "暂无内容。",
    "",
    "【最近章节正文】",
    recent,
    "",
    "【资料库】",
    ctx.knowledgeBase || "资料库暂无内容。",
    "",
    "【Agent】",
    renderAgentContext(ctx.agent),
  ].join("\n");
}

async function generateMarkdown({
  system,
  prompt,
  signal,
}: {
  system: string;
  prompt: string;
  signal: AbortSignal;
}): Promise<string> {
  const result = await generateText({
    model: llmProvider(env.MODEL),
    system,
    prompt,
    abortSignal: signal,
  });
  const text = result.text.trim();
  if (!text) {
    throw new Error("模型返回了空内容");
  }
  return text;
}

async function generateChapterOutline(
  run: ChapterBatchRunInternal,
  chapterNumber: number,
  ctx: ChapterGenerationContext,
): Promise<string> {
  const draftPath = chapterDraftPath(chapterNumber);
  return await generateMarkdown({
    signal: run.abortController.signal,
    system: [
      "你是 NovelLoom 的章节细纲生成器。",
      "只输出当前章节细纲 Markdown，不输出解释说明、不输出文件名、不执行循环。",
      "章节范围、路径、覆盖和下一章推进全部由代码控制。",
    ].join("\n"),
    prompt: [
      renderBaseContext(ctx),
      "",
      `请生成第 ${chapterNumber} 章细纲。`,
      `对应正文文件由系统固定为 ${draftPath}。`,
      `细纲必须写入 ${CURRENT_CHAPTER_OUTLINE_FILE} 的完整 Markdown 内容。`,
      "要求包含：目标章节、对应正文文件、本章功能、场景节拍、人物变化、伏笔/回收、与前后文衔接。",
    ].join("\n"),
  });
}

async function generateChapterDraft({
  run,
  chapterNumber,
  ctx,
  outline,
}: {
  run: ChapterBatchRunInternal;
  chapterNumber: number;
  ctx: ChapterGenerationContext;
  outline: string;
}): Promise<string> {
  const draftPath = chapterDraftPath(chapterNumber);
  return await generateMarkdown({
    signal: run.abortController.signal,
    system: [
      "你是 NovelLoom 的章节正文生成器。",
      "只输出当前章节正文 Markdown，不输出解释说明、不决定路径、不执行循环。",
      "必须遵守创作规格、剧情规划、已写事实和用户最新上下文。",
    ].join("\n"),
    prompt: [
      renderBaseContext(ctx),
      "",
      `【第 ${chapterNumber} 章细纲】`,
      outline,
      "",
      `请根据细纲生成第 ${chapterNumber} 章正文。`,
      `正文文件路径由系统固定为 ${draftPath}。`,
      `如 ${NOVEL_SPEC_FILE} 未明确单章字数，生成完整但不过度膨胀的一章。`,
    ].join("\n"),
  });
}

async function generateStoryStatusUpdate({
  run,
  chapterNumber,
  ctx,
  outline,
  draft,
  archivedOutlinePath,
}: {
  run: ChapterBatchRunInternal;
  chapterNumber: number;
  ctx: ChapterGenerationContext;
  outline: string;
  draft: string;
  archivedOutlinePath: string;
}): Promise<string> {
  const draftPath = chapterDraftPath(chapterNumber);
  return await generateMarkdown({
    signal: run.abortController.signal,
    system: [
      "你是 NovelLoom 的创作状态整理器。",
      `只输出完整的 ${STORY_STATUS_FILE} Markdown，不输出解释说明。`,
      `不要写长期剧情规划；长期规划仍属于 ${PLOT_FILE}。`,
    ].join("\n"),
    prompt: [
      `【旧 ${STORY_STATUS_FILE}】`,
      ctx.storyStatus || "暂无内容。",
      "",
      `【第 ${chapterNumber} 章细纲】`,
      outline,
      "",
      `【第 ${chapterNumber} 章正文 ${draftPath}】`,
      draft,
      "",
      `细纲已归档到：${archivedOutlinePath}`,
      "",
      "请更新当前进度、最近上下文、下一步、待确认和需要延续事项。",
    ].join("\n"),
  });
}

async function ensureCanWriteDraft(
  run: ChapterBatchRunInternal,
  chapterNumber: number,
): Promise<void> {
  if (run.overwrite) return;
  const path = chapterDraftPath(chapterNumber);
  try {
    await readProjectFile(run.bookId, path);
  } catch (err) {
    if (err instanceof NotFoundError) return;
    throw err;
  }
  throw new ConflictError(`Project path already exists: ${path}`);
}

async function executeChapterBatchRun(run: ChapterBatchRunInternal): Promise<void> {
  try {
    assertModelConfigured();
    emitRunEvent(run, {
      title: "开始批量生成",
      detail: `使用 ${currentModelLabel()}，按章节串行生成第 ${run.fromChapter} 到第 ${run.toChapter} 章。`,
    });
    for (
      let chapterNumber = run.fromChapter;
      chapterNumber <= run.toChapter;
      chapterNumber += 1
    ) {
      assertNotCancelled(run);
      run.currentChapter = chapterNumber;
      await ensureCanWriteDraft(run, chapterNumber);

      updateChapterStatus(run, chapterNumber, "outline_running");
      emitRunEvent(run, {
        chapterNumber,
        title: "生成章节细纲",
        detail: `正在生成第 ${chapterNumber} 章细纲，并将写入 ${CURRENT_CHAPTER_OUTLINE_FILE}。`,
      });
      const context = await buildGenerationContext(run, chapterNumber);
      const outline = await generateChapterOutline(run, chapterNumber, context);
      await upsertProjectFile(run.bookId, CURRENT_CHAPTER_OUTLINE_FILE, outline);
      updateChapterStatus(run, chapterNumber, "outline_completed");

      assertNotCancelled(run);
      updateChapterStatus(run, chapterNumber, "draft_running");
      const draftPath = chapterDraftPath(chapterNumber);
      emitRunEvent(run, {
        chapterNumber,
        title: "生成章节正文",
        detail: `正在根据第 ${chapterNumber} 章细纲生成正文，并将写入 ${draftPath}。`,
      });
      const draft = await generateChapterDraft({
        run,
        chapterNumber,
        ctx: context,
        outline,
      });
      await upsertProjectFile(run.bookId, draftPath, draft);
      updateChapterStatus(run, chapterNumber, "draft_completed");

      assertNotCancelled(run);
      const archive = await archiveCurrentChapterOutline(run.bookId);
      updateChapterStatus(run, chapterNumber, "outline_archived", {
        archivedOutlinePath: archive.archivedPath,
      });
      emitRunEvent(run, {
        chapterNumber,
        title: "归档章节细纲",
        detail: `已将第 ${chapterNumber} 章细纲归档到 ${archive.archivedPath}。`,
      });

      assertNotCancelled(run);
      const latestStatusContext = {
        ...context,
        storyStatus: await readProjectFileOrEmpty(run.bookId, STORY_STATUS_FILE),
      };
      const nextStatus = await generateStoryStatusUpdate({
        run,
        chapterNumber,
        ctx: latestStatusContext,
        outline,
        draft,
        archivedOutlinePath: archive.archivedPath,
      });
      await upsertProjectFile(run.bookId, STORY_STATUS_FILE, nextStatus);
      updateChapterStatus(run, chapterNumber, "state_updated", {
        archivedOutlinePath: archive.archivedPath,
      });
      updateChapterStatus(run, chapterNumber, "completed", {
        archivedOutlinePath: archive.archivedPath,
      });
      emitRunEvent(run, {
        chapterNumber,
        title: "章节完成",
        detail: `第 ${chapterNumber} 章已完成：正文 ${draftPath}，细纲 ${archive.archivedPath}。`,
      });
    }
    finishRun(run, "completed");
    emitRunEvent(run, {
      title: "批量生成完成",
      detail: `已完成第 ${run.fromChapter} 到第 ${run.toChapter} 章。`,
    });
  } catch (err) {
    if (run.abortController.signal.aborted) {
      if (run.currentChapter !== null) {
        updateChapterStatus(run, run.currentChapter, "cancelled");
      }
      finishRun(run, "cancelled");
      emitRunEvent(run, {
        title: "批量生成已取消",
        detail: "已停止后续章节生成，已经写入的文件不会回滚。",
      });
      return;
    }
    const message = errorMessage(err);
    if (run.currentChapter !== null) {
      updateChapterStatus(run, run.currentChapter, "failed", { error: message });
    }
    finishRun(run, "failed", message);
    emitRunEvent(run, {
      title: "批量生成失败",
      detail: message,
    });
  } finally {
    pruneChapterBatchRuns();
  }
}

function buildChapterSnapshots(
  fromChapter: number,
  toChapter: number,
): ChapterBatchChapterSnapshot[] {
  const updatedAt = nowIso();
  const chapters: ChapterBatchChapterSnapshot[] = [];
  for (
    let chapterNumber = fromChapter;
    chapterNumber <= toChapter;
    chapterNumber += 1
  ) {
    chapters.push({
      chapterNumber,
      status: "pending",
      outlinePath: CURRENT_CHAPTER_OUTLINE_FILE,
      draftPath: chapterDraftPath(chapterNumber),
      updatedAt,
    });
  }
  return chapters;
}

export async function chapterBatchRunRoutes(app: FastifyInstance) {
  app.post("/api/books/:bookId/chapter-batch-runs", async (req, reply) => {
    const params = BookIdParams.safeParse(req.params);
    if (!params.success) {
      return jsonError(reply, 400, "Invalid input", params.error.flatten());
    }
    const body = StartChapterBatchRunBody.safeParse(req.body);
    if (!body.success) {
      return jsonError(reply, 400, "Invalid input", body.error.flatten());
    }
    if (body.data.toChapter < body.data.fromChapter) {
      return jsonError(reply, 400, "Invalid input", "结束章节不能小于起始章节");
    }
    if (body.data.toChapter - body.data.fromChapter + 1 > CHAPTER_BATCH_MAX_COUNT) {
      return jsonError(
        reply,
        400,
        "Invalid input",
        `单次最多生成 ${CHAPTER_BATCH_MAX_COUNT} 章`,
      );
    }

    let agent: AiAgentConfig | null = null;
    try {
      await listProjectFiles(params.data.bookId);
      agent = await readAiAgentById(body.data.agentId ?? null);
      if (body.data.agentId && !agent) {
        throw new InvalidIdError("AI agent is disabled or does not exist");
      }
    } catch (err) {
      if (err instanceof InvalidIdError || err instanceof z.ZodError) {
        return jsonError(reply, 400, "Invalid input", errorMessage(err));
      }
      if (err instanceof NotFoundError) {
        return jsonError(reply, 404, "Not found");
      }
      app.log.error(err);
      return jsonError(reply, 500, "Internal error");
    }

    const requestBody: StartChapterBatchRunRequest = body.data;
    const createdAt = nowIso();
    const run: ChapterBatchRunInternal = {
      runId: `chapter-batch-${crypto.randomUUID()}`,
      bookId: params.data.bookId,
      status: "running",
      fromChapter: requestBody.fromChapter,
      toChapter: requestBody.toChapter,
      overwrite: requestBody.overwrite ?? CHAPTER_BATCH_DEFAULT_OVERWRITE,
      currentChapter: null,
      chapters: buildChapterSnapshots(
        requestBody.fromChapter,
        requestBody.toChapter,
      ),
      events: [],
      createdAt,
      updatedAt: createdAt,
      abortController: new AbortController(),
      agent,
    };
    chapterBatchRuns.set(run.runId, run);
    pruneChapterBatchRuns();
    void executeChapterBatchRun(run).catch((err) => {
      app.log.error({ err, runId: run.runId }, "chapter batch run failed");
    });
    return snapshotRun(run);
  });

  app.get("/api/books/:bookId/chapter-batch-runs/:runId", async (req, reply) => {
    const params = RunParams.safeParse(req.params);
    if (!params.success) {
      return jsonError(reply, 400, "Invalid input", params.error.flatten());
    }
    const run = chapterBatchRuns.get(params.data.runId);
    if (!run || run.bookId !== params.data.bookId) {
      return jsonError(reply, 404, "Not found");
    }
    return snapshotRun(run);
  });

  app.post(
    "/api/books/:bookId/chapter-batch-runs/:runId/cancel",
    async (req, reply) => {
      const params = RunParams.safeParse(req.params);
      if (!params.success) {
        return jsonError(reply, 400, "Invalid input", params.error.flatten());
      }
      const run = chapterBatchRuns.get(params.data.runId);
      if (!run || run.bookId !== params.data.bookId) {
        return jsonError(reply, 404, "Not found");
      }
      if (run.status === "running") {
        run.abortController.abort();
        emitRunEvent(run, {
          title: "请求取消",
          detail: "已收到取消请求，当前模型调用结束后会停止后续步骤。",
        });
      }
      return snapshotRun(run);
    },
  );
}
