import {
  Fragment,
  memo,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UIMessage, UIMessagePart } from "ai";
import MDEditor from "@uiw/react-md-editor";
import {
  Bot,
  Check,
  ChevronDown,
  FileDiff,
  MessageSquare,
  MessageSquarePlus,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  AiAgentConfig,
  AiDraftChangeSet,
  AiDraftFileChange,
  AiSessionRecord,
  AiStreamEvent,
  AiWorkspaceUsageDiagnostics,
  AiWorkspaceRunSnapshot,
  ProjectFileOperation,
} from "@novelloom/shared";
import {
  promptForSlashCommand,
  SLASH_COMMANDS,
  type SlashCommand,
} from "../ai/slashCommands";
import { aiAgentsApi } from "../api/aiAgents";
import { aiSessionsApi } from "../api/aiSessions";
import {
  AiWorkspaceRunApiError,
  aiWorkspaceRunsApi,
} from "../api/aiWorkspaceRuns";
import { ConfirmModal, Modal } from "./Modal";

interface FileChangeRefreshOptions {
  changedPaths?: string[];
  reloadCurrent?: boolean;
}

interface AiCollaborationPanelProps {
  bookId: string;
  selectedPath: string | null;
  currentFileDirty: boolean;
  onFilesChanged(
    operation?: ProjectFileOperation,
    options?: FileChangeRefreshOptions,
  ): void;
}

type AiSessionRecordWithMessages = AiSessionRecord<UIMessage>;

const COLLAPSED_HISTORY_TURN_COUNT = 4;
const FILE_CHANGE_SCAN_MESSAGE_COUNT = 4;
const STREAMING_SAVE_DELAY_MS = 4000;
const IDLE_SAVE_DELAY_MS = 700;
const FINAL_SAVE_DELAY_MS = 250;
const RUN_POLL_INTERVAL_MS = 1000;
const READ_ONLY_SLASH_COMMANDS = new Set(["/plan", "/set"]);

type ToolLikePart = UIMessagePart<
  Record<string, unknown>,
  Record<string, { input: unknown; output: unknown }>
> & {
  type: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type DataLikePart = UIMessagePart<
  Record<string, unknown>,
  Record<string, { input: unknown; output: unknown }>
> & {
  type: `data-${string}`;
  data?: unknown;
};

interface AiRunToolTimelineItem {
  kind: "tool";
  key: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  finishedAt?: string;
  status: "running" | "done" | "failed";
}

type AiRunTimelineItem =
  | AiRunToolTimelineItem
  | {
      kind: "event";
      key: string;
      event: AiStreamEvent;
    };

interface AiTurnGroup {
  turnId: string;
  turnNumber: number;
  userMessage?: UIMessage;
  assistantMessages: UIMessage[];
}

interface SlashCommandQuery {
  query: string;
  range: {
    start: number;
    end: number;
  };
}

function createSession(index: number): AiSessionRecordWithMessages {
  const now = new Date().toISOString();
  return {
    id: `session-${Date.now()}-${index}`,
    title: `会话 ${index}`,
    input: "",
    messages: [],
    events: [],
    mode: "workspace",
    createdAt: now,
    updatedAt: now,
  };
}

function inferSessionIndex(sessions: AiSessionRecordWithMessages[]): number {
  return Math.max(
    1,
    sessions.length,
    ...sessions.map((session) => {
      const titleMatch = session.title.match(/^会话\s+(\d+)$/);
      return titleMatch ? Number(titleMatch[1]) : 0;
    }),
  );
}

function historySnapshot(
  sessions: AiSessionRecordWithMessages[],
  activeSessionId: string | null,
) {
  return {
    sessions,
    activeSessionId: sessions.some((session) => session.id === activeSessionId)
      ? activeSessionId
      : null,
  };
}

function mergeContextPaths(selectedPath: string | null): string[] {
  return selectedPath ? [selectedPath] : [];
}

function createUserMessage(text: string): UIMessage {
  return {
    id: `user-${Date.now()}`,
    role: "user",
    parts: [{ type: "text", text }],
  } as UIMessage;
}

function buildAiTurns(messages: UIMessage[]): AiTurnGroup[] {
  const turns: AiTurnGroup[] = [];
  let current: AiTurnGroup | null = null;

  messages.forEach((message) => {
    if (message.role === "user") {
      current = {
        turnId: message.id,
        turnNumber: turns.length + 1,
        userMessage: message,
        assistantMessages: [],
      };
      turns.push(current);
      return;
    }

    if (!current) {
      current = {
        turnId: `orphan-${message.id}`,
        turnNumber: turns.length + 1,
        assistantMessages: [],
      };
      turns.push(current);
    }
    current.assistantMessages.push(message);
  });

  return turns;
}

function stringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDurationMs(durationMs?: number): string | undefined {
  return durationMs === undefined ? undefined : `${durationMs.toFixed(2)}ms`;
}

function aiEventKey(event: AiStreamEvent): string {
  return (
    event.id ??
    `${event.kind}:${event.createdAt ?? "event"}:${stringify(event)}`
  );
}

function operationLabel(operation: ProjectFileOperation): string {
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

function shouldRefreshForAiOperation(operation: ProjectFileOperation): boolean {
  return operation.type !== "write_file" && operation.type !== "create_file";
}

function draftChangeStatusLabel(status: AiDraftFileChange["status"]): string {
  switch (status) {
    case "created":
      return "新增";
    case "modified":
      return "修改";
  }
}

function draftDiffLineClass(line: string): string {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}

function formatConflictError(conflicts: string[]): string {
  return conflicts.length > 0
    ? `检测到文件已变化：${conflicts.join("、")}。请手动处理后重新让 AI 生成。`
    : "检测到文件已变化。请手动处理后重新让 AI 生成。";
}

function isToolPart(
  part: UIMessagePart<
    Record<string, unknown>,
    Record<string, { input: unknown; output: unknown }>
  >,
): part is ToolLikePart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function isDataPart(
  part: UIMessagePart<
    Record<string, unknown>,
    Record<string, { input: unknown; output: unknown }>
  >,
): part is DataLikePart {
  return part.type.startsWith("data-");
}

function isAiStreamEvent(value: unknown): value is AiStreamEvent {
  return Boolean(value && typeof value === "object" && "kind" in value);
}

function extractFileChange(value: unknown): ProjectFileOperation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybe = value as { fileChanged?: ProjectFileOperation };
  return maybe.fileChanged;
}

function toolNameFromPart(part: ToolLikePart): string {
  return part.type === "dynamic-tool"
    ? (part.toolName ?? "dynamic_tool")
    : part.type.replace(/^tool-/, "");
}

function toolStateLabel(state?: string): string {
  switch (state) {
    case "input-streaming":
      return "准备中";
    case "input-available":
      return "执行中";
    case "output-available":
      return "完成";
    case "output-error":
      return "失败";
    case "approval-requested":
      return "等待确认";
    case "approval-responded":
      return "已确认";
    case "output-denied":
      return "已拒绝";
    default:
      return "运行中";
  }
}

function eventMeta(event: AiStreamEvent): {
  label: string;
  title: string;
  tone: string;
  detail?: string;
} {
  if (event.kind === "thinking") {
    return {
      label: "思考",
      title: event.title,
      tone: "thinking",
      detail: event.detail,
    };
  }
  if (event.kind === "tool_start") {
    return {
      label: "调用工具",
      title: event.toolName,
      tone: "tool running",
      detail: "执行中",
    };
  }
  if (event.kind === "tool_finish") {
    return {
      label: event.error ? "工具失败" : "工具完成",
      title: event.toolName,
      tone: event.error ? "tool failed" : "tool done",
      detail: formatDurationMs(event.durationMs),
    };
  }
  return {
    label: "文件变更",
    title: operationLabel(event.operation),
    tone: "file",
  };
}

function shortToolOutput(value: unknown): string {
  if (value === undefined) return "无返回内容";
  if (typeof value === "string")
    return value.length > 80 ? `${value.slice(0, 80)}...` : value;
  if (typeof value === "object" && value !== null)
    return Array.isArray(value) ? `${value.length} 项结果` : "对象结果";
  return String(value);
}

function findMatchingToolItem(
  items: AiRunTimelineItem[],
  toolItemsByCallId: Map<string, AiRunToolTimelineItem>,
  event: Extract<AiStreamEvent, { kind: "tool_finish" }>,
): AiRunToolTimelineItem | undefined {
  if (event.toolCallId) {
    const item = toolItemsByCallId.get(event.toolCallId);
    if (item) return item;
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item.kind === "tool" &&
      item.status === "running" &&
      item.toolName === event.toolName
    ) {
      return item;
    }
  }

  return undefined;
}

