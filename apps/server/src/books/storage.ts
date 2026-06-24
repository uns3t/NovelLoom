import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  AI_AGENT_ID_REGEX,
  type ArchiveCurrentOutlineResponse,
  BOOK_ID_REGEX,
  CURRENT_CHAPTER_OUTLINE_FILE,
  KNOWLEDGE_BASE_TYPE_META,
  type AiAgentConfig,
  type AiAgentsResponse,
  type AiSessionsResponse,
  type BookMeta,
  type CreateKnowledgeBaseItemRequest,
  type KnowledgeBaseItemDoc,
  type KnowledgeBaseItemSummary,
  type KnowledgeBaseItemType,
  MARKDOWN_MAX_LEN,
  NOVEL_SPEC_FILE,
  NOVEL_SPEC_TEMPLATE,
  OUTLINE_ARCHIVE_DIR,
  PLOT_FILE,
  PLOT_TEMPLATE,
  PROJECT_FILE_PATH_MAX_LEN,
  PROJECT_FILE_PATH_SEGMENT_MAX_LEN,
  PROJECT_FILE_PATH_REGEX,
  STYLE_SAMPLE_FILE,
  STYLE_SAMPLE_TEMPLATE,
  STORY_STATUS_FILE,
  STORY_STATUS_TEMPLATE,
  type ProjectFileDoc,
  type ProjectFileKind,
  type ProjectFileNode,
  type UpdateKnowledgeBaseItemRequest,
  type UpdateAiAgentsRequest,
  type UpdateAiSessionsRequest,
  knowledgeBaseTemplateFor,
} from "@novelloom/shared";
import { env } from "../env.js";

const MANAGED_METADATA_DIR = ".novelloom";
const AI_SESSIONS_FILE = "ai-sessions.json";
const AI_AGENTS_FILE = "agents.json";

const USER_IDEA_FILE = "idea.md";
const USER_IDEA_TEMPLATE = `# 用户思路

## 核心灵感

### 一句话想法

### 小说类型与基调

### 主角与核心冲突

### 核心卖点

### 特殊要求

## 可选补充

### 其他灵感碎片
`;

const NEW_BOOK_USER_IDEA_TEMPLATE = USER_IDEA_TEMPLATE;

const OUTLINE_DIR = "outline";
const OUTLINE_INDEX_FILE = "outline/index.md";
const KNOWLEDGE_BASE_TOTAL_CONTEXT_MAX_LEN = 120_000;
const OUTLINE_INDEX_TEMPLATE = `# 大纲索引

这里记录章节序号、章节标题与每章摘要。即将生成正文的章节细纲写在 \`${CURRENT_CHAPTER_OUTLINE_FILE}\`。

## 章节摘要

- 第 1 章：
  - 标题：
  - 摘要：
`;

const CURRENT_CHAPTER_OUTLINE_TEMPLATE = `# 当前章节细纲

> 这里只保存即将生成正文的章节细纲。生成或确认正文后，可按需要覆盖为下一章细纲；长期进度请同步到 \`${STORY_STATUS_FILE}\`。

## 目标章节

- 章节编号：
- 章节标题：
- 对应正文文件：

## 本章功能

- 剧情目标：
- 人物变化：
- 伏笔/回收：

## 场景节拍

1. 

## 与前后文衔接

- 承接：
- 推向：
`;

