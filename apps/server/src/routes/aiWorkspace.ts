import crypto from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import {
  convertToModelMessages,
  jsonSchema,
  NoOutputGeneratedError,
  smoothStream,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  AI_AGENT_ID_REGEX,
  AI_CONTEXT_PRIORITY_PROMPT_GUIDE,
  BOOK_ID_REGEX,
  type AiDraftChangeSet,
  type AiDraftFileChange,
  type AiDraftFileChangeStatus,
  MARKDOWN_MAX_LEN,
  NOVEL_SPEC_FILE,
  OUTLINE_ARCHIVE_DIR,
  PLOT_FILE,
  PROJECT_FILE_PATH_MAX_LEN,
  PROJECT_FILE_PATH_REGEX,
  STYLE_SAMPLE_FILE,
  STORY_STATUS_FILE,
  type AiWorkspaceUsageDiagnostics,
  type AiPresetPromptSection,
  type AiPresetRuntimeSetting,
  type AiPresetTool,
  type AiAgentConfig,
  type AiWorkspaceMode,
  type AiWorkspaceRunSnapshot,
  type AiWorkspaceRunStatus,
  type KnowledgeBaseItemDoc,
  type ProjectFileDoc,
  type ProjectFileNode,
  type ProjectFileOperation,
  type StartAiWorkspaceRunRequest,
} from "@novelloom/shared";
import { env } from "../env.js";
import {
  InvalidIdError,
  NotFoundError,
  ConflictError,
  createProjectEntry,
  isKnowledgeBaseCharacterPath,
  isOutlineArchivePath,
  listProjectFiles,
  readAiAgentById,
  readAllKnowledgeBaseDocs,
  readAiSessions,
  readProjectFile,
  writeProjectFile,
} from "../books/storage.js";
import { assertModelConfigured, llmProvider } from "../ai/modelClient.js";

const IdSchema = z.string().regex(BOOK_ID_REGEX);
const AgentIdSchema = z.string().regex(AI_AGENT_ID_REGEX);
const ProjectPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROJECT_FILE_PATH_MAX_LEN)
  .regex(PROJECT_FILE_PATH_REGEX);
const ContentSchema = z.string().max(MARKDOWN_MAX_LEN);
const AiWorkspaceModeSchema = z.enum(["workspace", "character_roleplay"]);
const BatchProjectPathsSchema = z.array(ProjectPathSchema).min(1).max(20);
const BatchProjectFilesSchema = z
  .array(
    z.object({
      path: ProjectPathSchema,
      content: ContentSchema,
    }),
  )
  .min(1)
  .max(10);

const BookIdParams = z.object({ bookId: IdSchema });
const RunParams = z.object({
  bookId: IdSchema,
  runId: z.string().trim().min(1).max(128),
});
const StartRunBody = z.object({
  sessionId: z.string().trim().min(1).max(128),
  messages: z.array(z.unknown()).min(1),
  contextPaths: z.array(ProjectPathSchema).max(10).optional(),
  agentId: AgentIdSchema.optional(),
  mode: AiWorkspaceModeSchema,
  roleplayCharacterPath: ProjectPathSchema.optional(),
  commandName: z.string().trim().min(1).max(32).optional(),
  readOnly: z.boolean().optional(),
}) satisfies z.ZodType<StartAiWorkspaceRunRequest<unknown>>;
const DraftChangeActionBody = z
  .object({
    paths: BatchProjectPathsSchema.optional(),
  })
  .optional();

const chineseSegmenter = new Intl.Segmenter("zh", { granularity: "word" });
const AI_WORKSPACE_MODEL_HISTORY_TURN_LIMIT = 6;

export const AI_WORKSPACE_BASE_SYSTEM_PROMPT_LINES = [
  "你是 NovelLoom 的 AI 写作助手，协助用户创作小说。",
  "只能通过项目文件工具读取当前书籍文件；没有读取过的内容不要当作事实。",
  "需要改文件时，使用写入或创建文件工具，并在回复中说明读了什么、改了什么、还有哪些待确认。",
  "人物、世界观、特殊物品设定优先写入 library/characters、library/world、library/items。",
  "创建新的 Markdown 文件时，文件名必须使用中文标题或中文专名，例如 library/characters/林晚.md、library/world/青岚宗.md、library/items/玄铁令.md；不要使用英文 slug、拼音或无意义编号。",
  "资料库、剧情状态、大纲和规划内容默认采用轻量写法：只记录当前任务需要的稳定事实、限制、关系和待补充项；不要为完整感生成长篇背景、百科式历史或重复解释，除非用户明确要求详细展开。",
  `${NOVEL_SPEC_FILE} 记录本书长期结构、篇幅、文风、禁忌和创意规则；写作、续写、重整大纲、改写或审阅前优先读取它。`,
  `${STYLE_SAMPLE_FILE} 记录本书写作风格样例；生成细纲、正文续写或改写时，若存在应读取并参考其语感、节奏、对白方式和描写密度，但不得复用具体原句、剧情或人物关系。`,
  `${PLOT_FILE} 记录剧情走向、主线支线、阶段规划、剧情点子、伏笔回收、冲突反转和待确认剧情问题。`,
  `${NOVEL_SPEC_FILE} 规定怎么写；${PLOT_FILE} 规定故事往哪里走；library/、outline/、chapters/ 和用户最新指令提供事实依据。`,
  "写作、续写、重整大纲、改写或审阅前，先确认任务范围，再列目录并读取必要的创作规格、资料库、大纲、正文和创作快照。",
  `${STORY_STATUS_FILE} 只记录当前进度、最近上下文、下一步和待确认事项；详细设定写入资料库。`,
  `剧情规划变化写入 ${PLOT_FILE}；当前进度快照写入 ${STORY_STATUS_FILE}；不要把长期剧情规划塞进 ${STORY_STATUS_FILE}。`,
  `${OUTLINE_ARCHIVE_DIR}/ 是用户细纲归档区，AI 工具不可列出、读取或修改其中内容。`,
  `只有内容改变进度、章节结尾、人物状态或关键设定时，才同步更新 ${STORY_STATUS_FILE}。`,
  `如果 ${STORY_STATUS_FILE} 与已读项目文件冲突，以项目文件和用户最新指令为准，并把冲突列入待确认。`,
  AI_CONTEXT_PRIORITY_PROMPT_GUIDE,
  "回复使用 Markdown；资料不足时说明未知，可以给推测但必须标注为推测。",
] as const;

export const AI_WORKSPACE_AGENT_PROMPT_POLICY =
  "优先遵循该 Agent 的创作角色，但不能覆盖文件访问、真实性、资料库事实和工具权限规则。";

export const AI_WORKSPACE_NO_AGENT_PROMPT =
  "\n当前未启用自定义 Agent，使用默认写作助手。";

export const AI_WORKSPACE_NO_CONTEXT_PROMPT =
  "\n当前没有绑定文件上下文；需要时先读取项目目录或相关文件。";

export const AI_WORKSPACE_CONTEXT_PROMPT_PREFIX = "\n当前绑定的文件上下文：";

interface AiWorkspacePromptContext {
  contextDocs: string[];
  agent: AiAgentConfig | null;
}

interface AiWorkspacePromptSectionDefinition {
  id: string;
  title: string;
  source: string;
  render(ctx: AiWorkspacePromptContext): string;
  preview(): string;
}