function buildAiRunTimeline(events: AiStreamEvent[]): AiRunTimelineItem[] {
  const items: AiRunTimelineItem[] = [];
  const toolItemsByCallId = new Map<string, AiRunToolTimelineItem>();

  events.forEach((event, index) => {
    if (event.kind === "tool_start") {
      const key =
        event.toolCallId ?? event.id ?? `${event.toolName}-start-${index}`;
      const item: AiRunToolTimelineItem = {
        kind: "tool",
        key,
        toolName: event.toolName,
        input: event.input,
        startedAt: event.createdAt,
        status: "running",
      };
      items.push(item);
      if (event.toolCallId) toolItemsByCallId.set(event.toolCallId, item);
      return;
    }

    if (event.kind === "tool_finish") {
      const status = event.error ? "failed" : "done";
      const target = findMatchingToolItem(items, toolItemsByCallId, event);
      if (target) {
        target.status = status;
        target.output = event.output;
        target.error = event.error;
        target.durationMs = event.durationMs;
        target.finishedAt = event.createdAt;
        if (event.toolCallId) toolItemsByCallId.set(event.toolCallId, target);
        return;
      }

      const key =
        event.toolCallId ?? event.id ?? `${event.toolName}-finish-${index}`;
      const item: AiRunToolTimelineItem = {
        kind: "tool",
        key,
        toolName: event.toolName,
        output: event.output,
        error: event.error,
        durationMs: event.durationMs,
        finishedAt: event.createdAt,
        status,
      };
      items.push(item);
      if (event.toolCallId) toolItemsByCallId.set(event.toolCallId, item);
      return;
    }

    items.push({
      kind: "event",
      key: event.id ?? `${event.kind}-${event.createdAt ?? "event"}-${index}`,
      event,
    });
  });

  return items;
}