export class InvalidIdError extends Error {
  constructor(message = "Invalid id") {
    super(message);
    this.name = "InvalidIdError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

/* -------------------------------------------------------------------------- */
/* Path helpers                                                               */
/* -------------------------------------------------------------------------- */

function assertValidId(id: string): void {
  if (!BOOK_ID_REGEX.test(id)) {
    throw new InvalidIdError(`Invalid id: ${id}`);
  }
}

function assertWithinBooksDir(p: string): void {
  const resolved = path.resolve(p);
  const root = path.resolve(env.BOOKS_DIR);
  const relative = path.relative(root, resolved);
  if (relative && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new InvalidIdError("Path escapes BOOKS_DIR");
  }
}

function bookDir(bookId: string): string {
  assertValidId(bookId);
  const p = path.join(env.BOOKS_DIR, bookId);
  assertWithinBooksDir(p);
  return p;
}

function bookJsonPath(bookId: string): string {
  return path.join(bookDir(bookId), "book.json");
}

function managedMetadataDir(bookId: string): string {
  const p = path.join(bookDir(bookId), MANAGED_METADATA_DIR);
  assertWithinBooksDir(p);
  return p;
}

function globalManagedMetadataDir(): string {
  const p = path.join(env.BOOKS_DIR, MANAGED_METADATA_DIR);
  assertWithinBooksDir(p);
  return p;
}

function aiSessionsPath(bookId: string): string {
  return path.join(managedMetadataDir(bookId), AI_SESSIONS_FILE);
}

function aiAgentsPath(): string {
  return path.join(globalManagedMetadataDir(), AI_AGENTS_FILE);
}

function normalizeProjectPath(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, "/").trim();
  if (
    normalized.length === 0 ||
    normalized.length > PROJECT_FILE_PATH_MAX_LEN ||
    !PROJECT_FILE_PATH_REGEX.test(normalized)
  ) {
    throw new InvalidIdError(`Invalid project file path: ${projectPath}`);
  }
  if (normalized === "book.json") {
    throw new InvalidIdError("book.json is managed by the book API");
  }
  if (normalized === MANAGED_METADATA_DIR || normalized.startsWith(`${MANAGED_METADATA_DIR}/`)) {
    throw new InvalidIdError(`${MANAGED_METADATA_DIR} is managed by NovelLoom`);
  }
  return normalized;
}

function projectFilePath(bookId: string, projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  const p = path.resolve(bookDir(bookId), ...normalized.split("/"));
  const root = path.resolve(bookDir(bookId));
  if (p !== root && !p.startsWith(root + path.sep)) {
    throw new InvalidIdError("Path escapes book directory");
  }
  return p;
}

function projectRelativePath(baseDir: string, absolutePath: string): string {
  return path.relative(baseDir, absolutePath).split(path.sep).join("/");
}

function contentTypeForPath(projectPath: string): string {
  if (projectPath.endsWith(".md")) return "text/markdown";
  if (projectPath.endsWith(".json")) return "application/json";
  return "text/plain";
}

function isMarkdownPath(projectPath: string): boolean {
  return projectPath.toLowerCase().endsWith(".md");
}

function titleFromMarkdown(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+?)\s*$/m);
  return match?.[1]?.trim() || fallback;
}

function countMarkdownWords(content: string): number {
  const plain = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[[^\]]*]\([^)]*\)/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[*_~#>`[\](){}|\\-]/g, "");
  return Array.from(plain).filter((char) => !/\s/.test(char)).length;
}

function compactTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

async function markdownWordCountForFile(
  absolutePath: string,
  projectPath: string,
): Promise<number | undefined> {
  if (!isMarkdownPath(projectPath)) return undefined;
  const content = await fs.readFile(absolutePath, "utf8");
  return countMarkdownWords(content);
}

/* -------------------------------------------------------------------------- */
/* Slugify + id generation                                                    */
/* -------------------------------------------------------------------------- */

function slugify(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  if (s.length > 40) s = s.slice(0, 40);
  s = s.replace(/^-+|-+$/g, "");
  if (!BOOK_ID_REGEX.test(s)) {
    return "book";
  }
  return s;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function uniqueBookId(title: string): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  while (await pathExists(path.join(env.BOOKS_DIR, candidate))) {
    const suffix = crypto.randomBytes(2).toString("hex");
    let next = `${base}-${suffix}`;
    if (next.length > 64) {
      next = next.slice(0, 64).replace(/-+$/g, "");
      if (!BOOK_ID_REGEX.test(next)) next = `book-${suffix}`;
    }
    candidate = next;
  }
  if (!BOOK_ID_REGEX.test(candidate)) {
    throw new InvalidIdError(`Generated id invalid: ${candidate}`);
  }
  return candidate;
}

/* -------------------------------------------------------------------------- */
/* Book meta IO                                                               */
/* -------------------------------------------------------------------------- */

async function readBookMeta(bookId: string): Promise<BookMeta> {
  const p = bookJsonPath(bookId);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`Book not found: ${bookId}`);
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as Omit<BookMeta, "path">;
  return withBookPath(parsed);
}