export const AI_WORKSPACE_PROMPT_SECTIONS: AiWorkspacePromptSectionDefinition[] =
  [
    {
      id: "base",
      title: "基础系统提示词",
      source:
        "apps/server/src/routes/aiWorkspace.ts#AI_WORKSPACE_PROMPT_SECTIONS",
      render: () => AI_WORKSPACE_BASE_SYSTEM_PROMPT_LINES.join("\n"),
      preview: () => AI_WORKSPACE_BASE_SYSTEM_PROMPT_LINES.join("\n"),
    },
    {
      id: "agent",
      title: "Agent 注入规则",
      source:
        "apps/server/src/routes/aiWorkspace.ts#AI_WORKSPACE_PROMPT_SECTIONS + AiAgentConfig.systemPrompt",
      render: ({ agent }) =>
        agent
          ? [
              "\n当前启用的 Agent：",
              `名称：${agent.name}`,
              `描述：${agent.description || "无"}`,
              "角色提示词：",
              agent.systemPrompt,
              AI_WORKSPACE_AGENT_PROMPT_POLICY,
            ].join("\n")
          : AI_WORKSPACE_NO_AGENT_PROMPT,
      preview: () =>
        [
          "当前启用 Agent 时，系统提示词会追加：",
          "名称：<agent.name>",
          "描述：<agent.description || 无>",
          "角色提示词：",
          "<agent.systemPrompt>",
          AI_WORKSPACE_AGENT_PROMPT_POLICY,
          "",
          "未启用 Agent 时：",
          AI_WORKSPACE_NO_AGENT_PROMPT.trim(),
        ].join("\n"),
    },
    {
      id: "context",
      title: "上下文文件注入规则",
      source:
        "apps/server/src/routes/aiWorkspace.ts#AI_WORKSPACE_PROMPT_SECTIONS + contextDocs",
      render: ({ contextDocs }) =>
        contextDocs.length > 0
          ? `${AI_WORKSPACE_CONTEXT_PROMPT_PREFIX}\n${contextDocs.join("\n\n")}`
          : AI_WORKSPACE_NO_CONTEXT_PROMPT,
      preview: () =>
        [
          `${AI_WORKSPACE_CONTEXT_PROMPT_PREFIX}`,
          "--- <path> ---",
          "<file content>",
          "",
          "上下文文件来自 AI 协作面板发送的 contextPaths，后端会按项目相对路径读取当前书籍文件。",
          "",
          "没有绑定文件上下文时：",
          AI_WORKSPACE_NO_CONTEXT_PROMPT.trim(),
        ].join("\n"),
    },
  ];

export function renderAiWorkspaceSystemPrompt(
  ctx: AiWorkspacePromptContext,
): string {
  return AI_WORKSPACE_PROMPT_SECTIONS.map((section) => section.render(ctx))
    .filter((content) => content.trim().length > 0)
    .join("\n");
}

export function describeAiWorkspacePromptSections(): AiPresetPromptSection[] {
  return AI_WORKSPACE_PROMPT_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    source: section.source,
    content: section.preview(),
  }));
}

export function getAiWorkspaceRuntimeSettings(): AiPresetRuntimeSetting[] {
  return [
    {
      key: "provider",
      label: "模型提供方",
      value: env.LLM_PROVIDER,
      description: "通过 OpenAI-compatible provider 接入当前模型服务。",
    },
    {
      key: "model",
      label: "模型",
      value: env.MODEL,
      description: "来自 MODEL；未配置时使用 deepseek-v4-pro。",
    },
    {
      key: "baseURL",
      label: "模型服务地址",
      value: env.LLM_BASE_URL,
      description: "来自 LLM_BASE_URL；API key 不会暴露给前端。",
    },
    {
      key: "workspaceApi",
      label: "AI 工作台接口",
      value: "POST /api/books/:bookId/ai-workspace-runs",
      description: "AI 协作面板创建异步 run，前端通过轮询获取结果。",
    },
    {
      key: "contextPathMaxCount",
      label: "上下文文件数量",
      value: "最多 10 个",
      description: "请求体 contextPaths 最多包含 10 个项目相对路径。",
    },
    {
      key: "toolChoice",
      label: "工具选择",
      value: "auto",
      description: "模型可根据任务自动决定是否调用项目文件工具。",
    },
    {
      key: "maxToolSteps",
      label: "最大执行步骤",
      value: "8",
      description:
        "使用 stepCountIs(8) 限制一次请求中的工具/生成循环，支持重功能命令完成列表、批量读取、批量写入和总结。",
    },
    {
      key: "streamSmoothing",
      label: "流式平滑",
      value: "中文分词，18ms 延迟",
      description: "使用 smoothStream 改善中文输出节奏。",
    },
    {
      key: "sendReasoning",
      label: "思考摘要",
      value: "开启",
      description:
        "如模型返回 reasoning parts，服务端会合并到 UI message stream；不额外设置 reasoning_effort。",
    },
    {
      key: "filePathValidation",
      label: "文件路径校验",
      value: "PROJECT_FILE_PATH_REGEX + PROJECT_FILE_PATH_MAX_LEN",
      description: "AI 工具读写路径必须是安全的项目相对路径。",
    },
    {
      key: "maxMarkdownLength",
      label: "Markdown 最大长度",
      value: String(MARKDOWN_MAX_LEN),
      description: "AI 写入文件内容不能超过共享包定义的 Markdown 最大长度。",
    },
  ];
}

type ToolOutput = {
  result: unknown;
  fileChanged?: ProjectFileOperation;
};

type AiStreamEvent =
  | {
      id?: string;
      kind: "thinking";
      title: string;
      detail: string;
      createdAt?: string;
    }
  | {
      id?: string;
      kind: "tool_start";
      toolCallId?: string;
      toolName: string;
      input: unknown;
      createdAt?: string;
    }
  | {
      id?: string;
      kind: "tool_finish";
      toolCallId?: string;
      toolName: string;
      durationMs?: number;
      output?: unknown;
      error?: string;
      createdAt?: string;
    }
  | {
      id?: string;
      kind: "file_changed";
      operation: ProjectFileOperation;
      createdAt?: string;
    };

type EmitAiEvent = (event: AiStreamEvent) => void;

interface PreparedAiWorkspaceContext {
  contextDocs: string[];
  agent: AiAgentConfig | null;
  mode: AiWorkspaceMode;
  readOnlyTools: boolean;
  roleplayCharacterTitle?: string;
  knowledgeBaseDocCount?: number;
  roleplayPrompt?: string;
}

interface AiWorkspaceRunInternal {
  runId: string;
  bookId: string;
  sessionId: string;
  mode: AiWorkspaceMode;
  status: AiWorkspaceRunStatus;
  messages: UIMessage[];
  events: AiStreamEvent[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  usage?: AiWorkspaceUsageDiagnostics;
  drafts: Map<string, AiDraftFileDraft>;
  pendingChanges?: AiDraftChangeSet;
  abortController: AbortController;
}

interface AiDraftFileDraft {
  path: string;
  status: AiDraftFileChangeStatus;
  baseContent: string | null;
  baseHash: string | null;
  draftContent: string;
}

const AI_WORKSPACE_RUN_MAX_COUNT = 100;
const aiWorkspaceRuns = new Map<string, AiWorkspaceRunInternal>();

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
  return err instanceof Error ? err.message : String(err);
}

function aiStreamErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolveAiRunError(err: unknown, streamError: unknown): string {
  if (streamError) return aiStreamErrorMessage(streamError);
  if (NoOutputGeneratedError.isInstance(err)) {
    return "模型流没有产生可用输出，请检查模型服务、API key、模型名称或工具调用错误。";
  }
  return errorMessage(err);
}

function previewableToolOutput(
  result: unknown,
  fileChanged?: ProjectFileOperation,
): ToolOutput {
  return { result, ...(fileChanged ? { fileChanged } : {}) };
}

