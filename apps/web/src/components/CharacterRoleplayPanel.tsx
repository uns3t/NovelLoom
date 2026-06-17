import { useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";
import MDEditor from "@uiw/react-md-editor";
import { MessageSquare, Send, Square } from "lucide-react";
import type {
  AiSessionRecord,
  AiStreamEvent,
  AiWorkspaceUsageDiagnostics,
  AiWorkspaceRunSnapshot,
} from "@novelloom/shared";
import { aiSessionsApi } from "../api/aiSessions";
import { aiWorkspaceRunsApi } from "../api/aiWorkspaceRuns";

interface CharacterRoleplayPanelProps {
  bookId: string;
  characterPath: string;
  characterTitle: string;
}

type RoleplaySession = AiSessionRecord<UIMessage>;

const SAVE_DELAY_MS = 500;
const RUN_POLL_INTERVAL_MS = 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function createRoleplaySession(
  characterPath: string,
  characterTitle: string,
): RoleplaySession {
  const now = nowIso();
  return {
    id: `roleplay-${Date.now()}`,
    title: `与「${characterTitle}」对话`,
    input: "",
    messages: [],
    events: [],
    mode: "character_roleplay",
    sourceRef: {
      type: "knowledge_base_item",
      itemType: "character",
      path: characterPath,
      title: characterTitle,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function createUserMessage(text: string): UIMessage {
  return {
    id: `user-${Date.now()}`,
    role: "user",
    parts: [{ type: "text", text }],
  } as UIMessage;
}

function sessionMatchesCharacter(
  session: RoleplaySession,
  characterPath: string,
): boolean {
  return (
    session.mode === "character_roleplay" &&
    session.sourceRef?.type === "knowledge_base_item" &&
    session.sourceRef.path === characterPath
  );
}

function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function eventLabel(event: AiStreamEvent): string {
  if (event.kind === "thinking") return `${event.title}：${event.detail}`;
  if (event.kind === "tool_start") return `调用工具：${event.toolName}`;
  if (event.kind === "tool_finish") {
    return event.error ? `工具失败：${event.toolName}` : `工具完成：${event.toolName}`;
  }
  return `文件变更：${event.operation.type}`;
}

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

export function CharacterRoleplayPanel({
  bookId,
  characterPath,
  characterTitle,
}: CharacterRoleplayPanelProps) {
  const [session, setSession] = useState<RoleplaySession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<AiWorkspaceUsageDiagnostics | undefined>();
  const otherSessionsRef = useRef<RoleplaySession[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);

  const busy = session?.activeRunStatus === "running";
  const input = session?.input ?? "";
  const messages = session?.messages ?? [];
  const latestAssistantId = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant")?.id,
    [messages],
  );

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setRunError(null);
    setLastUsage(undefined);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);

    aiSessionsApi
      .load(bookId)
      .then((history) => {
        if (cancelled) return;
        const allSessions = history.sessions as RoleplaySession[];
        const matched = allSessions.find((item) =>
          sessionMatchesCharacter(item, characterPath),
        );
        const nextSession =
          matched ?? createRoleplaySession(characterPath, characterTitle);
        otherSessionsRef.current = allSessions.filter(
          (item) => item.id !== nextSession.id,
        );
        activeSessionIdRef.current = history.activeSessionId;
        setSession({
          ...nextSession,
          title: `与「${characterTitle}」对话`,
          sourceRef: {
            type: "knowledge_base_item",
            itemType: "character",
            path: characterPath,
            title: characterTitle,
          },
        });
        loadedRef.current = true;
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        const fallback = createRoleplaySession(characterPath, characterTitle);
        setSession(fallback);
        loadedRef.current = true;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [bookId, characterPath, characterTitle]);

  function scheduleSave(nextSession: RoleplaySession) {
    if (!loadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void aiSessionsApi
        .save(bookId, {
          sessions: [...otherSessionsRef.current, nextSession],
          activeSessionId: activeSessionIdRef.current,
        })
        .then(() => setSaveError(null))
        .catch((err) =>
          setSaveError(err instanceof Error ? err.message : String(err)),
        );
    }, SAVE_DELAY_MS);
  }

  function updateSession(updater: (current: RoleplaySession) => RoleplaySession) {
    setSession((current) => {
      if (!current) return current;
      const next = updater(current);
      scheduleSave(next);
      return next;
    });
  }

  function applyRunSnapshot(snapshot: AiWorkspaceRunSnapshot<UIMessage>) {
    updateSession((current) => ({
      ...current,
      messages: snapshot.messages,
      events: snapshot.events,
      activeRunId: snapshot.runId,
      activeRunStatus: snapshot.status,
      updatedAt: nowIso(),
    }));
    if (snapshot.status === "failed") {
      setRunError(snapshot.error ?? "AI 运行失败");
    } else if (snapshot.status === "running") {
      setRunError(null);
    }
    if (snapshot.usage) {
      setLastUsage(snapshot.usage);
    }
  }

  function schedulePoll(runId: string) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      void pollRun(runId);
    }, RUN_POLL_INTERVAL_MS);
  }

  async function pollRun(runId: string) {
    try {
      const snapshot = await aiWorkspaceRunsApi.get(bookId, runId);
      applyRunSnapshot(snapshot);
      if (snapshot.status === "running") schedulePoll(runId);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submit() {
    const text = input.trim();
    if (!session || !text || busy) return;
    const userMessage = createUserMessage(text);
    const nextMessages = [...session.messages, userMessage];
    const nextSession: RoleplaySession = {
      ...session,
      input: "",
      messages: nextMessages,
      events: [],
      activeRunStatus: "running",
      activeRunId: undefined,
      updatedAt: nowIso(),
    };
    setSession(nextSession);
    scheduleSave(nextSession);
    setRunError(null);
    try {
      const snapshot = await aiWorkspaceRunsApi.start(bookId, {
        sessionId: session.id,
        messages: nextMessages,
        mode: "character_roleplay",
        roleplayCharacterPath: characterPath,
        contextPaths: [],
      });
      applyRunSnapshot(snapshot);
      if (snapshot.status === "running") schedulePoll(snapshot.runId);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
      updateSession((current) => ({
        ...current,
        activeRunStatus: "failed",
        updatedAt: nowIso(),
      }));
    }
  }

  async function cancelRun() {
    if (!session?.activeRunId) return;
    try {
      applyRunSnapshot(await aiWorkspaceRunsApi.cancel(bookId, session.activeRunId));
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="kb-roleplay-panel" aria-label="人物对话">
      <header className="kb-roleplay-header">
        <div>
          <h3>
            <MessageSquare size={14} aria-hidden="true" />
            <span>与「{characterTitle}」对话</span>
          </h3>
          <p>作者/上帝视角访谈，可只读参考资料库、章节、大纲和进度。</p>
        </div>
        {busy && <span className="kb-status-pill active">生成中</span>}
      </header>

      {loading && <div className="muted">正在加载人物对话...</div>}
      {loadError && <div className="error compact">加载失败：{loadError}</div>}
      {saveError && <div className="error compact">保存失败：{saveError}</div>}
      {runError && <div className="error compact">运行失败：{runError}</div>}

      <div className="roleplay-feed">
        {!loading && messages.length === 0 && (
          <div className="empty-state">
            你可以追问人物的隐秘动机、真实想法、关系判断、未来规划或某章事件的内心依据；需要时 AI 会只读查看相关项目文件。
          </div>
        )}
        {session?.events.length ? (
          <details className="roleplay-events">
            <summary>执行过程 · {session.events.length} 个事件</summary>
            {session.events.map((event) => (
              <p key={event.id ?? `${event.kind}-${event.createdAt}`}>
                {eventLabel(event)}
              </p>
            ))}
          </details>
        ) : null}
        <AiUsageSummary usage={lastUsage} />
        {messages.map((message) => {
          const isAssistant = message.role === "assistant";
          const text = messageText(message);
          if (!text.trim()) return null;
          return (
            <article
              key={message.id}
              className={`roleplay-message ${message.role} ${
                busy && message.id === latestAssistantId ? "streaming" : ""
              }`}
            >
              <span className="roleplay-speaker">
                {isAssistant ? characterTitle : "你"}
              </span>
              <div className="roleplay-bubble" data-color-mode="light">
                <MDEditor.Markdown source={text} />
              </div>
            </article>
          );
        })}
      </div>

      <div className="roleplay-composer">
        <textarea
          value={input}
          disabled={loading || busy}
          placeholder={`向「${characterTitle}」追问秘密、动机、关系、未来规划或某章事件...`}
          onChange={(event) =>
            updateSession((current) => ({
              ...current,
              input: event.target.value,
              updatedAt: nowIso(),
            }))
          }
          onKeyDown={(event) => {
            const composing =
              "isComposing" in event.nativeEvent &&
              event.nativeEvent.isComposing;
            if (composing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="roleplay-composer-footer">
          <span>Enter 发送 · Shift Enter 换行 · 上帝视角 · 只读查文件</span>
          {busy ? (
            <button className="icon-button btn-secondary" onClick={() => void cancelRun()}>
              <Square size={14} aria-hidden="true" />
              <span>停止</span>
            </button>
          ) : (
            <button
              className="icon-button primary"
              onClick={() => void submit()}
              disabled={!input.trim() || loading}
            >
              <Send size={14} aria-hidden="true" />
              <span>发送</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
