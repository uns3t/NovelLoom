import { useRef, useState } from "react";
import type { AgentEvent, AgentStage } from "@novelloom/shared";
import { runNovel } from "./api/runNovel";

const STAGES: { key: AgentStage; label: string }[] = [
  { key: "ideation", label: "构思" },
  { key: "outline", label: "大纲" },
  { key: "chapter", label: "章节草稿" },
];

interface StageState {
  text: string;
  done: boolean;
  toolCalls: string[];
}

type StageMap = Record<AgentStage, StageState>;

const emptyStages: StageMap = {
  ideation: { text: "", done: false, toolCalls: [] },
  outline: { text: "", done: false, toolCalls: [] },
  chapter: { text: "", done: false, toolCalls: [] },
};

export function App() {
  const [premise, setPremise] = useState(
    "在一座漂浮于云海之上的图书馆中，少年发现一本能修改命运的旧书。",
  );
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<StageMap>(emptyStages);
  const [activeStage, setActiveStage] = useState<AgentStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalChapter, setFinalChapter] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  function handleEvent(ev: AgentEvent) {
    switch (ev.type) {
      case "agent_started":
        setActiveStage(ev.stage);
        setStages((s) => ({
          ...s,
          [ev.stage]: { text: "", done: false, toolCalls: [] },
        }));
        break;
      case "token":
        setStages((s) => ({
          ...s,
          [ev.stage]: { ...s[ev.stage], text: s[ev.stage].text + ev.delta },
        }));
        break;
      case "tool_call":
        setStages((s) => ({
          ...s,
          [ev.stage]: {
            ...s[ev.stage],
            toolCalls: [...s[ev.stage].toolCalls, ev.toolName],
          },
        }));
        break;
      case "agent_finished":
        setStages((s) => ({
          ...s,
          [ev.stage]: { ...s[ev.stage], text: ev.output, done: true },
        }));
        break;
      case "done":
        setFinalChapter(ev.finalChapter);
        setActiveStage(null);
        break;
      case "error":
        setError(ev.message);
        setActiveStage(null);
        break;
    }
  }

  async function start() {
    setError(null);
    setFinalChapter("");
    setStages(emptyStages);
    setRunning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await runNovel({ premise }, handleEvent, ctrl.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="app">
      <aside className="panel">
        <h2>NovelLoom · 小说创作工作台</h2>
        <label htmlFor="premise">小说设定 / 起点</label>
        <textarea
          id="premise"
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          disabled={running}
        />
        {!running ? (
          <button onClick={start} disabled={!premise.trim()}>
            开始创作
          </button>
        ) : (
          <button onClick={stop}>停止</button>
        )}
        {error && <div className="error">错误：{error}</div>}
      </aside>

      <main className="panel">
        {STAGES.map(({ key, label }) => {
          const s = stages[key];
          const isActive = activeStage === key;
          return (
            <section
              key={key}
              className={`stage ${isActive ? "active" : ""}`}
            >
              <h3>
                {label}
                {isActive ? " · 进行中" : s.done ? " · 完成" : ""}
                {s.toolCalls.length > 0
                  ? ` · 工具：${s.toolCalls.join(", ")}`
                  : ""}
              </h3>
              <pre>{s.text || (isActive ? "…" : "")}</pre>
            </section>
          );
        })}
        {finalChapter && (
          <section className="stage">
            <h3>最终章节</h3>
            <pre>{finalChapter}</pre>
          </section>
        )}
      </main>
    </div>
  );
}