function sanitizeProjectFileNodeForModel(
  node: ProjectFileNode,
): Record<string, unknown> {
  return {
    name: node.name,
    path: node.path,
    kind: node.kind,
    ...(node.children
      ? {
          children: node.children.map((child) =>
            sanitizeProjectFileNodeForModel(child),
          ),
        }
      : {}),
    ...(node.sizeBytes !== undefined ? { sizeBytes: node.sizeBytes } : {}),
    ...(node.wordCount !== undefined ? { wordCount: node.wordCount } : {}),
  };
}

function sanitizeProjectFileDocForModel(
  doc: ProjectFileDoc,
): Record<string, unknown> {
  return {
    name: doc.name,
    path: doc.path,
    content: doc.content,
    contentType: doc.contentType,
  };
}

function contentTypeForDraftPath(projectPath: string): string {
  if (projectPath.toLowerCase().endsWith(".md")) return "text/markdown";
  if (projectPath.toLowerCase().endsWith(".json")) return "application/json";
  return "text/plain";
}

function projectFileName(projectPath: string): string {
  const segments = projectPath.split("/");
  return segments[segments.length - 1] || projectPath;
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function splitDiffLines(content: string): string[] {
  const normalized = normalizeLineEndings(content);
  return normalized.length === 0 ? [] : normalized.split("\n");
}

function buildLineDiffOps(
  beforeLines: string[],
  afterLines: string[],
): Array<{ type: "context" | "add" | "delete"; text: string }> {
  const maxCells = 200_000;
  if (beforeLines.length * afterLines.length > maxCells) {
    return [
      ...beforeLines.map((text) => ({ type: "delete" as const, text })),
      ...afterLines.map((text) => ({ type: "add" as const, text })),
    ];
  }

  const lcs: number[][] = Array.from({ length: beforeLines.length + 1 }, () =>
    Array(afterLines.length + 1).fill(0),
  );
  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        beforeLines[i] === afterLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: Array<{ type: "context" | "add" | "delete"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ type: "context", text: beforeLines[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "delete", text: beforeLines[i] });
      i += 1;
    } else {
      ops.push({ type: "add", text: afterLines[j] });
      j += 1;
    }
  }
  while (i < beforeLines.length) {
    ops.push({ type: "delete", text: beforeLines[i] });
    i += 1;
  }
  while (j < afterLines.length) {
    ops.push({ type: "add", text: afterLines[j] });
    j += 1;
  }
  return ops;
}

function createUnifiedDiff({
  path,
  beforeContent,
  afterContent,
}: {
  path: string;
  beforeContent: string;
  afterContent: string;
}): Pick<AiDraftFileChange, "additions" | "deletions" | "diff"> {
  const beforeLines = splitDiffLines(beforeContent);
  const afterLines = splitDiffLines(afterContent);
  const ops = buildLineDiffOps(beforeLines, afterLines);
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === "add") additions += 1;
    if (op.type === "delete") deletions += 1;
  }
  const diffLines = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...ops.map((op) => {
      if (op.type === "add") return `+${op.text}`;
      if (op.type === "delete") return `-${op.text}`;
      return ` ${op.text}`;
    }),
  ];
  return { additions, deletions, diff: diffLines.join("\n") };
}

function draftDocFromContent(
  projectPath: string,
  content: string,
  updatedAt: string,
): ProjectFileDoc {
  return {
    name: projectFileName(projectPath),
    path: projectPath,
    content,
    contentType: contentTypeForDraftPath(projectPath),
    updatedAt,
  };
}

async function readProjectFileWithDraft(
  run: AiWorkspaceRunInternal,
  projectPath: string,
): Promise<ProjectFileDoc> {
  const draft = run.drafts.get(projectPath);
  if (draft) {
    return draftDocFromContent(projectPath, draft.draftContent, run.updatedAt);
  }
  return await readProjectFile(run.bookId, projectPath);
}

async function stageDraftWrite(
  run: AiWorkspaceRunInternal,
  projectPath: string,
  content: string,
  options: { createOnly?: boolean } = {},
): Promise<ProjectFileDoc> {
  const existingDraft = run.drafts.get(projectPath);
  if (options.createOnly && existingDraft) {
    throw new ConflictError(
      `Project path already exists in draft: ${projectPath}`,
    );
  }
  if (existingDraft) {
    existingDraft.draftContent = content;
    run.updatedAt = new Date().toISOString();
    return draftDocFromContent(projectPath, content, run.updatedAt);
  }

  let baseContent: string | null = null;
  let status: AiDraftFileChangeStatus = "modified";
  try {
    const current = await readProjectFile(run.bookId, projectPath);
    if (options.createOnly) {
      throw new ConflictError(`Project path already exists: ${projectPath}`);
    }
    baseContent = current.content;
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    if (!options.createOnly) throw err;
    status = "created";
  }

  const now = new Date().toISOString();
  run.drafts.set(projectPath, {
    path: projectPath,
    status,
    baseContent,
    baseHash: baseContent === null ? null : sha256(baseContent),
    draftContent: content,
  });
  run.updatedAt = now;
  return draftDocFromContent(projectPath, content, now);
}

function buildPendingChanges(
  run: AiWorkspaceRunInternal,
): AiDraftChangeSet | undefined {
  const files = [...run.drafts.values()]
    .filter((draft) => draft.baseContent !== draft.draftContent)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((draft): AiDraftFileChange => {
      const diff = createUnifiedDiff({
        path: draft.path,
        beforeContent: draft.baseContent ?? "",
        afterContent: draft.draftContent,
      });
      return {
        path: draft.path,
        status: draft.status,
        baseHash: draft.baseHash,
        draftHash: sha256(draft.draftContent),
        additions: diff.additions,
        deletions: diff.deletions,
        diff: diff.diff,
        draftContent: draft.draftContent,
      };
    });
  if (files.length === 0) return undefined;
  const now = new Date().toISOString();
  return {
    runId: run.runId,
    status: "pending_review",
    files,
    createdAt: now,
    updatedAt: now,
  };
}

function filterAiReadableProjectFileNodes(
  nodes: ProjectFileNode[],
): ProjectFileNode[] {
  return nodes
    .filter((node) => !isOutlineArchivePath(node.path))
    .map((node) => ({
      ...node,
      ...(node.children
        ? { children: filterAiReadableProjectFileNodes(node.children) }
        : {}),
    }));
}

function assertAiCanReadProjectPath(projectPath: string): void {
  if (isOutlineArchivePath(projectPath)) {
    throw new InvalidIdError(
      "Archived outline files are not readable by AI tools",
    );
  }
}

function assertAiCanChangeProjectPath(projectPath: string): void {
  if (isOutlineArchivePath(projectPath)) {
    throw new InvalidIdError(
      "Archived outline files are not writable by AI tools",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

interface ModelMessageTrim {
  messages: UIMessage[];
  originalMessageCount: number;
  sentMessageCount: number;
  trimmedMessageCount: number;
}

function trimModelMessagesToRecentTurns(
  messages: UIMessage[],
  turnLimit = AI_WORKSPACE_MODEL_HISTORY_TURN_LIMIT,
): ModelMessageTrim {
  const turns: UIMessage[][] = [];
  let currentTurn: UIMessage[] | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      currentTurn = [message];
      turns.push(currentTurn);
      continue;
    }

    if (!currentTurn) {
      currentTurn = [message];
      turns.push(currentTurn);
      continue;
    }

    currentTurn.push(message);
  }

  const trimmedMessages = turns.slice(-turnLimit).flat();
  const sentMessages =
    trimmedMessages.length > 0 ? trimmedMessages : messages.slice(-1);

  return {
    messages: sentMessages,
    originalMessageCount: messages.length,
    sentMessageCount: sentMessages.length,
    trimmedMessageCount: Math.max(0, messages.length - sentMessages.length),
  };
}

function promiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function",
  );
}

