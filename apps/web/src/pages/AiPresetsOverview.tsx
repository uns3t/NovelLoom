import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  Braces,
  CheckCircle2,
  Code2,
  FileText,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import type {
  AiAgentConfig,
  AiPresetSlashCommand,
  AiPresetsOverviewResponse,
} from "@novelloom/shared";
import { aiPresetsApi } from "../api/aiPresets";

function formatTime(value: string): string {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function statusText(
  agent: AiAgentConfig,
  activeAgentId: string | null,
): string {
  const parts = [agent.enabled ? "已启用" : "已禁用"];
  if (agent.builtIn) parts.push("预置");
  if (agent.id === activeAgentId) parts.push("默认");
  return parts.join(" · ");
}

function SectionTitle({
  id,
  icon,
  title,
  description,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <header className="ai-presets-section-header" id={id}>
      <span className="ai-presets-section-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

function SlashCommandCard({ command }: { command: AiPresetSlashCommand }) {
  return (
    <article className="ai-presets-card">
      <div className="ai-presets-card-header">
        <code>{command.name}</code>
        <strong>{command.label}</strong>
      </div>
      <p>{command.description}</p>
      <div className="ai-presets-prompt-pair">
        <div>
          <span>基础 prompt</span>
          <pre className="ai-presets-pre">{command.prompt}</pre>
        </div>
      </div>
    </article>
  );
}

export function AiPresetsOverview() {
  const [overview, setOverview] = useState<AiPresetsOverviewResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    aiPresetsApi
      .load()
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const slashCommands = overview?.slashCommands ?? [];
  const enabledAgentCount =
    overview?.agents.filter((agent) => agent.enabled).length ?? 0;

  return (
    <div className="ai-presets">
      <header className="ai-presets-header">
        <div>
          <h1>AI 预设</h1>
          <p>
            查看当前 AI 交互时会用到的
            Agent、快捷命令、书籍级创作规格、运行时 Prompt、工具能力和运行设置。
            如需修改请直接修改代码或对应项目文件。
          </p>
        </div>
        <div className="ai-presets-stats" aria-label="AI 预设统计">
          <span>{overview?.agents.length ?? 0} 个 Agent</span>
          <span>{enabledAgentCount} 个启用</span>
          <span>{overview?.tools.length ?? 0} 个工具</span>
          <span>{slashCommands.length} 个命令</span>
        </div>
      </header>

      {error && <div className="error compact">AI 预设加载失败：{error}</div>}
      {loading && (
        <div className="ai-presets-loading muted">正在加载 AI 预设...</div>
      )}

      {!loading && overview && (
        <div className="ai-presets-grid">
          <nav className="ai-presets-nav" aria-label="AI 预设目录">
            <a href="#ai-presets-agents">Skill / Agent</a>
            <a href="#ai-presets-commands">快捷命令</a>
            <a href="#ai-presets-prompts">运行时 Prompt</a>
            <a href="#ai-presets-tools">工具能力</a>
            <a href="#ai-presets-settings">运行设置</a>
          </nav>

          <div className="ai-presets-content">
            <section
              className="ai-presets-section"
              aria-labelledby="ai-presets-agents"
            >
              <SectionTitle
                id="ai-presets-agents"
                icon={<Bot size={15} />}
                title="Skill / Agent"
                description="当前可被 AI 协作面板选择的创作角色，以及它们注入运行时 Prompt 的角色设定。"
              />

              {overview.agents.length === 0 ? (
                <div className="empty-state">当前没有 Agent 配置。</div>
              ) : (
                <div className="ai-presets-card-grid">
                  {overview.agents.map((agent) => (
                    <article key={agent.id} className="ai-presets-card agent">
                      <div className="ai-presets-card-header">
                        <strong>{agent.name}</strong>
                        <span
                          className={
                            agent.enabled
                              ? "agent-status-pill active"
                              : "agent-status-pill"
                          }
                        >
                          {statusText(agent, overview.activeAgentId)}
                        </span>
                      </div>
                      <p>{agent.description || "暂无描述"}</p>
                      <div className="ai-presets-meta">
                        <span>ID：{agent.id}</span>
                        <span>创建：{formatTime(agent.createdAt)}</span>
                        <span>更新：{formatTime(agent.updatedAt)}</span>
                      </div>
                      <details className="ai-presets-details">
                        <summary>查看角色提示词</summary>
                        <pre className="ai-presets-pre">
                          {agent.systemPrompt}
                        </pre>
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section
              className="ai-presets-section"
              aria-labelledby="ai-presets-commands"
            >
              <SectionTitle
                id="ai-presets-commands"
                icon={<TerminalSquare size={15} />}
                title="快捷命令"
                description="Web AI 协作输入框中的 slash command 预设，会把用户选择展开成任务文本，并按需读取书籍级创作规格。"
              />
              <div className="ai-presets-card-grid compact">
                {slashCommands.length === 0 ? (
                  <div className="empty-state">当前没有快捷命令预设。</div>
                ) : (
                  slashCommands.map((command) => (
                    <SlashCommandCard key={command.name} command={command} />
                  ))
                )}
              </div>
            </section>

            <section
              className="ai-presets-section"
              aria-labelledby="ai-presets-prompts"
            >
              <SectionTitle
                id="ai-presets-prompts"
                icon={<FileText size={15} />}
                title="运行时 Prompt"
                description="后端 AI workspace 实际拼装的运行时 prompt 分区，包括基础规则、Agent 注入和上下文文件注入；单书创作规则来自 novel-spec.md。"
              />

              <div className="ai-presets-prompt-pair">
                <div>
                  <span>运行时注入分区</span>
                </div>
              </div>
              <div className="ai-presets-card-grid">
                {overview.promptSections.map((section) => (
                  <article key={section.id} className="ai-presets-card">
                    <div className="ai-presets-card-header">
                      <strong>{section.title}</strong>
                      <small>{section.source}</small>
                    </div>
                    <pre className="ai-presets-pre">{section.content}</pre>
                  </article>
                ))}
              </div>
            </section>

            <section
              className="ai-presets-section"
              aria-labelledby="ai-presets-tools"
            >
              <SectionTitle
                id="ai-presets-tools"
                icon={<Code2 size={15} />}
                title="工具能力"
                description="AI 可调用的后端项目文件工具，其中写入类工具会修改当前书籍的本地项目文件。"
              />
              <div className="ai-presets-card-grid compact">
                {overview.tools.map((tool) => (
                  <article key={tool.name} className="ai-presets-card">
                    <div className="ai-presets-card-header">
                      <code>{tool.name}</code>
                      {tool.canChangeFiles ? (
                        <span className="ai-presets-warning-pill">
                          会修改项目文件
                        </span>
                      ) : (
                        <span className="agent-status-pill">只读</span>
                      )}
                    </div>
                    <p>{tool.description}</p>
                    <div className="ai-presets-meta">
                      <span>入参：{tool.inputSchemaSummary}</span>
                      <span>
                        文件操作：
                        {tool.changeOperationTypes.length > 0
                          ? tool.changeOperationTypes.join(", ")
                          : "无"}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section
              className="ai-presets-section"
              aria-labelledby="ai-presets-settings"
            >
              <SectionTitle
                id="ai-presets-settings"
                icon={<Settings2 size={15} />}
                title="运行设置"
                description="AI workspace 的模型、上下文、工具调用和流式输出设置；敏感密钥不会在此展示。"
              />
              <div className="ai-presets-setting-list">
                {overview.runtimeSettings.map((setting) => (
                  <article key={setting.key} className="ai-presets-setting-row">
                    <span
                      className="ai-presets-setting-icon"
                      aria-hidden="true"
                    >
                      {setting.key === "filePathValidation" ? (
                        <Braces size={13} />
                      ) : (
                        <CheckCircle2 size={13} />
                      )}
                    </span>
                    <div>
                      <strong>{setting.label}</strong>
                      <p>{setting.description}</p>
                    </div>
                    <code>{setting.value}</code>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