async function writeBookMeta(meta: BookMeta): Promise<void> {
  const p = bookJsonPath(meta.id);
  const storedMeta = {
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
  await fs.writeFile(p, JSON.stringify(storedMeta, null, 2) + "\n", "utf8");
}

function withBookPath(meta: Omit<BookMeta, "path">): BookMeta {
  return {
    ...meta,
    path: bookDir(meta.id),
  };
}

async function touchBook(bookId: string): Promise<BookMeta> {
  const meta = await readBookMeta(bookId);
  meta.updatedAt = new Date().toISOString();
  await writeBookMeta(meta);
  return meta;
}

async function ensureDefaultProjectFiles(bookId: string): Promise<void> {
  const ideaPath = projectFilePath(bookId, USER_IDEA_FILE);
  if (!(await pathExists(ideaPath))) {
    await fs.writeFile(ideaPath, USER_IDEA_TEMPLATE, "utf8");
  }
  const novelSpecPath = projectFilePath(bookId, NOVEL_SPEC_FILE);
  if (!(await pathExists(novelSpecPath))) {
    await fs.writeFile(novelSpecPath, NOVEL_SPEC_TEMPLATE, "utf8");
  }
  const styleSamplePath = projectFilePath(bookId, STYLE_SAMPLE_FILE);
  if (!(await pathExists(styleSamplePath))) {
    await fs.writeFile(styleSamplePath, STYLE_SAMPLE_TEMPLATE, "utf8");
  }
}

/* -------------------------------------------------------------------------- */
/* Knowledge base helpers                                                     */
/* -------------------------------------------------------------------------- */

function knowledgeBaseDirForType(type: KnowledgeBaseItemType): string {
  return KNOWLEDGE_BASE_TYPE_META[type].dir;
}

function assertKnowledgeBaseType(type: string): asserts type is KnowledgeBaseItemType {
  if (!Object.prototype.hasOwnProperty.call(KNOWLEDGE_BASE_TYPE_META, type)) {
    throw new InvalidIdError(`Invalid knowledge base type: ${type}`);
  }
}

function safeKnowledgeBaseSegment(input: string): string {
  const trimmed = input.trim();
  const normalized = trimmed
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "")
    .trim()
    .slice(0, PROJECT_FILE_PATH_SEGMENT_MAX_LEN);
  const cleaned = normalized.replace(/^\.+$|^$/u, "资料卡");
  return cleaned || "资料卡";
}