async function resolveResultProperty(
  source: unknown,
  key: string,
): Promise<unknown> {
  if (!isRecord(source) || !(key in source)) return undefined;
  const value = source[key];
  if (!promiseLike(value)) return value;
  try {
    return await value;
  } catch {
    return undefined;
  }
}

function findNumberByKeys(
  value: unknown,
  keys: Set<string>,
  depth = 5,
): number | undefined {
  if (depth < 0 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumberByKeys(item, keys, depth - 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  for (const [key, nested] of Object.entries(value)) {
    if (
      keys.has(key) &&
      typeof nested === "number" &&
      Number.isFinite(nested)
    ) {
      return nested;
    }
  }
  for (const nested of Object.values(value)) {
    const found = findNumberByKeys(nested, keys, depth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function roundedRate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function nonNegative(value: number): number {
  return Math.max(0, value);
}

function buildUsageDiagnostics({
  rawUsage,
  providerMetadata,
  modelMessageTrim,
  historyTurnLimit,
  toolCallCount,
  contextDocCount,
}: {
  rawUsage?: unknown;
  providerMetadata?: unknown;
  modelMessageTrim: ModelMessageTrim;
  historyTurnLimit: number;
  toolCallCount: number;
  contextDocCount: number;
}): AiWorkspaceUsageDiagnostics {
  const usageSource = { rawUsage, providerMetadata };
  const inputTokens = findNumberByKeys(
    usageSource,
    new Set(["inputTokens", "promptTokens", "prompt_tokens"]),
  );
  const outputTokens = findNumberByKeys(
    usageSource,
    new Set(["outputTokens", "completionTokens", "completion_tokens"]),
  );
  const explicitTotalTokens = findNumberByKeys(
    usageSource,
    new Set(["totalTokens", "total_tokens"]),
  );
  const cachedInputTokens = findNumberByKeys(
    usageSource,
    new Set([
      "cachedInputTokens",
      "cachedPromptTokens",
      "promptCacheHitTokens",
      "prompt_cache_hit_tokens",
      "cacheHitInputTokens",
      "cache_hit_tokens",
    ]),
  );
  const explicitUncachedInputTokens = findNumberByKeys(
    usageSource,
    new Set([
      "uncachedInputTokens",
      "uncachedPromptTokens",
      "promptCacheMissTokens",
      "prompt_cache_miss_tokens",
      "cacheMissInputTokens",
      "cache_miss_tokens",
    ]),
  );
  const totalTokens =
    explicitTotalTokens ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  const uncachedInputTokens =
    explicitUncachedInputTokens ??
    (inputTokens !== undefined && cachedInputTokens !== undefined
      ? nonNegative(inputTokens - cachedInputTokens)
      : undefined);
  const cacheHitRate =
    inputTokens !== undefined &&
    inputTokens > 0 &&
    cachedInputTokens !== undefined
      ? roundedRate(cachedInputTokens / inputTokens)
      : undefined;

  return {
    model: env.MODEL,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(uncachedInputTokens !== undefined ? { uncachedInputTokens } : {}),
    ...(cacheHitRate !== undefined ? { cacheHitRate } : {}),
    sentMessageCount: modelMessageTrim.sentMessageCount,
    originalMessageCount: modelMessageTrim.originalMessageCount,
    trimmedMessageCount: modelMessageTrim.trimmedMessageCount,
    historyTurnLimit,
    toolCallCount,
    contextDocCount,
  };
}

function logUsageDiagnostics(
  logger: FastifyBaseLogger,
  run: AiWorkspaceRunInternal,
  readOnlyTools: boolean,
) {
  logger.info(
    {
      runId: run.runId,
      bookId: run.bookId,
      sessionId: run.sessionId,
      mode: run.mode,
      status: run.status,
      readOnlyTools,
      usage: run.usage,
    },
    "AI workspace usage diagnostics",
  );
}

function toolCallIdFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("toolCallId" in value)) {
    return undefined;
  }
  const toolCallId = (value as { toolCallId?: unknown }).toolCallId;
  return typeof toolCallId === "string" && toolCallId.length > 0
    ? toolCallId
    : undefined;
}

function snapshotRun(
  run: AiWorkspaceRunInternal,
): AiWorkspaceRunSnapshot<UIMessage> {
  return {
    runId: run.runId,
    bookId: run.bookId,
    sessionId: run.sessionId,
    status: run.status,
    messages: run.messages,
    events: run.events,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.usage ? { usage: run.usage } : {}),
    ...(run.pendingChanges ? { pendingChanges: run.pendingChanges } : {}),
  };
}

function pruneWorkspaceRuns() {
  if (aiWorkspaceRuns.size <= AI_WORKSPACE_RUN_MAX_COUNT) return;
  const removable = [...aiWorkspaceRuns.values()]
    .filter((run) => run.status !== "running")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const run of removable) {
    if (aiWorkspaceRuns.size <= AI_WORKSPACE_RUN_MAX_COUNT) break;
    aiWorkspaceRuns.delete(run.runId);
  }
}

function createAssistantMessage(text: string, runId: string): UIMessage {
  return {
    id: `assistant-${runId}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as UIMessage;
}

function operationSummary(operation: ProjectFileOperation): string {
  switch (operation.type) {
    case "create_file":
      return `创建文件 ${operation.path}`;
    case "create_directory":
      return `创建目录 ${operation.path}`;
    case "write_file":
      return `写入文件 ${operation.path}`;
    case "rename":
      return `重命名 ${operation.fromPath} -> ${operation.toPath}`;
    case "delete":
      return `删除 ${operation.path}`;
  }
}

function summarizeRunEvents(events: AiStreamEvent[]): string | null {
  const changes = events
    .filter(
      (event): event is Extract<AiStreamEvent, { kind: "file_changed" }> =>
        event.kind === "file_changed",
    )
    .map((event) => operationSummary(event.operation));
  if (changes.length === 0) return null;
  const uniqueChanges = [...new Set(changes)];
  return [
    "已生成文件更新草稿，但模型没有返回额外总结。",
    "",
    "待审阅变更：",
    ...uniqueChanges.map((change) => `- ${change}`),
  ].join("\n");
}

type AiWorkspaceTool = ReturnType<typeof tool<any, any>>;

interface AiWorkspaceToolDefinition {
  preset: AiPresetTool;
  create(run: AiWorkspaceRunInternal, emit: EmitAiEvent): AiWorkspaceTool;
}

function defineAiWorkspaceTool(
  preset: AiPresetTool,
  create: (
    preset: AiPresetTool,
    run: AiWorkspaceRunInternal,
    emit: EmitAiEvent,
  ) => AiWorkspaceTool,
): AiWorkspaceToolDefinition {
  return {
    preset,
    create: (run, emit) => create(preset, run, emit),
  };
}

const AI_WORKSPACE_TOOL_DEFINITIONS: AiWorkspaceToolDefinition[] = [
  defineAiWorkspaceTool(
    {
      name: "list_project_files",
      description: "List the current book project's editable file tree.",
      inputSchemaSummary: "无需参数。",
      canChangeFiles: false,
      changeOperationTypes: [],
    },
    (preset, run, emit) =>
      tool({
        description: preset.description,
        inputSchema: jsonSchema<Record<string, never>>({
          type: "object",
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          emit({
            kind: "thinking",
            title: "读取项目目录",
            detail: "AI 正在查看当前书籍的项目文件结构。",
          });
          const nodes = await listProjectFiles(run.bookId);
          const readableNodes = filterAiReadableProjectFileNodes(nodes);
          return previewableToolOutput(
            readableNodes.map((node) => sanitizeProjectFileNodeForModel(node)),
          );
        },
      }),
  ),
  defineAiWorkspaceTool(
    {
      name: "read_project_file",
      description: "Read one UTF-8 text file in the current book project.",
      inputSchemaSummary:
        "{ path: string }，path 必须是当前书籍内的项目相对路径。",
      canChangeFiles: false,
      changeOperationTypes: [],
    },
    (preset, run, emit) =>
      tool({
        description: preset.description,
        inputSchema: jsonSchema<{ path: string }>({
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        }),
        execute: async ({ path }) => {
          const parsedPath = ProjectPathSchema.parse(path);
          assertAiCanReadProjectPath(parsedPath);
          emit({
            kind: "thinking",
            title: "读取项目文件",
            detail: `AI 正在读取 ${parsedPath}。`,
          });
          const file = await readProjectFileWithDraft(run, parsedPath);
          return previewableToolOutput(sanitizeProjectFileDocForModel(file));
        },
      }),
  ),
  defineAiWorkspaceTool(
    {
      name: "read_project_files",
      description:
        "Read multiple UTF-8 text files in the current book project.",
      inputSchemaSummary: "{ paths: string[] }，最多 20 个项目相对路径。",
      canChangeFiles: false,
      changeOperationTypes: [],
    },
    (preset, run, emit) =>
      tool({
        description: preset.description,
        inputSchema: jsonSchema<{ paths: string[] }>({
          type: "object",
          properties: {
            paths: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 20,
            },
          },
          required: ["paths"],
          additionalProperties: false,
        }),
        execute: async ({ paths }) => {
          const parsedPaths = [
            ...new Set(BatchProjectPathsSchema.parse(paths)),
          ];
          for (const path of parsedPaths) {
            assertAiCanReadProjectPath(path);
          }
          emit({
            kind: "thinking",
            title: "批量读取项目文件",
            detail: `AI 正在读取 ${parsedPaths.length} 个项目文件。`,
          });
          const files = [];
          for (const path of parsedPaths) {
            const file = await readProjectFileWithDraft(run, path);
            files.push(sanitizeProjectFileDocForModel(file));
          }
          return previewableToolOutput({ files });
        },
      }),
  ),
  defineAiWorkspaceTool(
    {
      name: "write_project_file",
      description:
        "Overwrite an existing UTF-8 text file in the current book project.",
      inputSchemaSummary:
        "{ path: string; content: string }，content 不超过 MARKDOWN_MAX_LEN。",
      canChangeFiles: true,
      changeOperationTypes: ["write_file"],
    },
    (preset, run, emit) =>
      tool({
        description: preset.description,
        inputSchema: jsonSchema<{ path: string; content: string }>({
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
          additionalProperties: false,
        }),
        execute: async ({ path, content }) => {
          const parsedPath = ProjectPathSchema.parse(path);
          assertAiCanChangeProjectPath(parsedPath);
          const parsedContent = ContentSchema.parse(content);
          emit({
            kind: "thinking",
            title: "写入项目文件",
            detail: `AI 正在写入 ${parsedPath}。`,
          });
          const result = await stageDraftWrite(run, parsedPath, parsedContent);
          const operation: ProjectFileOperation = {
            type: "write_file",
            path: parsedPath,
            content: parsedContent,
          };
          emit({ kind: "file_changed", operation });
          return previewableToolOutput(
            sanitizeProjectFileDocForModel(result),
            operation,
          );
        },
      }),
  ),
  defineAiWorkspaceTool(
    {
      name: "write_project_files",
      description:
        "Create or overwrite multiple UTF-8 text files in the current book project.",
      inputSchemaSummary:
        "{ files: { path: string; content: string }[] }，最多 10 个文件，content 不超过 MARKDOWN_MAX_LEN。",
      canChangeFiles: true,
      changeOperationTypes: ["create_file", "write_file"],
    },
    (preset, run, emit) =>
      tool({
        description: preset.description,
        inputSchema: jsonSchema<{
          files: Array<{ path: string; content: string }>;
        }>({
          type: "object",
          properties: {
            files: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  content: { type: "string" },
                },
                required: ["path", "content"],
                additionalProperties: false,
              },
            },
          },
          required: ["files"],
          additionalProperties: false,
        }),
        execute: async ({ files }) => {
          const parsedFiles = BatchProjectFilesSchema.parse(files);
          for (const file of parsedFiles) {
            assertAiCanChangeProjectPath(file.path);
          }
          emit({
            kind: "thinking",
            title: "批量写入项目文件",
            detail: `AI 正在创建或覆盖 ${parsedFiles.length} 个项目文件。`,
          });
          const results: Array<{
            path: string;
            action: "created" | "overwritten";
          }> = [];
          for (const file of parsedFiles) {
            try {
              await stageDraftWrite(run, file.path, file.content);
              const operation: ProjectFileOperation = {
                type: "write_file",
                path: file.path,
                content: file.content,
              };
              emit({ kind: "file_changed", operation });
              results.push({ path: file.path, action: "overwritten" });
            } catch (err) {
              if (!(err instanceof NotFoundError)) throw err;
              await stageDraftWrite(run, file.path, file.content, {
                createOnly: true,
              });
              const operation: ProjectFileOperation = {
                type: "create_file",
                path: file.path,
                content: file.content,
              };
              emit({ kind: "file_changed", operation });
              results.push({ path: file.path, action: "created" });
            }
          }
          return previewableToolOutput({ files: results });
        },
      }),
  ),
  defineAiWorkspaceTool(
    {
      name: "create_project_file",
      description: "Create a new UTF-8 text file in the current book project.",
      inputSchemaSummary:
        "{ path: string; content?: string }，path 必须是当前书籍内的新文件路径。",
      canChangeFiles: true,
      changeOperationTypes: ["create_file"],
    },
    (preset, run, emit) =>
      tool({
        description: preset.description,
        inputSchema: jsonSchema<{ path: string; content?: string }>({
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path"],
          additionalProperties: false,
        }),
        execute: async ({ path, content }) => {
          const parsedPath = ProjectPathSchema.parse(path);
          assertAiCanChangeProjectPath(parsedPath);
          const parsedContent = ContentSchema.optional().parse(content);
          emit({
            kind: "thinking",
            title: "创建项目文件",
            detail: `AI 正在创建 ${parsedPath}。`,
          });
          const result = await stageDraftWrite(
            run,
            parsedPath,
            parsedContent ?? "",
            {
              createOnly: true,
            },
          );
          const operation: ProjectFileOperation = {
            type: "create_file",
            path: parsedPath,
            content: parsedContent,
          };
          emit({ kind: "file_changed", operation });
          return previewableToolOutput(
            sanitizeProjectFileDocForModel(result),
            operation,
          );
        },
      }),
  ),
  defineAiWorkspaceTool(
    {
      name: "create_project_directory",
      description: "Create a new directory in the current book project.",
      inputSchemaSummary:
        "{ path: string }，path 必须是当前书籍内的新目录路径。",
      canChangeFiles: true,
      changeOperationTypes: ["create_directory"],
    },
    (preset, run, emit) =>
      tool({
        description: preset.description,
        inputSchema: jsonSchema<{ path: string }>({
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        }),
        execute: async ({ path }) => {
          const parsedPath = ProjectPathSchema.parse(path);
          assertAiCanChangeProjectPath(parsedPath);
          emit({
            kind: "thinking",
            title: "创建项目目录",
            detail: `AI 正在创建目录 ${parsedPath}。`,
          });
          const result = await createProjectEntry(
            run.bookId,
            parsedPath,
            "directory",
          );
          const operation: ProjectFileOperation = {
            type: "create_directory",
            path: parsedPath,
          };
          emit({ kind: "file_changed", operation });
          return previewableToolOutput(
            sanitizeProjectFileNodeForModel(result),
            operation,
          );
        },
      }),
  ),
];

export function describeAiWorkspaceTools(): AiPresetTool[] {
  return AI_WORKSPACE_TOOL_DEFINITIONS.map((definition) => definition.preset);
}

function createProjectTools(
  run: AiWorkspaceRunInternal,
  emit: EmitAiEvent,
  options?: { readOnly?: boolean },
) {
  const definitions = options?.readOnly
    ? AI_WORKSPACE_TOOL_DEFINITIONS.filter(
        (definition) => !definition.preset.canChangeFiles,
      )
    : AI_WORKSPACE_TOOL_DEFINITIONS.filter(
        (definition) =>
          !definition.preset.changeOperationTypes.includes("create_directory"),
      );
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.preset.name,
      definition.create(run, emit),
    ]),
  ) as Record<string, AiWorkspaceTool>;
}

function buildSystemPrompt({
  contextDocs,
  agent,
  roleplayPrompt,
}: {
  contextDocs: string[];
  agent: AiAgentConfig | null;
  roleplayPrompt?: string;
}): string {
  return [renderAiWorkspaceSystemPrompt({ contextDocs, agent }), roleplayPrompt]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n");
}

function renderKnowledgeBaseContext(docs: KnowledgeBaseItemDoc[]): string {
  return docs
    .map((doc) => `--- ${doc.path} (${doc.title}) ---\n${doc.content}`)
    .join("\n\n");
}

function buildRoleplayPrompt(characterTitle: string): string {
  return [
    "\n当前模式：人物角色对话。",
    `你正在扮演人物「${characterTitle}」，接受用户以作者/上帝视角进行访谈。`,
    "用户不是故事中的其它角色，而是可以询问任何人物经历、隐秘动机、未来规划、关系判断和设定细节的创作者。",
    "必须优先遵循该人物卡中的当前状态、关系、口吻、动机、秘密和限制。",
    "必须参考资料库中其它人物、世界观、特殊物品设定保持一致。",
    `你可以复用 AI 协作的只读项目能力：当问题涉及章节事件、人物状态、伏笔、大纲、进度、剧情想法或其它项目文件时，先列出项目文件，再读取必要的 ${PLOT_FILE}、story-status.md、idea.md、outline/、chapters/ 或其它相关 Markdown 文件。`,
    "当问题涉及其它人物、世界规则或特殊物品时，先读取相关资料库卡片，再回答。",
    "面对用户提问时知无不言：包括人物卡中的秘密、尚未公开的信息、真实想法和隐藏关系；不要因为剧情中该人物不应主动暴露而拒答。",
    "回答应先以人物第一人称给出答案，保持口吻和性格；必要时在末尾用「创作注」补充依据、推测、资料缺失或冲突。",
    "本模式默认只读，不得调用写入或创建文件工具，不得修改小说项目文件。",
    "如果人物卡或项目文件没有相关信息，明确说明未知，不要伪装成已存在事实；可以基于已读资料给出合理推测并标注为推测。",
  ].join("\n");
}

async function prepareAiWorkspaceContext({
  bookId,
  agentId,
  contextPaths,
  mode = "workspace",
  roleplayCharacterPath,
  readOnly,
}: {
  bookId: string;
  agentId?: string;
  contextPaths?: string[];
  mode: AiWorkspaceMode;
  roleplayCharacterPath?: string;
  readOnly?: boolean;
}): Promise<PreparedAiWorkspaceContext> {
  const contextDocs: string[] = [];
  await listProjectFiles(bookId);
  const agent = await readAiAgentById(agentId ?? null);
  if (agentId && !agent) {
    throw new InvalidIdError("AI agent is disabled or does not exist");
  }

  if (mode === "character_roleplay") {
    if (
      !roleplayCharacterPath ||
      !isKnowledgeBaseCharacterPath(roleplayCharacterPath)
    ) {
      throw new InvalidIdError(
        "角色对话必须绑定 library/characters 下的人物卡",
      );
    }
    const characterDoc = await readProjectFile(bookId, roleplayCharacterPath);
    const knowledgeBaseDocs = await readAllKnowledgeBaseDocs(bookId);
    const characterTitle =
      characterDoc.content.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() ||
      characterDoc.name.replace(/\.md$/i, "");
    contextDocs.push(
      `当前扮演人物卡：\n--- ${characterDoc.path} (${characterTitle}) ---\n${characterDoc.content}`,
      `全部资料库：\n${renderKnowledgeBaseContext(knowledgeBaseDocs) || "资料库暂无其它内容。"}`,
    );
    const readOnlyTools = true;
    return {
      contextDocs,
      agent,
      mode,
      readOnlyTools,
      roleplayCharacterTitle: characterTitle,
      knowledgeBaseDocCount: knowledgeBaseDocs.length,
      roleplayPrompt: buildRoleplayPrompt(characterTitle),
    };
  }

  for (const contextPath of contextPaths ?? []) {
    assertAiCanReadProjectPath(contextPath);
    const doc = await readProjectFile(bookId, contextPath);
    contextDocs.push(`--- ${doc.path} ---\n${doc.content}`);
  }

  const readOnlyTools = Boolean(readOnly);
  return {
    contextDocs,
    agent,
    mode,
    readOnlyTools,
  };
}

function emitRunEvent(run: AiWorkspaceRunInternal, event: AiStreamEvent) {
  const eventId = event.id ?? `ai-event-${Date.now()}-${run.events.length + 1}`;
  const createdAt = new Date().toISOString();
  run.events.push({ ...event, id: eventId, createdAt } as AiStreamEvent);
  run.updatedAt = createdAt;
}

async function draftChangeConflicts(
  bookId: string,
  files: AiDraftFileChange[],
): Promise<string[]> {
  const conflicts: string[] = [];
  for (const file of files) {
    if (file.status === "created") {
      try {
        await readProjectFile(bookId, file.path);
        conflicts.push(file.path);
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
      continue;
    }

    try {
      const current = await readProjectFile(bookId, file.path);
      if (sha256(current.content) !== file.baseHash) {
        conflicts.push(file.path);
      }
    } catch (err) {
      if (err instanceof NotFoundError) {
        conflicts.push(file.path);
        continue;
      }
      throw err;
    }
  }
  return conflicts;
}

function selectDraftChangeFiles(
  changes: AiDraftChangeSet,
  paths?: string[],
): AiDraftFileChange[] {
  if (!paths) return changes.files;
  const fileByPath = new Map(changes.files.map((file) => [file.path, file]));
  const selectedFiles: AiDraftFileChange[] = [];
  for (const path of paths) {
    const file = fileByPath.get(path);
    if (!file) {
      throw new InvalidIdError(
        "Selected draft change path is not pending review",
      );
    }
    selectedFiles.push(file);
  }
  return selectedFiles;
}

async function readSavedPendingChanges(
  bookId: string,
  runId: string,
): Promise<AiDraftChangeSet | undefined> {
  const history = await readAiSessions(bookId);
  return history.sessions.find(
    (session) =>
      session.pendingChanges?.runId === runId &&
      session.pendingChanges.status === "pending_review" &&
      session.pendingChanges.files.length > 0,
  )?.pendingChanges;
}

async function resolvePendingChangesForAction(
  bookId: string,
  runId: string,
): Promise<{
  run?: AiWorkspaceRunInternal;
  pendingChanges?: AiDraftChangeSet;
}> {
  const run = aiWorkspaceRuns.get(runId);
  if (run) {
    if (run.bookId !== bookId) return {};
    return {
      run,
      pendingChanges:
        run.pendingChanges?.status === "pending_review"
          ? run.pendingChanges
          : undefined,
    };
  }

  return {
    pendingChanges: await readSavedPendingChanges(bookId, runId),
  };
}

function updateDraftChangeSetAfterAction(
  changes: AiDraftChangeSet,
  selectedFiles: AiDraftFileChange[],
  terminalStatus: "applied" | "discarded",
): AiDraftChangeSet {
  const now = new Date().toISOString();
  const selectedPaths = new Set(selectedFiles.map((file) => file.path));
  const remainingFiles = changes.files.filter(
    (file) => !selectedPaths.has(file.path),
  );
  return {
    ...changes,
    status: remainingFiles.length > 0 ? "pending_review" : terminalStatus,
    files: remainingFiles,
    updatedAt: now,
  };
}

function updateDraftChangesAfterAction(
  run: AiWorkspaceRunInternal,
  selectedFiles: AiDraftFileChange[],
  terminalStatus: "applied" | "discarded",
): void {
  if (!run.pendingChanges) {
    throw new InvalidIdError("No draft changes to update");
  }
  const selectedPaths = new Set(selectedFiles.map((file) => file.path));
  for (const path of selectedPaths) {
    run.drafts.delete(path);
  }
  run.pendingChanges = updateDraftChangeSetAfterAction(
    run.pendingChanges,
    selectedFiles,
    terminalStatus,
  );
  if (run.pendingChanges.files.length === 0) {
    run.drafts.clear();
  }
  run.updatedAt = run.pendingChanges.updatedAt;
}

async function writeDraftFiles(
  bookId: string,
  selectedFiles: AiDraftFileChange[],
): Promise<void> {
  for (const file of selectedFiles) {
    if (file.status === "created") {
      await createProjectEntry(bookId, file.path, "file", file.draftContent);
    } else {
      await writeProjectFile(bookId, file.path, file.draftContent);
    }
  }
}

async function applyDraftChanges(
  run: AiWorkspaceRunInternal,
  selectedFiles: AiDraftFileChange[],
): Promise<void> {
  if (!run.pendingChanges) {
    throw new InvalidIdError("No draft changes to apply");
  }
  await writeDraftFiles(run.bookId, selectedFiles);
  updateDraftChangesAfterAction(run, selectedFiles, "applied");
}

function discardDraftChanges(
  run: AiWorkspaceRunInternal,
  selectedFiles: AiDraftFileChange[],
): void {
  if (!run.pendingChanges) {
    throw new InvalidIdError("No draft changes to discard");
  }
  updateDraftChangesAfterAction(run, selectedFiles, "discarded");
}

async function executeWorkspaceRun({
  run,
  contextDocs,
  agent,
  readOnlyTools,
  roleplayPrompt,
  roleplayCharacterTitle,
  knowledgeBaseDocCount,
  logger,
}: {
  run: AiWorkspaceRunInternal;
  contextDocs: string[];
  agent: AiAgentConfig | null;
  readOnlyTools: boolean;
  roleplayPrompt?: string;
  roleplayCharacterTitle?: string;
  knowledgeBaseDocCount?: number;
  logger: FastifyBaseLogger;
}) {
  const finish = (status: AiWorkspaceRunStatus, error?: string) => {
    const now = new Date().toISOString();
    run.status = status;
    run.updatedAt = now;
    run.finishedAt = now;
    if (error) run.error = error;
    if (status === "completed" && !readOnlyTools) {
      run.pendingChanges = buildPendingChanges(run);
    }
  };

  let streamError: unknown;
  let toolCallCount = 0;
  const modelMessageTrim = trimModelMessagesToRecentTurns(run.messages);
  try {
    assertModelConfigured();
    const emit: EmitAiEvent = (event) => emitRunEvent(run, event);
    emit({
      kind: "thinking",
      title:
        run.mode === "character_roleplay" ? "进入人物对话" : "开始处理请求",
      detail:
        run.mode === "character_roleplay" && roleplayCharacterTitle
          ? `AI 将扮演「${roleplayCharacterTitle}」，可只读读取项目文件辅助回答。`
          : contextDocs.length > 0
            ? "AI 已收到用户消息，会结合当前选中文件处理。"
            : "AI 已收到用户消息，会按需要查看项目文件或直接回复。",
    });
    if (run.mode === "character_roleplay") {
      emit({
        kind: "thinking",
        title: "读取资料库",
        detail: `AI 已读取 ${knowledgeBaseDocCount ?? 0} 张资料卡，也可按需读取章节、大纲和其它项目文件。`,
      });
    }
    if (agent) {
      emit({
        kind: "thinking",
        title: "选择 Agent",
        detail: `当前使用 Agent：${agent.name}。`,
      });
    }
    emit({
      kind: "thinking",
      title: "选择模型",
      detail: `本次使用 ${env.LLM_PROVIDER} / ${env.MODEL}。`,
    });
    const tools = createProjectTools(run, emit, {
      readOnly: readOnlyTools,
    });
    const result = streamText({
      model: llmProvider(env.MODEL),
      system: buildSystemPrompt({ contextDocs, agent, roleplayPrompt }),
      messages: await convertToModelMessages(modelMessageTrim.messages, {
        tools,
        ignoreIncompleteToolCalls: true,
      }),
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(8),
      abortSignal: run.abortController.signal,
      experimental_transform: smoothStream({
        chunking: chineseSegmenter,
        delayInMs: 18,
      }),
      onError: ({ error }) => {
        streamError = error;
        emit({
          kind: "thinking",
          title: "模型流发生错误",
          detail: aiStreamErrorMessage(error),
        });
      },
      experimental_onToolCallStart: ({ toolCall }) => {
        toolCallCount += 1;
        emit({
          kind: "tool_start",
          toolCallId: toolCallIdFrom(toolCall),
          toolName: String(toolCall.toolName),
          input: toolCall.input,
        });
      },
      experimental_onToolCallFinish: (event) => {
        emit({
          kind: "tool_finish",
          toolCallId: toolCallIdFrom(event.toolCall),
          toolName: String(event.toolCall.toolName),
          durationMs: event.durationMs,
          ...(event.success
            ? { output: event.output }
            : {
                error:
                  event.error instanceof Error
                    ? event.error.message
                    : String(event.error),
              }),
        });
      },
    });

    const text = await result.text;
    const rawUsage = await resolveResultProperty(result, "usage");
    const providerMetadata = await resolveResultProperty(
      result,
      "providerMetadata",
    );
    run.usage = buildUsageDiagnostics({
      rawUsage,
      providerMetadata,
      modelMessageTrim,
      historyTurnLimit: AI_WORKSPACE_MODEL_HISTORY_TURN_LIMIT,
      toolCallCount,
      contextDocCount: contextDocs.length,
    });
    const assistantText =
      text.trim().length > 0 ? text : summarizeRunEvents(run.events);
    if (assistantText) {
      run.messages = [
        ...run.messages,
        createAssistantMessage(assistantText, run.runId),
      ];
      run.updatedAt = new Date().toISOString();
    }
    finish(run.abortController.signal.aborted ? "cancelled" : "completed");
  } catch (err) {
    if (run.abortController.signal.aborted) {
      finish("cancelled");
      return;
    }
    finish("failed", resolveAiRunError(err, streamError));
  } finally {
    run.usage ??= buildUsageDiagnostics({
      modelMessageTrim,
      historyTurnLimit: AI_WORKSPACE_MODEL_HISTORY_TURN_LIMIT,
      toolCallCount,
      contextDocCount: contextDocs.length,
    });
    logUsageDiagnostics(logger, run, readOnlyTools);
    pruneWorkspaceRuns();
  }
}

export async function aiWorkspaceRoutes(app: FastifyInstance) {
  app.post("/api/books/:bookId/ai-workspace-runs", async (req, reply) => {
    const params = BookIdParams.safeParse(req.params);
    if (!params.success) {
      return jsonError(reply, 400, "Invalid input", params.error.flatten());
    }
    const body = StartRunBody.safeParse(req.body);
    if (!body.success) {
      return jsonError(reply, 400, "Invalid input", body.error.flatten());
    }

    const { bookId } = params.data;
    let prepared: PreparedAiWorkspaceContext;
    try {
      prepared = await prepareAiWorkspaceContext({
        bookId,
        agentId: body.data.agentId,
        contextPaths: body.data.contextPaths,
        mode: body.data.mode,
        roleplayCharacterPath: body.data.roleplayCharacterPath,
        readOnly: body.data.readOnly,
      });
    } catch (err) {
      if (err instanceof InvalidIdError || err instanceof z.ZodError) {
        return jsonError(reply, 400, "Invalid input", err.message);
      }
      if (err instanceof NotFoundError) {
        return jsonError(reply, 404, "Not found");
      }
      app.log.error(err);
      return jsonError(reply, 500, "Internal error");
    }

    const now = new Date().toISOString();
    const run: AiWorkspaceRunInternal = {
      runId: `run-${crypto.randomUUID()}`,
      bookId,
      sessionId: body.data.sessionId,
      mode: prepared.mode,
      status: "running",
      messages: body.data.messages as UIMessage[],
      events: [],
      createdAt: now,
      updatedAt: now,
      drafts: new Map(),
      abortController: new AbortController(),
    };
    aiWorkspaceRuns.set(run.runId, run);
    pruneWorkspaceRuns();
    void executeWorkspaceRun({
      run,
      contextDocs: prepared.contextDocs,
      agent: prepared.agent,
      readOnlyTools: prepared.readOnlyTools,
      roleplayPrompt: prepared.roleplayPrompt,
      roleplayCharacterTitle: prepared.roleplayCharacterTitle,
      knowledgeBaseDocCount: prepared.knowledgeBaseDocCount,
      logger: app.log,
    }).catch((err) => {
      app.log.error(
        { err, runId: run.runId },
        "ai workspace background run failed",
      );
    });

    return snapshotRun(run);
  });

  app.get("/api/books/:bookId/ai-workspace-runs/:runId", async (req, reply) => {
    const params = RunParams.safeParse(req.params);
    if (!params.success) {
      return jsonError(reply, 400, "Invalid input", params.error.flatten());
    }
    const run = aiWorkspaceRuns.get(params.data.runId);
    if (!run || run.bookId !== params.data.bookId) {
      return jsonError(reply, 404, "Not found");
    }
    return snapshotRun(run);
  });

  app.post(
    "/api/books/:bookId/ai-workspace-runs/:runId/changes/apply",
    async (req, reply) => {
      const params = RunParams.safeParse(req.params);
      if (!params.success) {
        return jsonError(reply, 400, "Invalid input", params.error.flatten());
      }
      const body = DraftChangeActionBody.safeParse(req.body);
      if (!body.success) {
        return jsonError(reply, 400, "Invalid input", body.error.flatten());
      }
      const liveRun = aiWorkspaceRuns.get(params.data.runId);
      if (liveRun && liveRun.bookId !== params.data.bookId) {
        return jsonError(reply, 404, "Not found");
      }
      const { run, pendingChanges } = await resolvePendingChangesForAction(
        params.data.bookId,
        params.data.runId,
      );
      if (!pendingChanges) {
        return jsonError(reply, 400, "No pending draft changes");
      }

      try {
        const selectedFiles = selectDraftChangeFiles(
          pendingChanges,
          body.data?.paths,
        );
        const conflicts = await draftChangeConflicts(
          params.data.bookId,
          selectedFiles,
        );
        if (conflicts.length > 0) {
          reply.code(409);
          return {
            ok: false,
            conflicts,
            pendingChanges,
          };
        }
        if (run) {
          await applyDraftChanges(run, selectedFiles);
        } else {
          await writeDraftFiles(params.data.bookId, selectedFiles);
        }
        const nextChanges = run
          ? run.pendingChanges
          : updateDraftChangeSetAfterAction(
              pendingChanges,
              selectedFiles,
              "applied",
            );
        return {
          ok: true,
          conflicts: [],
          pendingChanges: nextChanges,
        };
      } catch (err) {
        if (err instanceof InvalidIdError || err instanceof z.ZodError) {
          return jsonError(reply, 400, "Invalid input", err.message);
        }
        if (err instanceof NotFoundError) {
          return jsonError(reply, 404, "Not found");
        }
        if (err instanceof ConflictError) {
          reply.code(409);
          return {
            ok: false,
            conflicts:
              body.data?.paths ?? pendingChanges.files.map((file) => file.path),
            pendingChanges,
          };
        }
        app.log.error(err);
        return jsonError(reply, 500, "Internal error");
      }
    },
  );

  app.post(
    "/api/books/:bookId/ai-workspace-runs/:runId/changes/discard",
    async (req, reply) => {
      const params = RunParams.safeParse(req.params);
      if (!params.success) {
        return jsonError(reply, 400, "Invalid input", params.error.flatten());
      }
      const body = DraftChangeActionBody.safeParse(req.body);
      if (!body.success) {
        return jsonError(reply, 400, "Invalid input", body.error.flatten());
      }
      const liveRun = aiWorkspaceRuns.get(params.data.runId);
      if (liveRun && liveRun.bookId !== params.data.bookId) {
        return jsonError(reply, 404, "Not found");
      }
      const { run, pendingChanges } = await resolvePendingChangesForAction(
        params.data.bookId,
        params.data.runId,
      );
      if (!pendingChanges) {
        return jsonError(reply, 400, "No pending draft changes");
      }

      try {
        const selectedFiles = selectDraftChangeFiles(
          pendingChanges,
          body.data?.paths,
        );
        if (run) {
          discardDraftChanges(run, selectedFiles);
        }
        const nextChanges = run
          ? run.pendingChanges
          : updateDraftChangeSetAfterAction(
              pendingChanges,
              selectedFiles,
              "discarded",
            );
        return {
          ok: true,
          conflicts: [],
          pendingChanges: nextChanges,
        };
      } catch (err) {
        if (err instanceof InvalidIdError || err instanceof z.ZodError) {
          return jsonError(reply, 400, "Invalid input", err.message);
        }
        app.log.error(err);
        return jsonError(reply, 500, "Internal error");
      }
    },
  );

  app.post(
    "/api/books/:bookId/ai-workspace-runs/:runId/cancel",
    async (req, reply) => {
      const params = RunParams.safeParse(req.params);
      if (!params.success) {
        return jsonError(reply, 400, "Invalid input", params.error.flatten());
      }
      const run = aiWorkspaceRuns.get(params.data.runId);
      if (!run || run.bookId !== params.data.bookId) {
        return jsonError(reply, 404, "Not found");
      }
      if (run.status === "running") {
        run.abortController.abort();
        const now = new Date().toISOString();
        run.status = "cancelled";
        run.updatedAt = now;
        run.finishedAt = now;
      }
      return snapshotRun(run);
    },
  );
}
