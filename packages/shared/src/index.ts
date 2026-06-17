/**
 * Shared protocol types between NovelLoom frontend (apps/web)
 * and backend (apps/server).
 */

/* -------------------------------------------------------------------------- */
/* Book management                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Allowed pattern for book / chapter ids: lowercase letters, digits and
 * dashes; 1..64 chars; must start with an alphanumeric.
 */
export const BOOK_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Maximum length for a book / chapter title (in characters). */
export const TITLE_MAX_LEN = 200;

/** Maximum length for a markdown body (in characters). */
export const MARKDOWN_MAX_LEN = 200_000;

/** Metadata for a single book stored under <BOOKS_DIR>/<id>/book.json. */
export interface BookMeta {
  id: string;
  title: string;
  /** Absolute filesystem path for this book project. */
  path: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}

/* ----- Request bodies ----- */

export interface CreateBookRequest {
  title: string;
}

export interface UpdateBookRequest {
  title: string;
}

/* -------------------------------------------------------------------------- */
/* Flexible writing workbench                                                 */
/* -------------------------------------------------------------------------- */

/** Maximum length for a project-relative file path (in characters). */
export const PROJECT_FILE_PATH_MAX_LEN = 512;

/** Maximum length for one project-relative path segment (in characters). */
export const PROJECT_FILE_PATH_SEGMENT_MAX_LEN = 128;

/**
 * Project-relative path validation:
 * - use forward slashes only
 * - no absolute paths, empty segments, trailing slash, "." or ".."
 * - each segment may contain Unicode letters, digits, spaces, ".", "_", "-"
 */
export const PROJECT_FILE_PATH_REGEX =
  /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\/$)[\p{L}\p{N}._ -]+(?:\/[\p{L}\p{N}._ -]+)*$/u;

/** File-like entries that can be edited in the workbench. */
export type ProjectFileKind = "file" | "directory";

/** Root-level Markdown file for stable per-book writing rules. */
export const NOVEL_SPEC_FILE = "novel-spec.md";

/** Root-level Markdown file for long-running plot planning. */
export const PLOT_FILE = "plot.md";

/** Project-relative Markdown file for the currently planned chapter outline. */
export const CURRENT_CHAPTER_OUTLINE_FILE = "outline/current.md";

/** User-visible outline archive directory that AI tools must not read. */
export const OUTLINE_ARCHIVE_DIR = "outline/archive";

/** Default lightweight per-book writing rules template. */
export const NOVEL_SPEC_TEMPLATE = `# 创作规格

> 这是本书的长期写作规格。初始灵感写在 \`idea.md\`，剧情规划写在 \`${PLOT_FILE}\`，进度写在 \`story-status.md\`，章节数量、单章字数、文风和结构规则写在本文件，人物和世界观事实写在 \`library/\`。

## 结构

- 叙事类型：连续长篇 / 单元剧 / 混合结构
- 预计章节数：
- 单章目标字数：

## 文风

- 目标风格：
- 必须避免：
- 参考样本：

## 创意规则

- 人物行为必须符合：
- 世界规则/限制：
- 要避开的套路：

## AI 写作要求

- 生成前先读取本文件、\`${PLOT_FILE}\`、\`story-status.md\`、相关资料库和大纲。
- 正文应遵守结构、文风和创意规则。
- 改变剧情规划、进度或设定时，同步更新对应文件。
`;

/** Default long-running plot planning template shared by frontend and backend. */
export const PLOT_TEMPLATE = `# 剧情规划

> 这里管理长期剧情走向、剧情点子、主线支线、伏笔回收和待确认剧情问题。创作规格写在 \`${NOVEL_SPEC_FILE}\`，原始灵感写在 \`idea.md\`，当前进度写在 \`story-status.md\`，章节摘要写在 \`outline/index.md\`，当前章节细纲写在 \`${CURRENT_CHAPTER_OUTLINE_FILE}\`。

## 故事主线

- 核心问题：
- 主角长期目标：
- 主要阻力：
- 终局方向：

## 阶段规划

### 第一阶段

- 阶段目标：
- 关键冲突：
- 重要转折：
- 阶段结局：

## 支线与人物线

- 支线名称：
  - 关联人物：
  - 当前计划：
  - 与主线关系：

## 伏笔与回收

- 伏笔：
  - 埋设位置：
  - 回收计划：
  - 当前状态：

## 剧情点子池

- 点子：
  - 用途：
  - 可放置位置：
  - 取舍原因：

## 冲突、反转与悬念

- 冲突：
- 反转：
- 悬念：

## 待确认

- 
`;