function defaultAiAgents(now: string): AiAgentConfig[] {
  return [
    {
      id: "default",
      name: "默认",
      description: "通用小说创作 Agent，适合不限定题材时协助构思、整理、续写和修改。",
      systemPrompt: [
        "你是 NovelLoom 的通用小说创作 Agent，适合各种题材和创作阶段。",
        "你可以帮助用户整理灵感、剧情规划、资料卡、大纲、细纲、审阅问题、续写正文和润色改写。",
        "需要上下文时，先读取资料库和项目文件；不要把未读取内容当作事实。",
        "剧情走向和伏笔计划沉淀到 plot.md；设定变化沉淀到 library/ 资料卡；进度变化沉淀到 story-status.md。",
        "目标清楚时直接给出可用内容；目标不清楚时最多先问 3 个必要问题。",
      ].join("\n"),
      enabled: true,
      builtIn: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "xianxia-weaver",
      name: "仙侠玄幻",
      description: "适合仙侠、玄幻、东方奇幻故事，强调修行体系、宗门势力、因果宿命与宏大升级线。",
      systemPrompt: [
        "你是仙侠玄幻题材小说创作 Agent，擅长修行体系、宗门势力、秘境机缘和升级线。",
        "创作时优先保证力量体系自洽、机缘有铺垫、突破有代价、世界规则前后一致。",
        "主线、阶段升级、机缘伏笔和反转计划优先沉淀到 plot.md。",
        "修行体系、势力、法宝、秘境等关键设定应沉淀到资料库对应卡片。",
        "避免空泛堆名词、无代价开挂和只为爽点牺牲人物动机。",
        "先读资料库和项目文件，再设计大纲、场景或正文；信息不足时最多问 3 个必要问题。",
      ].join("\n"),
      enabled: true,
      builtIn: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "urban-suspense",
      name: "都市悬疑",
      description: "适合都市、悬疑、犯罪、现实向故事，强调谜题、线索、反转、人物秘密和现实压力。",
      systemPrompt: [
        "你是都市悬疑题材小说创作 Agent，擅长谜题、线索链、人物秘密和反转设计。",
        "创作时优先保证线索公平、因果闭环、现实可信和误导信息可回溯。",
        "谜题链、线索、误导和反转计划优先沉淀到 plot.md。",
        "人物秘密、关键证据、特殊物品状态必须与资料库一致；变化时提示更新资料卡。",
        "避免为了反转牺牲逻辑，或让角色突然降智来推进剧情。",
        "先读资料库和相关正文，再输出推理链、大纲、章节设计或正文片段。",
      ].join("\n"),
      enabled: true,
      builtIn: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function normalizeActiveAgentId(
  agents: AiAgentConfig[],
  activeAgentId: string | null | undefined,
): string | null {
  if (
    activeAgentId &&
    agents.some((agent) => agent.id === activeAgentId && agent.enabled)
  ) {
    return activeAgentId;
  }
  return agents.find((agent) => agent.enabled)?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function isKnowledgeBaseCharacterPath(projectPath: string): boolean {
  const normalized = normalizeProjectPath(projectPath);
  const characterDir = KNOWLEDGE_BASE_TYPE_META.character.dir;
  return normalized.startsWith(`${characterDir}/`) && normalized.endsWith(".md");
}

export function isOutlineArchivePath(projectPath: string): boolean {
  const normalized = normalizeProjectPath(projectPath);
  return (
    normalized === OUTLINE_ARCHIVE_DIR ||
    normalized.startsWith(`${OUTLINE_ARCHIVE_DIR}/`)
  );
}

export function knowledgeBaseTypeFromString(type: string): KnowledgeBaseItemType {
  assertKnowledgeBaseType(type);
  return type;
}

export async function ensureKnowledgeBase(bookId: string): Promise<void> {
  await readBookMeta(bookId);
  for (const meta of Object.values(KNOWLEDGE_BASE_TYPE_META)) {
    await fs.mkdir(projectFilePath(bookId, meta.dir), { recursive: true });
  }
}

function knowledgeBasePathFromId(
  type: KnowledgeBaseItemType,
  id: string,
): string {
  const safeId = normalizeProjectPath(id.endsWith(".md") ? id : `${id}.md`);
  if (safeId.includes("/")) {
    throw new InvalidIdError(`Invalid knowledge base item id: ${id}`);
  }
  return `${knowledgeBaseDirForType(type)}/${safeId}`;
}

async function uniqueKnowledgeBasePath(
  bookId: string,
  type: KnowledgeBaseItemType,
  title: string,
  excludePath?: string,
): Promise<string> {
  const base = safeKnowledgeBaseSegment(title).replace(/\.md$/i, "");
  const dir = knowledgeBaseDirForType(type);
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = `${dir}/${base}${suffix}.md`;
    if (candidate === excludePath || !(await pathExists(projectFilePath(bookId, candidate)))) {
      return candidate;
    }
  }
  throw new ConflictError(`Cannot create unique knowledge base item path for: ${title}`);
}

function knowledgeBaseSummaryFromDoc(
  type: KnowledgeBaseItemType,
  doc: ProjectFileDoc,
  wordCount?: number,
): KnowledgeBaseItemSummary {
  const id = path.basename(doc.path, ".md");
  return {
    id,
    type,
    title: titleFromMarkdown(doc.content, id),
    path: doc.path,
    updatedAt: doc.updatedAt,
    wordCount,
  };
}

export async function listKnowledgeBaseItems(
  bookId: string,
  type?: KnowledgeBaseItemType,
): Promise<KnowledgeBaseItemSummary[]> {
  await ensureKnowledgeBase(bookId);
  const root = bookDir(bookId);
  const types = type ? [type] : (Object.keys(KNOWLEDGE_BASE_TYPE_META) as KnowledgeBaseItemType[]);
  const items: KnowledgeBaseItemSummary[] = [];

  for (const itemType of types) {
    const dir = projectFilePath(bookId, knowledgeBaseDirForType(itemType));
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith(".md")) continue;
      const absolutePath = path.join(dir, entry);
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) continue;
      const relative = projectRelativePath(root, absolutePath);
      const content = await fs.readFile(absolutePath, "utf8");
      items.push({
        id: path.basename(relative, ".md"),
        type: itemType,
        title: titleFromMarkdown(content, path.basename(relative, ".md")),
        path: relative,
        updatedAt: stat.mtime.toISOString(),
        wordCount: countMarkdownWords(content),
      });
    }
  }

  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.title.localeCompare(b.title);
  });
}