function parseSlashCommandInput(
  text: string,
): { command: SlashCommand; userInstruction: string } | null {
  const trimmed = text.trim();
  for (const command of SLASH_COMMANDS) {
    const escapedName = command.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(^|\\s)${escapedName}(?=$|\\s)`).exec(trimmed);
    if (!match) continue;

    const commandStart = match.index + match[1].length;
    const before = trimmed.slice(0, commandStart).trim();
    const after = trimmed.slice(commandStart + command.name.length).trim();
    return {
      command,
      userInstruction: [before, after].filter(Boolean).join("\n"),
    };
  }
  return null;
}

function findSlashCommandQuery(
  input: string,
  caretPosition?: number | null,
): SlashCommandQuery | null {
  const caret =
    typeof caretPosition === "number"
      ? Math.max(0, Math.min(caretPosition, input.length))
      : input.length;
  const beforeCaret = input.slice(0, caret);
  const slashIndex = beforeCaret.lastIndexOf("/");
  if (slashIndex === -1) return null;

  const query = beforeCaret.slice(slashIndex + 1);
  if (/\s/.test(query)) return null;

  return {
    query: query.toLowerCase(),
    range: {
      start: slashIndex,
      end: caret,
    },
  };
}

function isReadOnlySlashCommand(command: SlashCommand): boolean {
  return READ_ONLY_SLASH_COMMANDS.has(command.name);
}

const AiMessagePart = memo(function AiMessagePart({
  part,
  isStreaming,
}: {
  part: UIMessagePart<
    Record<string, unknown>,
    Record<string, { input: unknown; output: unknown }>
  >;
  isStreaming: boolean;
}) {
  if (part.type === "text") {
    const hasText = Boolean(part.text?.trim());
    if (!hasText) return null;
    return (
      <div
        className={`ai-markdown ${isStreaming ? "streaming" : ""}`}
        data-color-mode="light"
      >
        <MDEditor.Markdown source={part.text || "\n"} />
        {isStreaming && <span className="stream-cursor" aria-hidden="true" />}
      </div>
    );
  }

  if (part.type === "reasoning") {
    const hasReasoning = Boolean(part.text?.trim());
    if (!hasReasoning) return null;
    return (
      <details
        className={`ai-collapsible thinking ${isStreaming ? "streaming" : ""}`}
        open={isStreaming}
      >
        <summary>
          <span>思考摘要</span>
          <small>{part.state === "streaming" ? "生成中" : "已完成"}</small>
        </summary>
        <div className="ai-markdown" data-color-mode="light">
          <MDEditor.Markdown source={part.text || "\n"} />
          {isStreaming && <span className="stream-cursor" aria-hidden="true" />}
        </div>
      </details>
    );
  }

  if (isToolPart(part))
    return <AiToolPart part={part} isStreaming={isStreaming} />;
  if (isDataPart(part)) return null;
  if (part.type === "step-start") return null;
  return null;
});

const AiToolPart = memo(function AiToolPart({
  part,
  isStreaming,
}: {
  part: ToolLikePart;
  isStreaming: boolean;
}) {
  const outputChange = extractFileChange(part.output);
  const isFailed = part.state === "output-error";
  const shouldOpen =
    isStreaming ||
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    isFailed;
  return (
    <details
      className={`ai-collapsible tool ${isFailed ? "failed" : ""}`}
      open={shouldOpen}
    >
      <summary>
        <span>工具</span>
        <strong>{toolNameFromPart(part)}</strong>
        <small>{toolStateLabel(part.state)}</small>
      </summary>
      {part.input !== undefined && (
        <>
          <h4>参数</h4>
          <pre>{stringify(part.input)}</pre>
        </>
      )}
      {part.output !== undefined && (
        <>
          <p className="ai-run-summary">{shortToolOutput(part.output)}</p>
          <h4>结果</h4>
          <pre>{stringify(part.output)}</pre>
        </>
      )}
      {outputChange && (
        <div className="ai-inline-file-change">
          文件变更：{operationLabel(outputChange)}
        </div>
      )}
      {part.errorText && <p className="error">错误：{part.errorText}</p>}
    </details>
  );
});

const AiRunToolRow = memo(function AiRunToolRow({
  item,
}: {
  item: AiRunToolTimelineItem;
}) {
  const isRunning = item.status === "running";
  const isFailed = item.status === "failed";
  const label = isRunning ? "调用工具" : isFailed ? "工具失败" : "工具完成";
  const detail = isRunning ? "执行中" : formatDurationMs(item.durationMs);
  return (
    <div className={`ai-run-event tool ${item.status}`}>
      <span className="ai-run-dot" aria-hidden="true" />
      <details className="ai-run-content ai-run-details" open={isRunning}>
        <summary>
          <span>{label}</span>
          <strong>{item.toolName}</strong>
          {detail && <small>{detail}</small>}
        </summary>
        {item.input !== undefined && (
          <>
            <h4>参数</h4>
            <pre>{stringify(item.input)}</pre>
          </>
        )}
        {item.output !== undefined && (
          <>
            <p className="ai-run-summary">{shortToolOutput(item.output)}</p>
            <h4>结果</h4>
            <pre>{stringify(item.output)}</pre>
          </>
        )}
        {item.error && <p className="error">错误：{item.error}</p>}
      </details>
    </div>
  );
});

const AiRunEventRow = memo(function AiRunEventRow({
  event,
}: {
  event: AiStreamEvent;
}) {
  const meta = eventMeta(event);
  if (event.kind === "tool_start") {
    return (
      <div className={`ai-run-event ${meta.tone}`}>
        <span className="ai-run-dot" aria-hidden="true" />
        <details className="ai-run-content ai-run-details" open>
          <summary>
            <span>{meta.label}</span>
            <strong>{meta.title}</strong>
            <small>{meta.detail}</small>
          </summary>
          <h4>参数</h4>
          <pre>{stringify(event.input)}</pre>
        </details>
      </div>
    );
  }

  if (event.kind === "tool_finish") {
    return (
      <div className={`ai-run-event ${meta.tone}`}>
        <span className="ai-run-dot" aria-hidden="true" />
        <details
          className="ai-run-content ai-run-details"
          open={Boolean(event.error)}
        >
          <summary>
            <span>{meta.label}</span>
            <strong>{meta.title}</strong>
            {meta.detail && <small>{meta.detail}</small>}
          </summary>
          {event.output !== undefined && (
            <>
              <p className="ai-run-summary">{shortToolOutput(event.output)}</p>
              <h4>结果</h4>
              <pre>{stringify(event.output)}</pre>
            </>
          )}
          {event.error && <p className="error">错误：{event.error}</p>}
        </details>
      </div>
    );
  }

  return (
    <div className={`ai-run-event ${meta.tone}`}>
      <span className="ai-run-dot" aria-hidden="true" />
      <div className="ai-run-content">
        <div className="ai-run-event-header">
          <span>{meta.label}</span>
          <strong>{meta.title}</strong>
        </div>
        {meta.detail && <p>{meta.detail}</p>}
      </div>
    </div>
  );
});

const AiRunLog = memo(function AiRunLog({
  events,
  usage,
}: {
  events: AiStreamEvent[];
  usage?: AiWorkspaceUsageDiagnostics;
}) {
  const timeline = useMemo(() => buildAiRunTimeline(events), [events]);
  if (events.length === 0 && !usage) return null;
  return (
    <section className="ai-run-block" aria-label="AI 实时执行事件">
      <div className="ai-run-header">
        <span>执行过程</span>
        <small>{events.length} 个事件</small>
      </div>
      {events.length > 0 && (
        <div className="ai-run-timeline">
          {timeline.map((item) =>
            item.kind === "tool" ? (
              <AiRunToolRow key={item.key} item={item} />
            ) : (
              <AiRunEventRow key={item.key} event={item.event} />
            ),
          )}
        </div>
      )}
      <AiUsageSummary usage={usage} />
    </section>
  );
});

const AiDraftChangesReview = memo(function AiDraftChangesReview({
  pendingChanges,
  applying,
  discarding,
  error,
  onApply,
  onDiscard,
}: {
  pendingChanges: AiDraftChangeSet;
  applying: boolean;
  discarding: boolean;
  error: string | null;
  onApply(paths?: string[]): void;
  onDiscard(paths?: string[]): void;
}) {
  const [activePath, setActivePath] = useState(
    () => pendingChanges.files[0]?.path ?? "",
  );
  const [diffDialogOpen, setDiffDialogOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const activeFile =
    pendingChanges.files.find((file) => file.path === activePath) ??
    pendingChanges.files[0];
  const totals = useMemo(
    () =>
      pendingChanges.files.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [pendingChanges.files],
  );

  useEffect(() => {
    if (pendingChanges.files.some((file) => file.path === activePath)) return;
    setActivePath(pendingChanges.files[0]?.path ?? "");
  }, [activePath, pendingChanges.files]);

  useEffect(() => {
    setCollapsed(false);
  }, [pendingChanges.runId]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      if (next) setDiffDialogOpen(false);
      return next;
    });
  }

  function openDiff(path: string) {
    setActivePath(path);
    setDiffDialogOpen(true);
  }

  if (!activeFile) return null;

  return (
    <section
      className={`ai-draft-review ${collapsed ? "collapsed" : ""}`}
      aria-label="待审阅变更"
    >
      <header className="ai-draft-review-header">
        <div>
          <span className="ai-draft-review-kicker">待审阅变更</span>
          <h3>
            <FileDiff size={14} aria-hidden="true" />
            <span>{pendingChanges.files.length} 个 AI 草稿文件</span>
          </h3>
        </div>
        <div className="ai-draft-review-controls">
          <div className="ai-draft-review-total">
            <span className="added">+{totals.additions}</span>
            <span className="removed">-{totals.deletions}</span>
          </div>
          <button
            type="button"
            className="ai-draft-toggle"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
          >
            {collapsed ? "展开" : "收起"}
          </button>
        </div>
      </header>

      {!collapsed && (
        <>
          <div className="ai-draft-file-list" role="list">
            {pendingChanges.files.map((file) => (
              <div
                key={file.path}
                role="listitem"
                className={`ai-draft-file ${file.path === activeFile.path ? "active" : ""}`}
                title={file.path}
              >
                <button
                  type="button"
                  className="ai-draft-file-open"
                  onClick={() => openDiff(file.path)}
                  aria-label={`查看 ${file.path} 的源码 diff`}
                >
                  <span className="ai-draft-file-main">
                    <strong>{file.path}</strong>
                    <small>{draftChangeStatusLabel(file.status)}</small>
                  </span>
                  <span className="ai-draft-file-stats">
                    <span className="added">+{file.additions}</span>
                    <span className="removed">-{file.deletions}</span>
                  </span>
                </button>
                <span className="ai-draft-file-actions">
                  <button
                    type="button"
                    className="ai-draft-file-action accept"
                    onClick={() => onApply([file.path])}
                    disabled={applying || discarding}
                    title={`接受 ${file.path}`}
                    aria-label={`接受 ${file.path}`}
                  >
                    <Check size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ai-draft-file-action reject"
                    onClick={() => onDiscard([file.path])}
                    disabled={applying || discarding}
                    title={`拒绝 ${file.path}`}
                    aria-label={`拒绝 ${file.path}`}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              </div>
            ))}
          </div>

          {error && <div className="ai-draft-error">错误：{error}</div>}

          <footer className="ai-draft-actions">
            <button
              type="button"
              className="btn-danger icon-button"
              onClick={() => onDiscard()}
              disabled={applying || discarding}
            >
              <X size={13} aria-hidden="true" />
              <span>{discarding ? "拒绝中..." : "拒绝全部"}</span>
            </button>
            <button
              type="button"
              className="icon-button primary"
              onClick={() => onApply()}
              disabled={applying || discarding}
            >
              <Check size={13} aria-hidden="true" />
              <span>{applying ? "接受中..." : "接受全部"}</span>
            </button>
          </footer>
        </>
      )}
      <Modal
        open={diffDialogOpen}
        size="wide"
        title={`源码 diff：${activeFile.path}`}
        description={`${draftChangeStatusLabel(activeFile.status)} · +${activeFile.additions} -${activeFile.deletions}`}
        onClose={() => setDiffDialogOpen(false)}
        footer={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setDiffDialogOpen(false)}
          >
            关闭
          </button>
        }
      >
        <div className="ai-draft-dialog-body">
          <pre
            className="ai-draft-dialog-diff"
            aria-label={`${activeFile.path} diff`}
          >
            {activeFile.diff.split("\n").map((line, index) => (
              <span
                key={`${activeFile.path}-${index}`}
                className={draftDiffLineClass(line)}
              >
                {line || " "}
              </span>
            ))}
          </pre>
        </div>
      </Modal>
    </section>
  );
});

function formatUsageNumber(value?: number): string {
  return value === undefined ? "未返回" : value.toLocaleString("zh-CN");
}

function formatCacheHitRate(value?: number): string {
  return value === undefined ? "未返回" : `${(value * 100).toFixed(2)}%`;
}

function AiUsageSummary({ usage }: { usage?: AiWorkspaceUsageDiagnostics }) {
  if (!usage) return null;
  return (
    <div className="ai-usage-summary" aria-label="AI 缓存诊断">
      {usage.model && <span>模型 {usage.model}</span>}
      <span>输入 {formatUsageNumber(usage.inputTokens)}</span>
      <span>输出 {formatUsageNumber(usage.outputTokens)}</span>
      <span>总计 {formatUsageNumber(usage.totalTokens)}</span>
      <span>命中 {formatUsageNumber(usage.cachedInputTokens)}</span>
      <span>未命中 {formatUsageNumber(usage.uncachedInputTokens)}</span>
      <span>命中率 {formatCacheHitRate(usage.cacheHitRate)}</span>
    </div>
  );
}

const AiMessageRow = memo(function AiMessageRow({
  message,
  isLatestAssistant,
  isStreaming,
}: {
  message: UIMessage;
  isLatestAssistant: boolean;
  isStreaming: boolean;
}) {
  return (
    <article
      className={`ai-message ${message.role} ${isStreaming ? "streaming" : ""}`}
    >
      <header className="ai-message-header">
        {isStreaming && isLatestAssistant && (
          <span className="ai-message-status">正在生成</span>
        )}
      </header>
      <div className="ai-message-body ai-message-parts">
        {message.parts.map((part, index) => (
          <AiMessagePart
            key={`${message.id}-${part.type}-${index}`}
            part={part}
            isStreaming={isStreaming}
          />
        ))}
      </div>
    </article>
  );
});

const AiHistoryCollapse = memo(function AiHistoryCollapse({
  hiddenMessageCount,
  expanded,
  onToggle,
}: {
  hiddenMessageCount: number;
  expanded: boolean;
  onToggle(): void;
}) {
  if (hiddenMessageCount <= 0 && !expanded) return null;
  return (
    <div className="ai-history-collapse">
      <span>
        {expanded
          ? "正在显示全部会话内容"
          : `已折叠 ${hiddenMessageCount} 轮较早对话`}
      </span>
      <button type="button" onClick={onToggle}>
        {expanded ? "收起较早内容" : "展开较早内容"}
      </button>
    </div>
  );
});

function SlashCommandMenu({
  commands,
  activeIndex,
  onPick,
}: {
  commands: SlashCommand[];
  activeIndex: number;
  onPick(command: SlashCommand): void;
}) {
  return (
    <div
      className="slash-command-menu"
      role="listbox"
      aria-label="预设 AI 命令"
    >
      {commands.length === 0 ? (
        <div className="slash-command-empty">无匹配命令</div>
      ) : (
        commands.map((command, index) => (
          <button
            key={command.name}
            type="button"
            className={`slash-command-option ${index === activeIndex ? "active" : ""}`}
            role="option"
            aria-selected={index === activeIndex}
            onClick={() => onPick(command)}
          >
            <code>{command.name}</code>
            <span>
              <strong>{command.label}</strong>
              <small>{command.description}</small>
            </span>
          </button>
        ))
      )}
    </div>
  );
}

interface PresetPickerOption {
  id: string;
  name: string;
  description?: string;
}

function CompactPresetPicker({
  ariaLabel,
  menuLabel,
  value,
  options,
  placeholder,
  loading,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  menuLabel: string;
  value: string | null;
  options: PresetPickerOption[];
  placeholder: string;
  loading: boolean;
  disabled: boolean;
  onChange(value: string | null): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.id === value) ?? null;
  const triggerLabel = loading ? "加载中" : (selected?.name ?? placeholder);
  const isDisabled = disabled || loading || options.length === 0;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="preset-picker" ref={rootRef}>
      <button
        type="button"
        className={`preset-picker-trigger ${open ? "open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={isDisabled}
        title={selected?.description || triggerLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{triggerLabel}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="preset-picker-menu"
          role="listbox"
          aria-label={menuLabel}
        >
          <div className="preset-picker-menu-title">{menuLabel}</div>
          {options.map((option) => {
            const active = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                className={`preset-picker-option ${active ? "active" : ""}`}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span>
                  <strong>{option.name}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                {active && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionPicker({
  sessions,
  activeSessionId,
  onSwitch,
  onRequestDelete,
}: {
  sessions: AiSessionRecordWithMessages[];
  activeSessionId: string;
  onSwitch(sessionId: string): void;
  onRequestDelete(
    session: AiSessionRecordWithMessages,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected =
    sessions.find((session) => session.id === activeSessionId) ??
    sessions[0] ??
    null;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="session-picker" ref={rootRef}>
      <button
        type="button"
        className={`session-picker-trigger ${open ? "open" : ""}`}
        aria-label="选择 AI 会话"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={sessions.length === 0}
        title={selected?.title ?? "选择会话"}
        onClick={() => setOpen((current) => !current)}
      >
        <MessageSquare size={12} aria-hidden="true" />
        <span>{selected?.title ?? "选择会话"}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="session-picker-menu"
          role="listbox"
          aria-label="AI 会话"
        >
          <div className="session-picker-menu-title">会话</div>
          {sessions.map((session) => {
            const active = session.id === activeSessionId;
            const running = session.activeRunStatus === "running";
            return (
              <div
                key={session.id}
                className={`session-picker-option ${active ? "active" : ""}`}
                role="option"
                aria-selected={active}
              >
                <button
                  type="button"
                  className="session-picker-option-main"
                  onClick={() => {
                    onSwitch(session.id);
                    setOpen(false);
                  }}
                  title={session.title}
                >
                  <span>
                    <strong>{session.title}</strong>
                    <small>
                      {running
                        ? "运行中"
                        : `${session.messages.length.toLocaleString()} 条消息`}
                    </small>
                  </span>
                  {active && <Check size={13} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="session-picker-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    onRequestDelete(session, event);
                  }}
                  title={
                    running ? "运行中的会话不能删除" : `删除 ${session.title}`
                  }
                  aria-label={`删除 ${session.title}`}
                  disabled={running}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AiCollaborationPanel({
  bookId,
  selectedPath,
  currentFileDirty,
  onFilesChanged,
}: AiCollaborationPanelProps) {
  const initialSessionRef = useRef<AiSessionRecordWithMessages | null>(null);
  if (initialSessionRef.current === null) {
    initialSessionRef.current = createSession(1);
  }
  const [sessionIndex, setSessionIndex] = useState(1);
  const [activeSessionId, setActiveSessionId] = useState(
    () => initialSessionRef.current?.id ?? "",
  );
  const [sessions, setSessions] = useState<AiSessionRecordWithMessages[]>(() =>
    initialSessionRef.current ? [initialSessionRef.current] : [],
  );
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySaveError, setHistorySaveError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AiAgentConfig[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [composerCaretPosition, setComposerCaretPosition] = useState<
    number | null
  >(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [usageBySessionId, setUsageBySessionId] = useState<
    Record<string, AiWorkspaceUsageDiagnostics | undefined>
  >({});
  const [sessionToDelete, setSessionToDelete] =
    useState<AiSessionRecordWithMessages | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewApplying, setReviewApplying] = useState(false);
  const [reviewDiscarding, setReviewDiscarding] = useState(false);
  const [dirtyApplyConfirmOpen, setDirtyApplyConfirmOpen] = useState(false);
  const [pendingApplyPaths, setPendingApplyPaths] = useState<
    string[] | undefined
  >(undefined);
  const selectedPathRef = useRef<string | null>(selectedPath);
  const activeSessionIdRef = useRef(activeSessionId);
  const activeAgentIdRef = useRef<string | null>(activeAgentId);
  const latestMessagesRef = useRef<UIMessage[]>([]);
  const historyLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const otherModeSessionsRef = useRef<AiSessionRecordWithMessages[]>([]);
  const pendingHistoryPayloadRef = useRef<ReturnType<
    typeof historySnapshot
  > | null>(null);
  const saveInFlightRef = useRef(false);
  const historyDirtyRef = useRef(false);
  const busyRef = useRef(false);
  const seenEventKeysRef = useRef<Set<string>>(new Set());
  const seenChangesRef = useRef<Set<string>>(new Set());
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    activeAgentIdRef.current = activeAgentId;
  }, [activeAgentId]);

  const activeSession = useMemo(() => {
    return (
      sessions.find((session) => session.id === activeSessionId) ??
      sessions[0] ??
      createSession(1)
    );
  }, [activeSessionId, sessions]);

  const enabledAgents = useMemo(
    () => agents.filter((agent) => agent.enabled),
    [agents],
  );

  const applyRunSnapshot = useCallback(
    (snapshot: AiWorkspaceRunSnapshot<UIMessage>) => {
      const now = new Date().toISOString();
      setSessions((current) =>
        current.map((session) =>
          session.id === snapshot.sessionId
            ? (() => {
                const pendingChanges =
                  snapshot.pendingChanges ??
                  (snapshot.status === "running"
                    ? session.pendingChanges
                    : undefined);
                return {
                  ...session,
                  messages: snapshot.messages,
                  events: snapshot.events,
                  pendingChanges,
                  activeRunId: snapshot.runId,
                  activeRunStatus: snapshot.status,
                  updatedAt: now,
                };
              })()
            : session,
        ),
      );
      if (snapshot.usage) {
        setUsageBySessionId((current) => ({
          ...current,
          [snapshot.sessionId]: snapshot.usage,
        }));
      }
      latestMessagesRef.current = snapshot.messages;
      for (const event of snapshot.events) {
        const key = `${snapshot.sessionId}:${aiEventKey(event)}`;
        if (seenEventKeysRef.current.has(key)) continue;
        seenEventKeysRef.current.add(key);
        if (
          event.kind === "file_changed" &&
          shouldRefreshForAiOperation(event.operation)
        ) {
          onFilesChanged(event.operation);
        }
      }
      if (snapshot.status === "failed") {
        setRunError(snapshot.error ?? "AI 运行失败");
      } else if (snapshot.status === "running") {
        setRunError(null);
      }
    },
    [onFilesChanged],
  );

  function clearRunPollTimer() {
    if (runPollTimerRef.current) {
      clearTimeout(runPollTimerRef.current);
      runPollTimerRef.current = null;
    }
  }

  function scheduleRunPoll(runId: string, delayMs = RUN_POLL_INTERVAL_MS) {
    clearRunPollTimer();
    runPollTimerRef.current = setTimeout(() => {
      runPollTimerRef.current = null;
      void pollRun(runId);
    }, delayMs);
  }

  async function pollRun(runId: string) {
    try {
      const snapshot = await aiWorkspaceRunsApi.get(bookId, runId);
      applyRunSnapshot(snapshot);
      if (snapshot.status === "running") {
        scheduleRunPoll(runId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRunError(
        message.includes("404") ? "AI 运行已中断，请重新发送。" : message,
      );
      const now = new Date().toISOString();
      setSessions((current) =>
        current.map((session) =>
          session.activeRunId === runId
            ? {
                ...session,
                activeRunStatus: "failed",
                updatedAt: now,
              }
            : session,
        ),
      );
    }
  }

  const messages = activeSession.messages;
  const busy = activeSession.activeRunStatus === "running";
  busyRef.current = busy;
  const input = activeSession.input;
  const activeUsage = usageBySessionId[activeSession.id];
  const activePendingChanges =
    activeSession.pendingChanges?.status === "pending_review" &&
    activeSession.pendingChanges.files.length > 0
      ? activeSession.pendingChanges
      : null;
  const activePendingPaths = useMemo(
    () => activePendingChanges?.files.map((file) => file.path) ?? [],
    [activePendingChanges],
  );
  const hasDraftWriteEvents = useMemo(
    () =>
      activeSession.events.some(
        (event) =>
          event.kind === "file_changed" &&
          !shouldRefreshForAiOperation(event.operation),
      ),
    [activeSession.events],
  );
  const showDraftWaitingHint =
    hasDraftWriteEvents &&
    !activePendingChanges &&
    activeSession.activeRunStatus === "running";
  const showDraftMissingHint =
    hasDraftWriteEvents &&
    !activePendingChanges &&
    activeSession.activeRunStatus === "completed";
  const latestMessageId = messages.at(-1)?.id;
  const turns = useMemo(() => buildAiTurns(messages), [messages]);
  const visibleTurns = useMemo(
    () =>
      historyExpanded ? turns : turns.slice(-COLLAPSED_HISTORY_TURN_COUNT),
    [historyExpanded, turns],
  );
  const hiddenTurnCount = turns.length - visibleTurns.length;
  const latestTurnId = turns.at(-1)?.turnId;
  const slashCommandQuery = useMemo(
    () => findSlashCommandQuery(input, composerCaretPosition),
    [composerCaretPosition, input],
  );
  const slashQuery = slashCommandQuery?.query;
  const filteredCommands = useMemo(() => {
    if (slashQuery === undefined) return [];
    return SLASH_COMMANDS.filter((command) => {
      const haystack =
        `${command.name} ${command.label} ${command.description}`.toLowerCase();
      return haystack.includes(slashQuery);
    });
  }, [slashQuery]);
  const commandMenuOpen = slashCommandQuery !== null && !busy;

  function scheduleHistorySave(delayMs: number, replaceExisting = false) {
    if (saveTimerRef.current) {
      if (!replaceExisting) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushHistorySave();
    }, delayMs);
  }

  async function flushHistorySave() {
    if (saveInFlightRef.current) {
      scheduleHistorySave(
        busyRef.current ? STREAMING_SAVE_DELAY_MS : IDLE_SAVE_DELAY_MS,
      );
      return;
    }
    const payload = pendingHistoryPayloadRef.current;
    if (!payload) return;
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastSavedSnapshotRef.current) {
      historyDirtyRef.current = false;
      return;
    }

    saveInFlightRef.current = true;
    historyDirtyRef.current = false;
    try {
      await aiSessionsApi.save(bookId, {
        ...payload,
        sessions: [...otherModeSessionsRef.current, ...payload.sessions],
      });
      lastSavedSnapshotRef.current = snapshot;
      setHistorySaveError(null);
    } catch (err) {
      setHistorySaveError(err instanceof Error ? err.message : String(err));
      historyDirtyRef.current = true;
    } finally {
      saveInFlightRef.current = false;
      if (historyDirtyRef.current) {
        scheduleHistorySave(
          busyRef.current ? STREAMING_SAVE_DELAY_MS : IDLE_SAVE_DELAY_MS,
        );
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    setAgentsLoading(true);
    setAgentsError(null);
    aiAgentsApi
      .load()
      .then((data) => {
        if (cancelled) return;
        const enabled = data.agents.filter((agent) => agent.enabled);
        const nextActiveAgentId = enabled.some(
          (agent) => agent.id === data.activeAgentId,
        )
          ? data.activeAgentId
          : (enabled[0]?.id ?? null);
        setAgents(data.agents);
        setActiveAgentId(nextActiveAgentId);
      })
      .catch((err) => {
        if (cancelled) return;
        setAgents([]);
        setActiveAgentId(null);
        setAgentsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fallbackSession = createSession(1);
    historyLoadedRef.current = false;
    lastSavedSnapshotRef.current = null;
    latestMessagesRef.current = [];
    otherModeSessionsRef.current = [];
    pendingHistoryPayloadRef.current = null;
    saveInFlightRef.current = false;
    historyDirtyRef.current = false;
    setRunError(null);
    setHistoryExpanded(false);
    setUsageBySessionId({});
    seenEventKeysRef.current.clear();
    seenChangesRef.current.clear();
    clearRunPollTimer();
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    setHistorySaveError(null);
    setSessionIndex(1);
    setSessions([fallbackSession]);
    setActiveSessionId(fallbackSession.id);

    aiSessionsApi
      .load(bookId)
      .then((history) => {
        if (cancelled) return;
        const workspaceSessions = history.sessions.filter(
          (session) => session.mode === "workspace",
        );
        otherModeSessionsRef.current = history.sessions.filter(
          (session) => session.mode !== "workspace",
        );
        const loadedSessions =
          workspaceSessions.length > 0 ? workspaceSessions : [createSession(1)];
        const nextActiveSessionId = loadedSessions.some(
          (session) => session.id === history.activeSessionId,
        )
          ? history.activeSessionId
          : (loadedSessions[0]?.id ?? null);
        const nextActiveSession = loadedSessions.find(
          (session) => session.id === nextActiveSessionId,
        );
        latestMessagesRef.current = nextActiveSession?.messages ?? [];
        setSessions(loadedSessions);
        setActiveSessionId(nextActiveSessionId ?? "");
        setSessionIndex(inferSessionIndex(loadedSessions));
        lastSavedSnapshotRef.current = JSON.stringify(
          historySnapshot(loadedSessions, nextActiveSessionId),
        );
        historyLoadedRef.current = true;
        setHistoryLoading(false);
        const runningSession = loadedSessions.find(
          (session) =>
            session.activeRunStatus === "running" && session.activeRunId,
        );
        if (runningSession?.activeRunId) {
          scheduleRunPoll(runningSession.activeRunId, 0);
        } else {
          const recoverableCompletedSession = loadedSessions.find(
            (session) =>
              session.activeRunStatus === "completed" &&
              session.activeRunId &&
              !session.pendingChanges,
          );
          if (recoverableCompletedSession?.activeRunId) {
            scheduleRunPoll(recoverableCompletedSession.activeRunId, 0);
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const emptySession = createSession(1);
        setSessions([emptySession]);
        setActiveSessionId(emptySession.id);
        setSessionIndex(1);
        latestMessagesRef.current = [];
        lastSavedSnapshotRef.current = JSON.stringify(
          historySnapshot([emptySession], emptySession.id),
        );
        historyLoadedRef.current = true;
        setHistoryError(err instanceof Error ? err.message : String(err));
        setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      clearRunPollTimer();
    };
  }, [bookId]);

  useEffect(() => {
    if (!historyLoadedRef.current) return;
    pendingHistoryPayloadRef.current = historySnapshot(
      sessions,
      activeSessionId,
    );
    historyDirtyRef.current = true;
    scheduleHistorySave(busy ? STREAMING_SAVE_DELAY_MS : IDLE_SAVE_DELAY_MS);
  }, [activeSessionId, busy, sessions]);

  useEffect(() => {
    if (!busy && historyDirtyRef.current) {
      scheduleHistorySave(FINAL_SAVE_DELAY_MS, true);
    }
  }, [busy]);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    seenChangesRef.current.clear();
    setHistoryExpanded(false);
    setRunError(null);
    if (
      activeSession.activeRunStatus === "running" &&
      activeSession.activeRunId
    ) {
      scheduleRunPoll(activeSession.activeRunId, 0);
    }
  }, [activeSession.id]);

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (activeCommandIndex < filteredCommands.length) return;
    setActiveCommandIndex(Math.max(0, filteredCommands.length - 1));
  }, [activeCommandIndex, filteredCommands.length]);

  useEffect(() => {
    for (const message of messages.slice(-FILE_CHANGE_SCAN_MESSAGE_COUNT)) {
      for (const part of message.parts) {
        const change = isToolPart(part)
          ? extractFileChange(part.output)
          : isDataPart(part) &&
              isAiStreamEvent(part.data) &&
              part.data.kind === "file_changed"
            ? part.data.operation
            : undefined;
        if (!change) continue;
        const key = `${message.id}:${part.type}:${JSON.stringify(change)}`;
        if (seenChangesRef.current.has(key)) continue;
        seenChangesRef.current.add(key);
        if (shouldRefreshForAiOperation(change)) onFilesChanged(change);
      }
    }
  }, [messages, onFilesChanged]);

  function setInput(nextInput: string) {
    const now = new Date().toISOString();
    setSessions((current) =>
      current.map((session) =>
        session.id === activeSessionIdRef.current
          ? { ...session, input: nextInput, updatedAt: now }
          : session,
      ),
    );
  }

  function syncComposerCaret(element: HTMLTextAreaElement) {
    setComposerCaretPosition(element.selectionStart);
  }

  async function submit(nextText?: string) {
    const text = (nextText ?? input).trim();
    if (!text || busy) return;
    const parsedCommand = parseSlashCommandInput(text);
    const messageText = parsedCommand
      ? promptForCommand(parsedCommand.command, parsedCommand.userInstruction)
      : text;
    const now = new Date().toISOString();
    const sessionId = activeSession.id;
    const userMessage = createUserMessage(messageText);
    const nextMessages = [...messages, userMessage];
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              input: "",
              messages: nextMessages,
              events: [],
              pendingChanges: undefined,
              activeRunStatus: "running",
              activeRunId: undefined,
              updatedAt: now,
            }
          : session,
      ),
    );
    setRunError(null);
    setReviewError(null);
    try {
      const snapshot = await aiWorkspaceRunsApi.start(bookId, {
        sessionId,
        messages: nextMessages,
        mode: "workspace",
        agentId: activeAgentIdRef.current ?? undefined,
        commandName: parsedCommand?.command.name,
        readOnly: parsedCommand
          ? isReadOnlySlashCommand(parsedCommand.command)
          : undefined,
        contextPaths: parsedCommand
          ? []
          : mergeContextPaths(selectedPathRef.current),
      });
      applyRunSnapshot(snapshot);
      if (snapshot.status === "running") {
        scheduleRunPoll(snapshot.runId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRunError(message);
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                activeRunStatus: "failed",
                updatedAt: new Date().toISOString(),
              }
            : session,
        ),
      );
    }
  }

  async function cancelActiveRun() {
    const runId = activeSession.activeRunId;
    if (!runId) return;
    try {
      const snapshot = await aiWorkspaceRunsApi.cancel(bookId, runId);
      applyRunSnapshot(snapshot);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    }
  }

  function updatePendingChangesForSession(
    sessionId: string,
    nextChanges?: AiDraftChangeSet,
  ) {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? { ...session, pendingChanges: nextChanges }
          : session,
      ),
    );
  }

  async function performApplyPendingChanges(paths?: string[]) {
    if (!activePendingChanges) return;
    const sessionId = activeSession.id;
    const changedPaths = paths ?? activePendingPaths;
    setDirtyApplyConfirmOpen(false);
    setPendingApplyPaths(undefined);
    setReviewApplying(true);
    setReviewError(null);
    try {
      const result = await aiWorkspaceRunsApi.applyChanges(
        bookId,
        activePendingChanges.runId,
        paths,
      );
      updatePendingChangesForSession(sessionId, result.pendingChanges);
      onFilesChanged(undefined, {
        changedPaths,
        reloadCurrent: true,
      });
    } catch (err) {
      if (err instanceof AiWorkspaceRunApiError && err.status === 409) {
        setReviewError(formatConflictError(err.conflicts));
      } else if (err instanceof AiWorkspaceRunApiError && err.status === 404) {
        setReviewError(
          "待审阅草稿所在的 AI run 已不存在，可能是后端重启导致。请重新让 AI 生成变更。",
        );
      } else {
        setReviewError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setReviewApplying(false);
    }
  }

  function requestApplyPendingChanges(paths?: string[]) {
    if (!activePendingChanges) return;
    const pathsToApply = paths ?? activePendingPaths;
    if (
      currentFileDirty &&
      selectedPath &&
      pathsToApply.includes(selectedPath)
    ) {
      setPendingApplyPaths(paths);
      setDirtyApplyConfirmOpen(true);
      return;
    }
    void performApplyPendingChanges(paths);
  }

  async function discardPendingChanges(paths?: string[]) {
    if (!activePendingChanges) return;
    const sessionId = activeSession.id;
    const changedPaths = paths ?? activePendingPaths;
    setReviewDiscarding(true);
    setReviewError(null);
    try {
      const result = await aiWorkspaceRunsApi.discardChanges(
        bookId,
        activePendingChanges.runId,
        paths,
      );
      updatePendingChangesForSession(sessionId, result.pendingChanges);
      onFilesChanged(undefined, { changedPaths });
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewDiscarding(false);
    }
  }

  function promptForCommand(
    command: SlashCommand,
    userInstruction = "",
  ): string {
    return promptForSlashCommand(command, { userInstruction });
  }

  function pickCommand(command: SlashCommand) {
    const insertion = `${command.name} `;
    const range = slashCommandQuery?.range;
    const nextInput = range
      ? `${input.slice(0, range.start)}${insertion}${input.slice(range.end)}`
      : `${input}${input && !/\s$/.test(input) ? " " : ""}${insertion}`;
    const position = range ? range.start + insertion.length : nextInput.length;
    setInput(nextInput);
    setComposerCaretPosition(position);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(position, position);
    });
  }

  function switchSession(sessionId: string) {
    if (sessionId === activeSessionId) return;
    setHistoryExpanded(false);
    setActiveSessionId(sessionId);
  }

  function newSession() {
    const nextIndex = sessionIndex + 1;
    const nextSession = createSession(nextIndex);
    setSessions((current) => [...current, nextSession]);
    setSessionIndex(nextIndex);
    setHistoryExpanded(false);
    setActiveSessionId(nextSession.id);
  }

  function requestDeleteSession(
    session: AiSessionRecordWithMessages,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
    if (session.activeRunStatus === "running") return;
    setSessionToDelete(session);
  }

  function confirmDeleteSession() {
    const targetSession = sessionToDelete;
    if (!targetSession) return;

    setSessions((current) => {
      const targetIndex = current.findIndex(
        (session) => session.id === targetSession.id,
      );
      if (targetIndex === -1) return current;

      const remaining = current.filter(
        (session) => session.id !== targetSession.id,
      );
      if (remaining.length === 0) {
        const nextIndex = sessionIndex + 1;
        const nextSession = createSession(nextIndex);
        setSessionIndex(nextIndex);
        setActiveSessionId(nextSession.id);
        return [nextSession];
      }

      if (activeSessionIdRef.current === targetSession.id) {
        const nextActive =
          remaining[Math.max(0, targetIndex - 1)] ?? remaining[0];
        setActiveSessionId(nextActive.id);
      }
      return remaining;
    });
    setHistoryExpanded(false);
    setSessionToDelete(null);
  }

  return (
    <aside className="ai-pane">
      <div className="pane-header ai-pane-header">
        <div className="ai-title-row">
          <h2 className="pane-title-with-icon">
            <Bot size={14} aria-hidden="true" />
            <span>AI 协作</span>
          </h2>
          <SessionPicker
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSwitch={switchSession}
            onRequestDelete={requestDeleteSession}
          />
        </div>
        <div className="ai-pane-actions">
          <CompactPresetPicker
            ariaLabel="选择 Agent"
            menuLabel="Agent"
            value={activeAgentId}
            options={enabledAgents.map((agent) => ({
              id: agent.id,
              name: agent.name,
              description: agent.description,
            }))}
            placeholder="默认助手"
            loading={agentsLoading}
            disabled={busy}
            onChange={setActiveAgentId}
          />
          <button
            className="btn-secondary icon-button"
            onClick={newSession}
            title="创建新的 AI 会话"
            aria-label="创建新的 AI 会话"
          >
            <MessageSquarePlus size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      {historyLoading && (
        <div className="ai-history-status">正在加载历史会话...</div>
      )}
      {historyError && (
        <div className="ai-history-status error">
          历史会话加载失败：{historyError}
        </div>
      )}
      {historySaveError && (
        <div className="ai-history-status error">
          历史会话保存失败：{historySaveError}
        </div>
      )}
      {agentsError && (
        <div className="ai-history-status error">
          Agent 加载失败：{agentsError}
        </div>
      )}
      {runError && (
        <div className="ai-history-status error">AI 运行失败：{runError}</div>
      )}

      <div className="ai-feed ai-transcript">
        {messages.length === 0 && activeSession.events.length === 0 && (
          <div className="ai-empty-state">
            <strong>像协作者一样处理项目文件</strong>
            <p>
              输入任务直接发送，或输入 / 调出创作命令。AI
              会以执行过程、工具调用和正文输出的顺序展示。可用 /plan
              先规划，或用 /out、/check、/next 快速开始。
            </p>
          </div>
        )}
        {turns.length > COLLAPSED_HISTORY_TURN_COUNT && (
          <AiHistoryCollapse
            hiddenMessageCount={hiddenTurnCount}
            expanded={historyExpanded}
            onToggle={() => setHistoryExpanded((expanded) => !expanded)}
          />
        )}
        {visibleTurns.map((turn) => {
          const isLatestTurn = turn.turnId === latestTurnId;
          const showEventsInTurn =
            activeSession.events.length > 0 && isLatestTurn;
          const hasAssistantMessages = turn.assistantMessages.length > 0;
          return (
            <section key={turn.turnId} className="ai-turn">
              <div className="ai-turn-divider">
                <span>第 {turn.turnNumber} 轮</span>
                <small>{turn.userMessage ? "你发起" : "历史回复"}</small>
              </div>
              {turn.userMessage && (
                <AiMessageRow
                  message={turn.userMessage}
                  isLatestAssistant={false}
                  isStreaming={false}
                />
              )}
              {showEventsInTurn && !hasAssistantMessages && (
                <AiRunLog events={activeSession.events} usage={activeUsage} />
              )}
              {turn.assistantMessages.map((message, index) => {
                const isLatestAssistant =
                  message.role === "assistant" &&
                  message.id === latestMessageId;
                return (
                  <Fragment key={message.id}>
                    {showEventsInTurn && index === 0 && (
                      <AiRunLog
                        events={activeSession.events}
                        usage={activeUsage}
                      />
                    )}
                    <AiMessageRow
                      message={message}
                      isLatestAssistant={isLatestAssistant}
                      isStreaming={busy && isLatestAssistant}
                    />
                  </Fragment>
                );
              })}
            </section>
          );
        })}
      </div>

      {activePendingChanges && (
        <AiDraftChangesReview
          pendingChanges={activePendingChanges}
          applying={reviewApplying}
          discarding={reviewDiscarding}
          error={reviewError}
          onApply={requestApplyPendingChanges}
          onDiscard={(paths) => void discardPendingChanges(paths)}
        />
      )}

      <div className="ai-composer">
        <div className="ai-composer-shell">
          {commandMenuOpen && (
            <SlashCommandMenu
              commands={filteredCommands}
              activeIndex={activeCommandIndex}
              onPick={pickCommand}
            />
          )}
          <textarea
            ref={composerRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              syncComposerCaret(event.currentTarget);
            }}
            onKeyDown={(event) => {
              const composing =
                "isComposing" in event.nativeEvent &&
                event.nativeEvent.isComposing;
              if (composing) return;
              if (commandMenuOpen && event.key === "ArrowDown") {
                event.preventDefault();
                setActiveCommandIndex((current) =>
                  Math.min(
                    current + 1,
                    Math.max(0, filteredCommands.length - 1),
                  ),
                );
                return;
              }
              if (commandMenuOpen && event.key === "ArrowUp") {
                event.preventDefault();
                setActiveCommandIndex((current) => Math.max(0, current - 1));
                return;
              }
              if (commandMenuOpen && event.key === "Escape") {
                event.preventDefault();
                setInput("");
                setComposerCaretPosition(0);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (commandMenuOpen) {
                  const command = filteredCommands[activeCommandIndex];
                  if (command) pickCommand(command);
                  return;
                }
                void submit();
              }
            }}
            onKeyUp={(event) => syncComposerCaret(event.currentTarget)}
            onClick={(event) => syncComposerCaret(event.currentTarget)}
            onSelect={(event) => syncComposerCaret(event.currentTarget)}
            placeholder="描述任务，或输入 / 使用命令"
            disabled={busy}
          />
          <div className="ai-composer-footer">
            <span className="ai-composer-hint">
              输入 / 选择命令 · 例：/out、/check · Enter 发送
            </span>
            {busy ? (
              <button
                className="icon-button btn-secondary ai-send-button"
                onClick={() => void cancelActiveRun()}
                title="停止当前 AI 执行"
              >
                <Square size={15} aria-hidden="true" />
                <span>停止</span>
              </button>
            ) : (
              <button
                className="icon-button primary ai-send-button"
                onClick={() => void submit()}
                disabled={!input.trim()}
              >
                <Send size={15} aria-hidden="true" />
                <span>发送</span>
              </button>
            )}
          </div>
        </div>
      </div>
      <ConfirmModal
        open={sessionToDelete !== null}
        title={
          sessionToDelete ? `删除「${sessionToDelete.title}」？` : "删除会话？"
        }
        description="该会话的消息和工具执行记录会从 AI 协作历史中移除。此操作不可撤销。"
        confirmLabel="删除"
        tone="danger"
        onConfirm={confirmDeleteSession}
        onCancel={() => setSessionToDelete(null)}
      />
      <ConfirmModal
        open={dirtyApplyConfirmOpen}
        title="当前文件有未保存内容"
        description="AI 草稿包含当前正在编辑的文件。继续接受会用 AI 版本刷新当前文件，并放弃未保存编辑；如需保留，请先取消并保存。"
        confirmLabel="继续接受"
        onConfirm={() => void performApplyPendingChanges(pendingApplyPaths)}
        onCancel={() => {
          setDirtyApplyConfirmOpen(false);
          setPendingApplyPaths(undefined);
        }}
      />
    </aside>
  );
}