/** Root-level Markdown file for tracking current writing progress and continuity. */
export const STORY_STATUS_FILE = "story-status.md";

/** Default lightweight writing snapshot shared by frontend and backend. */
export const STORY_STATUS_TEMPLATE = `# 创作状态

> 只记录当前创作快照，帮助用户和 AI 快速接上进度。详细设定、大纲和正文请写在对应文件中。

## 当前进度

- 已完成：
- 正在处理：
- 下一步：

## 最近上下文

- 最新章节/细纲：
- 当前停在：
- 需要延续：

## 注意事项

- 待确认：
- 暂不要改：
- 最后同步：
`;

/** Node in a book project's file tree. */
export interface ProjectFileNode {
  name: string;
  /** Project-relative path using forward slashes, e.g. "chapters/001.md". */
  path: string;
  kind: ProjectFileKind;
  children?: ProjectFileNode[];
  sizeBytes?: number;
  /** Character count for markdown-like files. */
  wordCount?: number;
  /** ISO timestamp. */
  updatedAt?: string;
}

/** Text document stored inside a book project. */
export interface ProjectFileDoc {
  name: string;
  /** Project-relative path using forward slashes. */
  path: string;
  content: string;
  /** MIME type or content hint, e.g. "text/markdown". */
  contentType?: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export interface ArchiveCurrentOutlineResponse {
  archivedPath: string;
  sourcePath: typeof CURRENT_CHAPTER_OUTLINE_FILE;
  /** ISO timestamp. */
  updatedAt: string;
}

export type ProjectFileOperation =
  | {
      type: "create_file";
      path: string;
      content?: string;
    }
  | {
      type: "create_directory";
      path: string;
    }
  | {
      type: "write_file";
      path: string;
      content: string;
    }
  | {
      type: "rename";
      fromPath: string;
      toPath: string;
    }
  | {
      type: "delete";
      path: string;
      recursive?: boolean;
    };

export interface UpdateProjectFileRequest {
  content: string;
}

export interface CreateProjectFileRequest {
  path: string;
  kind: ProjectFileKind;
  content?: string;
}

export interface RenameProjectFileRequest {
  toPath: string;
}

/* -------------------------------------------------------------------------- */
/* Knowledge base                                                             */
/* -------------------------------------------------------------------------- */

export const KNOWLEDGE_BASE_DIR = "library";

export type KnowledgeBaseItemType = "character" | "world" | "item";

export interface KnowledgeBaseTypeMeta {
  type: KnowledgeBaseItemType;
  dir: string;
  label: string;
  singularLabel: string;
}

export const KNOWLEDGE_BASE_TYPE_META: Record<
  KnowledgeBaseItemType,
  KnowledgeBaseTypeMeta
> = {
  character: {
    type: "character",
    dir: `${KNOWLEDGE_BASE_DIR}/characters`,
    label: "人物设定",
    singularLabel: "人物",
  },
  world: {
    type: "world",
    dir: `${KNOWLEDGE_BASE_DIR}/world`,
    label: "世界观设定",
    singularLabel: "世界观",
  },
  item: {
    type: "item",
    dir: `${KNOWLEDGE_BASE_DIR}/items`,
    label: "特殊物品设定",
    singularLabel: "物品",
  },
};

export const KNOWLEDGE_BASE_ITEM_TYPES = Object.keys(
  KNOWLEDGE_BASE_TYPE_META,
) as KnowledgeBaseItemType[];

export interface KnowledgeBaseItemSummary {
  id: string;
  type: KnowledgeBaseItemType;
  title: string;
  path: string;
  updatedAt?: string;
  wordCount?: number;
}

export interface KnowledgeBaseItemDoc extends KnowledgeBaseItemSummary {
  content: string;
  updatedAt: string;
}

export interface CreateKnowledgeBaseItemRequest {
  type: KnowledgeBaseItemType;
  title: string;
}

export interface UpdateKnowledgeBaseItemRequest {
  title: string;
  content: string;
}

export interface RenameKnowledgeBaseItemRequest {
  title: string;
}

export function knowledgeBaseTemplateFor(
  type: KnowledgeBaseItemType,
  title: string,
): string {
  const safeTitle = title.trim() || KNOWLEDGE_BASE_TYPE_META[type].singularLabel;
  if (type === "character") {
    return `# ${safeTitle}

## 基础信息

- 身份：
- 年龄/阶段：
- 所属阵营：
- 首次登场：

## 外貌与识别点

- 外貌：
- 标志物：
- 常见动作：

## 性格与口吻

- 性格关键词：
- 说话方式：
- 常用表达：
- 禁忌表达：

## 目标与动机

- 外在目标：
- 内在需求：
- 当前阻力：

## 当前状态

- 所在位置：
- 掌握信息：
- 情绪状态：
- 与主线关系：

## 关系网

- 盟友：
- 对手：
- 重要关系：

## 秘密与限制

- 不能主动透露：
- 尚未知晓：
- 能力/资源限制：

## 对话扮演规则

- 与用户对话时优先保持当前状态和口吻。
- 不主动泄露“秘密与限制”中该人物不应说出的信息。
- 如资料不足，可保持角色口吻回应，并在末尾用“创作注”简短说明缺失点。

## 备注

`;
  }

  if (type === "world") {
    return `# ${safeTitle}

## 范围

- 涵盖区域/时代/规则：
- 与主线关系：

## 核心规则

- 规则一：
- 规则二：
- 规则三：

## 势力、地点与时代

- 关键势力：
- 关键地点：
- 时代背景：

## 限制与代价

- 限制：
- 代价：
- 例外：

## 当前已知事实

- 已公开：
- 仅部分角色知晓：
- 尚未揭示：

## 冲突点

- 潜在矛盾：
- 待确认：

## 备注

`;
  }

  return `# ${safeTitle}

## 名称与类型

- 名称：
- 类型：
- 稀有度/等级：

## 外观

- 形态：
- 识别特征：

## 来源

- 来历：
- 制造者/发现者：
- 首次出现：

## 能力与用途

- 能力：
- 使用条件：
- 典型用途：

## 限制与代价

- 限制：
- 代价：
- 风险：

## 当前持有与位置

- 持有者：
- 所在位置：
- 当前状态：

## 剧情关联

- 关联人物：
- 关联事件：
- 伏笔/回收：

## 备注

`;
}

/* -------------------------------------------------------------------------- */
/* AI session history                                                         */
/* -------------------------------------------------------------------------- */

export type AiDraftFileChangeStatus = "created" | "modified";

export interface AiDraftFileChange {
  /** Project-relative path using forward slashes. */
  path: string;
  status: AiDraftFileChangeStatus;
  /**
   * SHA-256 of the file content when the run started. New files use null.
   */
  baseHash: string | null;
  /** SHA-256 of the AI draft content. */
  draftHash: string;
  /** Number of added lines in the generated unified diff. */
  additions: number;
  /** Number of deleted lines in the generated unified diff. */
  deletions: number;
  /** Unified diff text for source review. */
  diff: string;
  /** Full AI draft content to apply after review. */
  draftContent: string;
}

export type AiDraftChangeSetStatus =
  | "pending_review"
  | "applied"
  | "discarded";

export interface AiDraftChangeSet {
  runId: string;
  status: AiDraftChangeSetStatus;
  files: AiDraftFileChange[];
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export interface ApplyAiDraftChangesRequest {
  /** When omitted, all pending draft files are applied. */
  paths?: string[];
}

export interface DiscardAiDraftChangesRequest {
  /** When omitted, all pending draft files are discarded. */
  paths?: string[];
}

export interface ApplyAiDraftChangesResponse {
  ok: boolean;
  conflicts: string[];
  pendingChanges?: AiDraftChangeSet;
}

export interface DiscardAiDraftChangesResponse {
  ok: boolean;
  conflicts: string[];
  pendingChanges?: AiDraftChangeSet;
}

/** Maximum number of persisted AI sessions per book. */
export const AI_SESSION_MAX_COUNT = 200;

/** Maximum length for an AI session title. */
export const AI_SESSION_TITLE_MAX_LEN = 120;

/** Maximum length for one AI session draft input. */
export const AI_SESSION_INPUT_MAX_LEN = 20_000;

/** Maximum serialized AI session history request size, in UTF-16 code units. */
export const AI_SESSION_HISTORY_MAX_BYTES = 20_000_000;

export type AiStreamEvent =
  | {
      id?: string;
      kind: "thinking";
      title: string;
      detail: string;
      /** ISO timestamp. */
      createdAt?: string;
    }
  | {
      id?: string;
      kind: "tool_start";
      toolCallId?: string;
      toolName: string;
      input?: unknown;
      /** ISO timestamp. */
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
      /** ISO timestamp. */
      createdAt?: string;
    }
  | {
      id?: string;
      kind: "file_changed";
      operation: ProjectFileOperation;
      /** ISO timestamp. */
      createdAt?: string;
    };

export type AiWorkspaceRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AiWorkspaceUsageDiagnostics {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  uncachedInputTokens?: number;
  cacheHitRate?: number;
  sentMessageCount: number;
  originalMessageCount: number;
  trimmedMessageCount: number;
  historyTurnLimit: number;
  toolCallCount: number;
  contextDocCount: number;
}

export interface AiWorkspaceRunSnapshot<TMessage = unknown> {
  runId: string;
  bookId: string;
  sessionId: string;
  status: AiWorkspaceRunStatus;
  messages: TMessage[];
  events: AiStreamEvent[];
  pendingChanges?: AiDraftChangeSet;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
  /** ISO timestamp. */
  finishedAt?: string;
  error?: string;
  usage?: AiWorkspaceUsageDiagnostics;
}

export interface StartAiWorkspaceRunRequest<TMessage = unknown> {
  sessionId: string;
  messages: TMessage[];
  contextPaths?: string[];
  agentId?: string;
  mode: AiWorkspaceMode;
  roleplayCharacterPath?: string;
  commandName?: string;
  /** When true, the backend only exposes read-only project tools for this run. */
  readOnly?: boolean;
}

export type AiSessionMode = "workspace" | "character_roleplay";

export type AiWorkspaceMode = AiSessionMode;

export interface AiSessionSourceRef {
  type: "knowledge_base_item";
  itemType: KnowledgeBaseItemType;
  path: string;
  title: string;
}

export interface AiSessionRecord<TMessage = unknown> {
  id: string;
  title: string;
  input: string;
  messages: TMessage[];
  events: AiStreamEvent[];
  pendingChanges?: AiDraftChangeSet;
  mode: AiSessionMode;
  sourceRef?: AiSessionSourceRef;
  activeRunId?: string;
  activeRunStatus?: AiWorkspaceRunStatus;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export interface AiSessionsResponse<TMessage = unknown> {
  sessions: AiSessionRecord<TMessage>[];
  activeSessionId: string | null;
  /** ISO timestamp. */
  updatedAt: string | null;
}

export interface UpdateAiSessionsRequest<TMessage = unknown> {
  sessions: AiSessionRecord<TMessage>[];
  activeSessionId: string | null;
}

/* -------------------------------------------------------------------------- */
/* AI agent settings                                                          */
/* -------------------------------------------------------------------------- */

/** Allowed pattern for AI agent ids. */
export const AI_AGENT_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Maximum number of global AI agents. */
export const AI_AGENT_MAX_COUNT = 30;

/** Maximum length for an AI agent display name. */
export const AI_AGENT_NAME_MAX_LEN = 80;

/** Maximum length for an AI agent description. */
export const AI_AGENT_DESCRIPTION_MAX_LEN = 300;

/** Maximum length for an AI agent system prompt. */
export const AI_AGENT_SYSTEM_PROMPT_MAX_LEN = 12_000;

/** Maximum serialized AI agents request size, in UTF-16 code units. */
export const AI_AGENTS_PAYLOAD_MAX_BYTES = 1_000_000;

export interface AiAgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  enabled: boolean;
  builtIn?: boolean;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export interface AiAgentsResponse {
  agents: AiAgentConfig[];
  activeAgentId: string | null;
  /** ISO timestamp. */
  updatedAt: string | null;
}

export interface UpdateAiAgentsRequest {
  agents: AiAgentConfig[];
  activeAgentId: string | null;
}

/* -------------------------------------------------------------------------- */
/* AI presets overview                                                        */
/* -------------------------------------------------------------------------- */

export interface AiPresetSlashCommand {
  name: string;
  label: string;
  description: string;
  prompt: string;
}

export interface AiSlashCommandDefinition {
  name: string;
  label: string;
  description: string;
  prompt: string;
  executionHint?: string;
}

export interface AiSlashCommandPromptContext {
  userInstruction?: string;
}

export const KNOWLEDGE_BASE_PROMPT_GUIDE = [
  "资料库规则：",
  "- library/characters/*.md：人物卡，记录人物身份、口吻、目标、关系、当前状态、秘密与限制。",
  "- library/world/*.md：世界观卡，记录世界规则、势力、地点、时代、限制与代价。",
  "- library/items/*.md：特殊物品卡，记录物品来源、能力、限制、持有者和剧情关联。",
  "- 创建新的资料库 Markdown 文件时，文件名必须使用中文标题或中文专名，如 library/characters/林晚.md、library/world/青岚宗.md；不要使用英文 slug、拼音或无意义编号。",
].join("\n");

export const NOVEL_SPEC_PROMPT_GUIDE = [
  "创作规格规则：",
  `- ${NOVEL_SPEC_FILE} 是本书长期创作规格，记录结构、篇幅、文风、禁忌和创意原则。`,
  `- 生成大纲、细纲、正文、重写或审阅前，优先读取 ${NOVEL_SPEC_FILE} 的核心字段。`,
  `- ${NOVEL_SPEC_FILE} 规定怎么写，不承载具体剧情走向；剧情规划写入 ${PLOT_FILE}。`,
  `- ${NOVEL_SPEC_FILE} 为空或信息不足时，可基于 idea.md、资料库和用户回答轻量补全规格；剧情内容写入 ${PLOT_FILE} 或待确认。`,
].join("\n");

export const PLOT_PROMPT_GUIDE = [
  "剧情规划规则：",
  `- ${PLOT_FILE} 是本书长期剧情规划文件，记录主线、支线、阶段规划、剧情点子、伏笔回收、冲突反转和待确认剧情问题。`,
  `- ${PLOT_FILE} 不记录文风、章节数量、单章字数等创作规格；这些内容写入 ${NOVEL_SPEC_FILE}。`,
  `- ${PLOT_FILE} 不记录当前已完成进度快照；当前进度写入 ${STORY_STATUS_FILE}。`,
  "- 剧情计划如果与已写正文、资料库或用户最新指令冲突，以已发生事实和用户最新指令为准，把冲突写入待确认。",
].join("\n");

export const AI_CONTEXT_PRIORITY_PROMPT_GUIDE = [
  "上下文优先级：",
  "- 工具权限、文件安全和用户本轮明确指令优先。",
  `- 写作方式优先遵守 ${NOVEL_SPEC_FILE}。`,
  "- 已写正文和资料库事实优先于剧情规划。",
  `- ${STORY_STATUS_FILE} 是当前进度快照；${PLOT_FILE} 是剧情计划，不是已发生事实。`,
  `- 剧情方向参考 ${PLOT_FILE}；若 ${PLOT_FILE} 与正文、资料库或状态快照冲突，以事实文件为准并列入待确认。`,
  "- Agent 提供创作角色和风格偏好，但不能覆盖事实和权限规则。",
  "- 资料不足时说明未知；可以给推测，但必须标注为推测。",
].join("\n");

export const AI_SLASH_COMMANDS: AiSlashCommandDefinition[] = [
  {
    name: "/plan",
    label: "先规划",
    description: "先明确目标、范围、文件改动和执行步骤，不直接写文件",
    prompt: [
      "只读规划：先读必要资料，明确目标、依据、范围、预计文件和步骤。",
      "不创建、覆盖、删除或重命名文件；信息不足先问 1-3 个关键问题。",
      "输出风险、待确认和确认后执行方式。",
    ].join("\n"),
    executionHint: "只读规划，不改项目文件；用户确认后在同一会话中再执行。",
  },
  {
    name: "/set",
    label: "整理设定",
    description: "新增或修改设定前，先给候选变更和影响范围",
    prompt: [
      "只读整理设定：判断新增/修改意图，提出最多 1-3 条可落地候选。",
      "设定事实进 library/；非设定变更不在本命令处理。",
      "不擅自扩写大型背景或改写既有事实；每条说明目标文件、依据、影响和风险。",
    ].join("\n"),
    executionHint: "只读整理候选设定变更，不直接写项目文件；用户确认后再执行。",
  },
  {
    name: "/plot",
    label: "剧情",
    description: "整理或更新主线、支线、伏笔、反转和剧情点子",
    prompt: [
      `整理长期剧情规划，必要时创建或更新 ${PLOT_FILE}。`,
      "区分已写事实、剧情计划、点子候选和待确认；冲突不覆盖事实，列入待确认。",
      "只改剧情规划；不改正文、资料库或创作规格，除非用户明确要求。",
    ].join("\n"),
    executionHint: `可创建或更新 ${PLOT_FILE}，并按需读取创作规格、状态、资料库、大纲和正文。`,
  },
  {
    name: "/out",
    label: "总纲",
    description: "读取想法和资料库，生成或重整资料卡与总纲",
    prompt: [
      `生成或重整资料卡与总纲：读 idea、规格、状态、资料库、outline/index.md 和必要正文概况。`,
      `资料进 library/，章节摘要进 outline/index.md，当前快照进 ${STORY_STATUS_FILE}。`,
      `不生成章节细纲；需要下一章细纲时使用 ${CURRENT_CHAPTER_OUTLINE_FILE}。`,
    ].join("\n"),
    executionHint: `可按需轻量补全 ${NOVEL_SPEC_FILE}、资料库卡片、outline/index.md，并以短快照同步 ${STORY_STATUS_FILE}；不生成章节级细纲文件。`,
  },
  {
    name: "/detail",
    label: "细纲",
    description: "为即将生成正文的章节生成或更新当前细纲",
    prompt: [
      "生成或更新当前章节细纲；未指定目标章节时先问。",
      `只创建或更新 ${CURRENT_CHAPTER_OUTLINE_FILE}，承接总纲、资料库和最近正文。`,
      `细纲写目标章节、正文文件、章节功能、节拍、人物变化和前后文衔接；短同步 ${STORY_STATUS_FILE}。`,
    ].join("\n"),
    executionHint: `只创建或更新 ${CURRENT_CHAPTER_OUTLINE_FILE}，并以短快照同步 ${STORY_STATUS_FILE}。`,
  },
  {
    name: "/state",
    label: "状态",
    description: "读取项目资料，整理当前进度、最近上下文和下一步",
    prompt: [
      "刷新轻量创作快照：读状态、资料库、总纲、当前细纲、章节列表和最近正文。",
      `只创建或更新 ${STORY_STATUS_FILE}，记录当前进度、最近上下文、下一步、待确认和冲突。`,
      "不改资料库、正文、大纲或 idea.md。",
    ].join("\n"),
    executionHint: `可创建或更新 ${STORY_STATUS_FILE} 的轻量快照，不改写正文、大纲和设定文件。`,
  },
  {
    name: "/check",
    label: "审稿",
    description: "读取整体或指定范围，检查冲突、节奏和设定问题",
    prompt: [
      "审阅指定范围或整本项目，默认只输出报告，不改文件。",
      "重点看剧情逻辑、人物动机、设定一致性、规格偏离、节奏钩子和语言可读性。",
      "按严重程度列问题、证据、影响、建议、优先级；未发现问题也说明未读范围和剩余风险。",
    ].join("\n"),
    executionHint: "默认只读审阅，不主动写文件。",
  },
  {
    name: "/next",
    label: "续写",
    description: "读取设定和已有章节，自动创建下一章正文",
    prompt: [
      `续写下一章：读规格、状态、资料库、总纲、${CURRENT_CHAPTER_OUTLINE_FILE} 和最近正文。`,
      "先核对当前细纲是否匹配目标章节；不匹配则请用户确认或先运行 /detail。",
      `推断并创建新章节，不覆盖已有章节；同步 ${STORY_STATUS_FILE}。`,
    ].join("\n"),
    executionHint: `自动推断并创建 chapters/ 下的下一章文件，并以短快照同步 ${STORY_STATUS_FILE}。`,
  },
  {
    name: "/edit",
    label: "改写",
    description: "根据用户指出范围，自动重写并覆盖",
    prompt: [
      "重写或润色用户指定范围；范围不明先问 1-3 个问题。",
      "读规格、目标文件和必要上下文；可覆盖目标文件但保留核心情节、人物意图、设定和 Markdown 结构。",
      `进度或事实变化时同步 ${STORY_STATUS_FILE} 或资料库；纯语言润色只改目标文本。`,
    ].join("\n"),
    executionHint: `可自动覆盖用户指出的目标文件；关键事实变化时以短快照同步 ${STORY_STATUS_FILE}。`,
  },
  {
    name: "/ask",
    label: "先提问题",
    description: "让 AI 先问 3 个需要确认的问题",
    prompt: "请先问最多 3 个影响创作方向的问题，并说明下一步会优先读取哪些项目资料。",
  },
];

export function promptForAiSlashCommand(
  command: AiSlashCommandDefinition,
  ctx: AiSlashCommandPromptContext,
): string {
  const parts: string[] = [];
  const userInstruction = ctx.userInstruction?.trim();
  if (userInstruction) {
    parts.push("用户本轮要求：", userInstruction, "");
  }
  parts.push(
    `当前快捷指令：${command.name}（${command.label}）`,
    "",
    command.prompt,
    "",
    [
      "通用边界：",
      "- 用户本轮要求优先；先读必要文件，未读不当事实。",
      `- ${NOVEL_SPEC_FILE} 管写法；${STORY_STATUS_FILE} 管当前快照。`,
      "- 资料库和已写正文优先；冲突列待确认，不直接覆盖事实。",
      "- 人物/世界观/物品设定分别写入 library/characters、library/world、library/items。",
      "- 写入型任务最终说明读取、改动和待确认。",
    ].join("\n"),
    "",
  );
  return parts.join("\n");
}

export function toAiPresetSlashCommand(command: AiSlashCommandDefinition): AiPresetSlashCommand {
  return {
    name: command.name,
    label: command.label,
    description: command.description,
    prompt: command.prompt,
  };
}

export interface AiPresetTool {
  name: string;
  description: string;
  inputSchemaSummary: string;
  canChangeFiles: boolean;
  changeOperationTypes: ProjectFileOperation["type"][];
}

export interface AiPresetPromptSection {
  id: string;
  title: string;
  content: string;
  source: string;
}

export interface AiPresetRuntimeSetting {
  key: string;
  label: string;
  value: string;
  description: string;
}

export interface AiPresetsOverviewResponse {
  agents: AiAgentConfig[];
  activeAgentId: string | null;
  slashCommands: AiPresetSlashCommand[];
  tools: AiPresetTool[];
  promptSections: AiPresetPromptSection[];
  runtimeSettings: AiPresetRuntimeSetting[];
  /** ISO timestamp. */
  updatedAt: string | null;
}