export async function readKnowledgeBaseItem(
  bookId: string,
  type: KnowledgeBaseItemType,
  id: string,
): Promise<KnowledgeBaseItemDoc> {
  await ensureKnowledgeBase(bookId);
  const doc = await readProjectFile(bookId, knowledgeBasePathFromId(type, id));
  return {
    ...knowledgeBaseSummaryFromDoc(type, doc, countMarkdownWords(doc.content)),
    content: doc.content,
    updatedAt: doc.updatedAt,
  };
}

export async function createKnowledgeBaseItem(
  bookId: string,
  request: CreateKnowledgeBaseItemRequest,
): Promise<KnowledgeBaseItemDoc> {
  await ensureKnowledgeBase(bookId);
  const title = request.title.trim();
  if (!title) throw new InvalidIdError("Knowledge base item title is required");
  const targetPath = await uniqueKnowledgeBasePath(bookId, request.type, title);
  await createProjectEntry(
    bookId,
    targetPath,
    "file",
    knowledgeBaseTemplateFor(request.type, title),
  );
  return await readKnowledgeBaseItem(bookId, request.type, path.basename(targetPath, ".md"));
}

export async function updateKnowledgeBaseItem(
  bookId: string,
  type: KnowledgeBaseItemType,
  id: string,
  request: UpdateKnowledgeBaseItemRequest,
): Promise<KnowledgeBaseItemDoc> {
  await ensureKnowledgeBase(bookId);
  const title = request.title.trim();
  if (!title) throw new InvalidIdError("Knowledge base item title is required");
  const currentPath = knowledgeBasePathFromId(type, id);
  const targetPath = await uniqueKnowledgeBasePath(bookId, type, title, currentPath);
  const finalPath = targetPath === currentPath ? currentPath : targetPath;
  if (finalPath !== currentPath) {
    await renameProjectEntry(bookId, currentPath, finalPath);
  }
  await writeProjectFile(bookId, finalPath, request.content);
  return await readKnowledgeBaseItem(bookId, type, path.basename(finalPath, ".md"));
}

export async function deleteKnowledgeBaseItem(
  bookId: string,
  type: KnowledgeBaseItemType,
  id: string,
): Promise<void> {
  await ensureKnowledgeBase(bookId);
  await deleteProjectEntry(bookId, knowledgeBasePathFromId(type, id), false);
}

export async function readAllKnowledgeBaseDocs(bookId: string): Promise<KnowledgeBaseItemDoc[]> {
  const summaries = await listKnowledgeBaseItems(bookId);
  const docs: KnowledgeBaseItemDoc[] = [];
  let totalLength = 0;
  for (const summary of summaries) {
    const doc = await readKnowledgeBaseItem(bookId, summary.type, summary.id);
    totalLength += doc.content.length;
    if (totalLength > KNOWLEDGE_BASE_TOTAL_CONTEXT_MAX_LEN) {
      throw new InvalidIdError("资料库内容过大，请先精简资料卡后再进行人物对话");
    }
    docs.push(doc);
  }
  return docs;
}

export async function listBooks(): Promise<BookMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(env.BOOKS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const books: BookMeta[] = [];
  for (const name of entries) {
    if (!BOOK_ID_REGEX.test(name)) continue;
    const dir = path.join(env.BOOKS_DIR, name);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    try {
      const raw = await fs.readFile(path.join(dir, "book.json"), "utf8");
      books.push(withBookPath(JSON.parse(raw) as Omit<BookMeta, "path">));
    } catch {
      // skip directories without a valid book.json
    }
  }
  books.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return books;
}

