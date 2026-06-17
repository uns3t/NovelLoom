import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Plus,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import {
  AI_AGENT_DESCRIPTION_MAX_LEN,
  AI_AGENT_NAME_MAX_LEN,
  AI_AGENT_SYSTEM_PROMPT_MAX_LEN,
  type AiAgentConfig,
} from "@novelloom/shared";
import { aiAgentsApi } from "../api/aiAgents";
import { ConfirmModal } from "../components/Modal";

interface AgentSettingsProps {
  registerLeaveGuard?(guard: (() => boolean) | null): void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugifyAgentName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
  return slug || "agent";
}

function uniqueAgentId(name: string, agents: AiAgentConfig[]): string {
  const base = slugifyAgentName(name);
  const existing = new Set(agents.map((agent) => agent.id));
  if (!existing.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `agent-${Date.now()}`;
}

function formatTime(value: string): string {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function snapshot(agents: AiAgentConfig[], activeAgentId: string | null): string {
  return JSON.stringify({ agents, activeAgentId });
}

export function AgentSettings({ registerLeaveGuard }: AgentSettingsProps) {
  const [agents, setAgents] = useState<AiAgentConfig[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AiAgentConfig | null>(null);

  const dirty = useMemo(
    () => snapshot(agents, activeAgentId) !== lastSavedSnapshot,
    [activeAgentId, agents, lastSavedSnapshot],
  );
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  useEffect(() => {
    registerLeaveGuard?.(dirty ? () => false : null);
    return () => registerLeaveGuard?.(null);
  }, [dirty, registerLeaveGuard]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    aiAgentsApi
      .load()
      .then((data) => {
        if (cancelled) return;
        setAgents(data.agents);
        setActiveAgentId(data.activeAgentId);
        setSelectedAgentId(data.activeAgentId ?? data.agents[0]?.id ?? null);
        setLastSavedSnapshot(snapshot(data.agents, data.activeAgentId));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateAgent(agentId: string, patch: Partial<AiAgentConfig>) {
    const updatedAt = nowIso();
    setNotice(null);
    setAgents((current) =>
      current.map((agent) =>
        agent.id === agentId ? { ...agent, ...patch, updatedAt } : agent,
      ),
    );
  }

  function handleSelect(agentId: string) {
    if (agentId === selectedAgentId) return;
    if (dirty) {
      setPendingAgentId(agentId);
      return;
    }
    setSelectedAgentId(agentId);
  }

  function handleCreate() {
    const createdAt = nowIso();
    const name = "新 Agent";
    const next: AiAgentConfig = {
      id: uniqueAgentId(name, agents),
      name,
      description: "描述这个 Agent 擅长协助的创作方式。",
      systemPrompt: "你是一个小说创作 Agent。请说明你的题材能力、创作重点、需要优先读取的项目文件，以及在信息不足时应先询问的问题。",
      enabled: true,
      createdAt,
      updatedAt: createdAt,
    };
    setAgents((current) => [...current, next]);
    setSelectedAgentId(next.id);
    if (!activeAgentId) setActiveAgentId(next.id);
    setNotice(null);
  }

  function handleDelete(agent: AiAgentConfig) {
    setAgentToDelete(agent);
  }

  function confirmDeleteAgent() {
    if (!agentToDelete) return;
    const nextAgents = agents.filter((item) => item.id !== agentToDelete.id);
    const nextActiveAgentId =
      activeAgentId === agentToDelete.id
        ? nextAgents.find((item) => item.enabled)?.id ?? null
        : activeAgentId;
    setAgents(nextAgents);
    setActiveAgentId(nextActiveAgentId);
    setSelectedAgentId(nextAgents[0]?.id ?? null);
    setNotice(null);
    setAgentToDelete(null);
  }

  function confirmPendingAgentSwitch() {
    if (!pendingAgentId) return;
    setSelectedAgentId(pendingAgentId);
    setPendingAgentId(null);
  }

  function validateAgents(): string | null {
    for (const agent of agents) {
      if (!agent.name.trim()) return "Agent 名称不能为空";
      if (agent.name.length > AI_AGENT_NAME_MAX_LEN) return "Agent 名称过长";
      if (agent.description.length > AI_AGENT_DESCRIPTION_MAX_LEN) return "Agent 描述过长";
      if (!agent.systemPrompt.trim()) return `Agent「${agent.name}」的系统提示词不能为空`;
      if (agent.systemPrompt.length > AI_AGENT_SYSTEM_PROMPT_MAX_LEN) {
        return `Agent「${agent.name}」的系统提示词过长`;
      }
    }
    return null;
  }

  async function handleSave() {
    const validationError = validateAgents();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await aiAgentsApi.save({ agents, activeAgentId });
      setAgents(saved.agents);
      setActiveAgentId(saved.activeAgentId);
      setSelectedAgentId((current) =>
        current && saved.agents.some((agent) => agent.id === current)
          ? current
          : saved.activeAgentId ?? saved.agents[0]?.id ?? null,
      );
      setLastSavedSnapshot(snapshot(saved.agents, saved.activeAgentId));
      setNotice("Agent 设置已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agent-settings">
      <header className="agent-settings-header">
        <div>
          <h1>Agent 管理</h1>
          <p>配置全局共享的创作 Agent，在 AI 协作模块中按需切换。</p>
        </div>
        <div className="agent-settings-actions">
          {dirty && <span className="warning-tag">未保存</span>}
          <button className="icon-button primary" onClick={handleCreate}>
            <Plus size={15} aria-hidden="true" />
            <span>新建 Agent</span>
          </button>
          <button className="icon-button" onClick={() => void handleSave()} disabled={saving || !dirty}>
            <Save size={15} aria-hidden="true" />
            <span>{saving ? "保存中" : "保存"}</span>
          </button>
        </div>
      </header>

      {error && <div className="error compact">错误：{error}</div>}
      {notice && <div className="agent-notice">{notice}</div>}

      {loading ? (
        <div className="agent-settings-loading muted">正在加载 Agent 设置...</div>
      ) : (
        <div className="agent-settings-grid">
          <aside className="agent-list" aria-label="Agent 列表">
            {agents.length === 0 ? (
              <div className="empty-state">还没有 Agent，点击右上角“新建 Agent”开始配置。</div>
            ) : (
              agents.map((agent) => (
                <button
                  key={agent.id}
                  className={`agent-list-item ${agent.id === selectedAgentId ? "active" : ""}`}
                  onClick={() => handleSelect(agent.id)}
                >
                  <span className="agent-list-icon" aria-hidden="true">
                    <Bot size={15} />
                  </span>
                  <span className="agent-list-copy">
                    <strong>{agent.name}</strong>
                    <small>{agent.description || "暂无描述"}</small>
                    <span className="agent-list-meta">
                      {agent.enabled ? "已启用" : "已禁用"}
                      {agent.builtIn ? " · 预置" : ""}
                      {activeAgentId === agent.id ? " · 默认" : ""}
                    </span>
                  </span>
                </button>
              ))
            )}
          </aside>

          <section className="agent-editor">
            {selectedAgent ? (
              <>
                <div className="agent-editor-header">
                  <div>
                    <h2>{selectedAgent.name}</h2>
                    <p>ID：{selectedAgent.id}</p>
                  </div>
                  <div className="agent-editor-actions">
                    {selectedAgent.builtIn && <span className="agent-status-pill">预置</span>}
                    {activeAgentId === selectedAgent.id && <span className="agent-status-pill active">默认</span>}
                    <button
                      className="icon-button"
                      onClick={() => setActiveAgentId(selectedAgent.id)}
                      disabled={!selectedAgent.enabled || activeAgentId === selectedAgent.id}
                    >
                      <Star size={14} aria-hidden="true" />
                      <span>设为默认</span>
                    </button>
                    <button className="btn-danger icon-button" onClick={() => handleDelete(selectedAgent)}>
                      <Trash2 size={14} aria-hidden="true" />
                      <span>删除</span>
                    </button>
                  </div>
                </div>

                <div className="agent-form">
                  <label className="agent-field">
                    <span>名称</span>
                    <input
                      value={selectedAgent.name}
                      maxLength={AI_AGENT_NAME_MAX_LEN}
                      onChange={(event) => updateAgent(selectedAgent.id, { name: event.target.value })}
                    />
                  </label>

                  <label className="agent-field">
                    <span>描述</span>
                    <textarea
                      value={selectedAgent.description}
                      maxLength={AI_AGENT_DESCRIPTION_MAX_LEN}
                      onChange={(event) => updateAgent(selectedAgent.id, { description: event.target.value })}
                    />
                  </label>

                  <label className="agent-field">
                    <span>系统提示词</span>
                    <textarea
                      className="agent-prompt-textarea"
                      rows={15}
                      value={selectedAgent.systemPrompt}
                      maxLength={AI_AGENT_SYSTEM_PROMPT_MAX_LEN}
                      onChange={(event) => updateAgent(selectedAgent.id, { systemPrompt: event.target.value })}
                    />
                  </label>

                  <label className="agent-toggle">
                    <input
                      type="checkbox"
                      checked={selectedAgent.enabled}
                      onChange={(event) => {
                        updateAgent(selectedAgent.id, { enabled: event.target.checked });
                        if (!event.target.checked && activeAgentId === selectedAgent.id) {
                          setActiveAgentId(agents.find((agent) => agent.id !== selectedAgent.id && agent.enabled)?.id ?? null);
                        }
                      }}
                    />
                    <span>
                      <CheckCircle2 size={14} aria-hidden="true" />
                      在 AI 协作面板中启用
                    </span>
                  </label>

                  <div className="agent-editor-footnote">
                    <span>创建：{formatTime(selectedAgent.createdAt)}</span>
                    <span>更新：{formatTime(selectedAgent.updatedAt)}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="editor-empty">
                <span>AI</span>
                <h3>选择或创建一个 Agent</h3>
                <p>Agent 会通过角色提示词影响 AI 协作模块的思考方式、追问策略和创作输出。</p>
              </div>
            )}
          </section>
        </div>
      )}

      <ConfirmModal
        open={pendingAgentId !== null}
        title="切换编辑其他 Agent？"
        description="当前 Agent 设置有未保存修改，切换后请记得保存，否则这些修改可能会丢失。"
        confirmLabel="仍要切换"
        cancelLabel="继续编辑"
        tone="danger"
        onConfirm={confirmPendingAgentSwitch}
        onCancel={() => setPendingAgentId(null)}
      />

      <ConfirmModal
        open={agentToDelete !== null}
        title={agentToDelete ? `删除 Agent「${agentToDelete.name}」？` : "删除 Agent？"}
        description="删除后需要保存设置才会持久生效。"
        confirmLabel="删除"
        cancelLabel="取消"
        tone="danger"
        onConfirm={confirmDeleteAgent}
        onCancel={() => setAgentToDelete(null)}
      />
    </div>
  );
}