export async function readAiAgents(): Promise<AiAgentsResponse> {
  const p = aiAgentsPath();
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const now = new Date().toISOString();
      const agents = defaultAiAgents(now);
      return {
        agents,
        activeAgentId: normalizeActiveAgentId(agents, agents[0]?.id),
        updatedAt: null,
      };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidIdError("AI agents config is invalid");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidIdError("AI agents config is invalid");
  }

  const config = parsed as Partial<AiAgentsResponse>;
  const agents = Array.isArray(config.agents)
    ? config.agents.filter((agent): agent is AiAgentConfig => {
        return Boolean(
          agent &&
            typeof agent === "object" &&
            "id" in agent &&
            typeof agent.id === "string" &&
            AI_AGENT_ID_REGEX.test(agent.id),
        );
      })
    : [];
  return {
    agents,
    activeAgentId: normalizeActiveAgentId(
      agents,
      typeof config.activeAgentId === "string" ? config.activeAgentId : null,
    ),
    updatedAt: typeof config.updatedAt === "string" ? config.updatedAt : null,
  };
}

export async function writeAiAgents(
  payload: UpdateAiAgentsRequest,
): Promise<AiAgentsResponse> {
  const now = new Date().toISOString();
  const agents = payload.agents.map((agent) => ({
    ...agent,
    updatedAt: agent.updatedAt || now,
    createdAt: agent.createdAt || now,
  }));
  const config: AiAgentsResponse = {
    agents,
    activeAgentId: normalizeActiveAgentId(agents, payload.activeAgentId),
    updatedAt: now,
  };
  const dir = globalManagedMetadataDir();
  await fs.mkdir(dir, { recursive: true });
  const target = aiAgentsPath();
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
  await fs.rename(tmp, target);
  return config;
}

export async function readAiAgentById(
  agentId?: string | null,
): Promise<AiAgentConfig | null> {
  const config = await readAiAgents();
  const selectedId = agentId ?? config.activeAgentId;
  if (!selectedId) return null;
  return config.agents.find((agent) => agent.id === selectedId && agent.enabled) ?? null;
}

export async function readAiSessions(bookId: string): Promise<AiSessionsResponse> {
  await readBookMeta(bookId);
  const p = aiSessionsPath(bookId);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { sessions: [], activeSessionId: null, updatedAt: null };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidIdError("AI session history is invalid");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidIdError("AI session history is invalid");
  }

  const history = parsed as Partial<AiSessionsResponse>;
  return {
    sessions: Array.isArray(history.sessions) ? history.sessions : [],
    activeSessionId: typeof history.activeSessionId === "string" ? history.activeSessionId : null,
    updatedAt: typeof history.updatedAt === "string" ? history.updatedAt : null,
  };
}

export async function writeAiSessions(
  bookId: string,
  payload: UpdateAiSessionsRequest,
): Promise<AiSessionsResponse> {
  await readBookMeta(bookId);
  const now = new Date().toISOString();
  const history: AiSessionsResponse = {
    sessions: payload.sessions,
    activeSessionId: payload.activeSessionId,
    updatedAt: now,
  };
  const dir = managedMetadataDir(bookId);
  await fs.mkdir(dir, { recursive: true });
  const target = aiSessionsPath(bookId);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(history, null, 2) + "\n", "utf8");
  await fs.rename(tmp, target);
  return history;
}

export async function createBook(title: string): Promise<BookMeta> {
  const id = await uniqueBookId(title);
  const dir = path.join(env.BOOKS_DIR, id);
  assertWithinBooksDir(dir);
  await fs.mkdir(dir, { recursive: false });
  await fs.mkdir(path.join(dir, "chapters"), { recursive: false });
  await fs.mkdir(path.join(dir, OUTLINE_DIR), { recursive: false });
  for (const meta of Object.values(KNOWLEDGE_BASE_TYPE_META)) {
    await fs.mkdir(path.join(dir, meta.dir), { recursive: true });
  }
  const now = new Date().toISOString();
  const meta: BookMeta = {
    id,
    title,
    path: dir,
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(
    path.join(dir, "book.json"),
    JSON.stringify({ id, title, createdAt: now, updatedAt: now }, null, 2) + "\n",
    "utf8",
  );
  await fs.writeFile(path.join(dir, OUTLINE_INDEX_FILE), OUTLINE_INDEX_TEMPLATE, "utf8");
  await fs.writeFile(
    path.join(dir, CURRENT_CHAPTER_OUTLINE_FILE),
    CURRENT_CHAPTER_OUTLINE_TEMPLATE,
    "utf8",
  );
  await fs.writeFile(path.join(dir, NOVEL_SPEC_FILE), NOVEL_SPEC_TEMPLATE, "utf8");
  await fs.writeFile(path.join(dir, STYLE_SAMPLE_FILE), STYLE_SAMPLE_TEMPLATE, "utf8");
  await fs.writeFile(path.join(dir, PLOT_FILE), PLOT_TEMPLATE, "utf8");
  await fs.writeFile(path.join(dir, USER_IDEA_FILE), NEW_BOOK_USER_IDEA_TEMPLATE, "utf8");
  await fs.writeFile(path.join(dir, STORY_STATUS_FILE), STORY_STATUS_TEMPLATE, "utf8");
  return meta;
}

async function uniqueOutlineArchivePath(bookId: string): Promise<string> {
  const base = `${OUTLINE_ARCHIVE_DIR}/current-${compactTimestamp(new Date())}`;
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = `${base}${suffix}.md`;
    if (!(await pathExists(projectFilePath(bookId, candidate)))) {
      return candidate;
    }
  }
  throw new ConflictError("Cannot create unique current outline archive path");
}

export async function archiveCurrentChapterOutline(
  bookId: string,
): Promise<ArchiveCurrentOutlineResponse> {
  await readBookMeta(bookId);
  const current = await readProjectFile(bookId, CURRENT_CHAPTER_OUTLINE_FILE);
  const archivedPath = await uniqueOutlineArchivePath(bookId);
  const archiveAbsolutePath = projectFilePath(bookId, archivedPath);
  await fs.mkdir(path.dirname(archiveAbsolutePath), { recursive: true });
  await fs.writeFile(archiveAbsolutePath, current.content, "utf8");
  await touchBook(bookId);
  const stat = await fs.stat(archiveAbsolutePath);
  return {
    archivedPath,
    sourcePath: CURRENT_CHAPTER_OUTLINE_FILE,
    updatedAt: stat.mtime.toISOString(),
  };
}

export async function renameBook(
  bookId: string,
  title: string,
): Promise<BookMeta> {
  const meta = await readBookMeta(bookId);
  meta.title = title;
  meta.updatedAt = new Date().toISOString();
  await writeBookMeta(meta);
  return meta;
}

export async function deleteBook(bookId: string): Promise<void> {
  const dir = bookDir(bookId);
  if (!(await pathExists(dir))) {
    throw new NotFoundError(`Book not found: ${bookId}`);
  }
  await fs.rm(dir, { recursive: true, force: true });
}

export async function listProjectFiles(bookId: string): Promise<ProjectFileNode[]> {
  await readBookMeta(bookId);
  await ensureDefaultProjectFiles(bookId);
  const root = bookDir(bookId);

  async function readNode(absolutePath: string): Promise<ProjectFileNode | null> {
    const name = path.basename(absolutePath);
    if (name === "book.json") return null;
    if (name === MANAGED_METADATA_DIR && path.dirname(absolutePath) === root) return null;

    const stat = await fs.stat(absolutePath);
    const relative = projectRelativePath(root, absolutePath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(absolutePath);
      const children = (
        await Promise.all(
          entries.map((entry) => readNode(path.join(absolutePath, entry))),
        )
      )
        .filter((node): node is ProjectFileNode => node !== null)
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return {
        name,
        path: relative,
        kind: "directory",
        children,
        updatedAt: stat.mtime.toISOString(),
      };
    }
    if (!stat.isFile()) return null;
    return {
      name,
      path: relative,
      kind: "file",
      sizeBytes: stat.size,
      wordCount: await markdownWordCountForFile(absolutePath, relative),
      updatedAt: stat.mtime.toISOString(),
    };
  }

  const entries = await fs.readdir(root);
  const nodes = (
    await Promise.all(entries.map((entry) => readNode(path.join(root, entry))))
  )
    .filter((node): node is ProjectFileNode => node !== null)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return nodes;
}

export async function readProjectFile(
  bookId: string,
  projectPath: string,
): Promise<ProjectFileDoc> {
  await readBookMeta(bookId);
  const normalized = normalizeProjectPath(projectPath);
  const filePath = projectFilePath(bookId, normalized);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`File not found: ${normalized}`);
    }
    throw err;
  }
  if (!stat.isFile()) {
    throw new NotFoundError(`File not found: ${normalized}`);
  }
  return {
    name: path.basename(normalized),
    path: normalized,
    content: await fs.readFile(filePath, "utf8"),
    contentType: contentTypeForPath(normalized),
    updatedAt: stat.mtime.toISOString(),
  };
}

export async function writeProjectFile(
  bookId: string,
  projectPath: string,
  content: string,
): Promise<ProjectFileDoc> {
  if (content.length > MARKDOWN_MAX_LEN) {
    throw new InvalidIdError("File content is too large");
  }
  await readBookMeta(bookId);
  const normalized = normalizeProjectPath(projectPath);
  const filePath = projectFilePath(bookId, normalized);
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new NotFoundError(`File not found: ${normalized}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`File not found: ${normalized}`);
    }
    throw err;
  }
  await fs.writeFile(filePath, content, "utf8");
  await touchBook(bookId);
  return await readProjectFile(bookId, normalized);
}

export async function upsertProjectFile(
  bookId: string,
  projectPath: string,
  content: string,
): Promise<ProjectFileDoc> {
  if (content.length > MARKDOWN_MAX_LEN) {
    throw new InvalidIdError("File content is too large");
  }
  await readBookMeta(bookId);
  const normalized = normalizeProjectPath(projectPath);
  const filePath = projectFilePath(bookId, normalized);
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new ConflictError(`Project path is not a file: ${normalized}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }
  await fs.writeFile(filePath, content, "utf8");
  await touchBook(bookId);
  return await readProjectFile(bookId, normalized);
}

export async function createProjectEntry(
  bookId: string,
  projectPath: string,
  kind: ProjectFileKind,
  content = "",
): Promise<ProjectFileNode> {
  if (content.length > MARKDOWN_MAX_LEN) {
    throw new InvalidIdError("File content is too large");
  }
  await readBookMeta(bookId);
  const normalized = normalizeProjectPath(projectPath);
  const target = projectFilePath(bookId, normalized);
  if (await pathExists(target)) {
    throw new ConflictError(`Project path already exists: ${normalized}`);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (kind === "directory") {
    await fs.mkdir(target);
  } else {
    await fs.writeFile(target, content, "utf8");
  }
  await touchBook(bookId);
  const stat = await fs.stat(target);
  return {
    name: path.basename(normalized),
    path: normalized,
    kind,
    children: kind === "directory" ? [] : undefined,
    sizeBytes: kind === "file" ? stat.size : undefined,
    wordCount:
      kind === "file" ? await markdownWordCountForFile(target, normalized) : undefined,
    updatedAt: stat.mtime.toISOString(),
  };
}

export async function renameProjectEntry(
  bookId: string,
  fromPath: string,
  toPath: string,
): Promise<ProjectFileNode> {
  await readBookMeta(bookId);
  const fromNormalized = normalizeProjectPath(fromPath);
  const toNormalized = normalizeProjectPath(toPath);
  const from = projectFilePath(bookId, fromNormalized);
  const to = projectFilePath(bookId, toNormalized);
  if (!(await pathExists(from))) {
    throw new NotFoundError(`Project path not found: ${fromNormalized}`);
  }
  if (await pathExists(to)) {
    throw new ConflictError(`Project path already exists: ${toNormalized}`);
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  await touchBook(bookId);
  const stat = await fs.stat(to);
  const kind: ProjectFileKind = stat.isDirectory() ? "directory" : "file";
  return {
    name: path.basename(toNormalized),
    path: toNormalized,
    kind,
    children: kind === "directory" ? [] : undefined,
    sizeBytes: kind === "file" ? stat.size : undefined,
    wordCount:
      kind === "file" ? await markdownWordCountForFile(to, toNormalized) : undefined,
    updatedAt: stat.mtime.toISOString(),
  };
}

export async function deleteProjectEntry(
  bookId: string,
  projectPath: string,
  recursive = false,
): Promise<void> {
  await readBookMeta(bookId);
  const normalized = normalizeProjectPath(projectPath);
  const target = projectFilePath(bookId, normalized);
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      await fs.rm(target, { recursive, force: false });
    } else {
      await fs.unlink(target);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`Project path not found: ${normalized}`);
    }
    throw err;
  }
  await touchBook(bookId);
}
