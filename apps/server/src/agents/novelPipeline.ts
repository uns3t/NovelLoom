import { Agent, run } from "@openai/agents";
import type {
  AgentEvent,
  AgentStage,
} from "@novelloom/shared";
import { env } from "../env.js";

export interface PipelineCallbacks {
  emit(event: AgentEvent): void;
}

interface StageDef {
  stage: AgentStage;
  agent: Agent;
  buildInput(prev: { premise: string; ideation?: string; outline?: string }): string;
}

function makeAgents() {
  const ideation = new Agent({
    name: "Ideation",
    model: env.MODEL,
    instructions:
      "You are a novel ideation specialist. Given a premise, produce 3-5 concise creative angles, themes, and tone suggestions in Chinese. Keep it under 200 words.",
  });

  const outline = new Agent({
    name: "Outliner",
    model: env.MODEL,
    instructions:
      "You are a novel outliner. Based on the ideation notes, write a tight chapter-1 outline in Chinese: setting, main characters, inciting incident, and 4-6 beats. Keep it under 300 words.",
  });

  const chapter = new Agent({
    name: "ChapterWriter",
    model: env.MODEL,
    instructions:
      "You are a literary novelist. Based on the outline, write the opening of chapter 1 in Chinese, around 600-900 words, vivid prose, show-don't-tell.",
  });

  return { ideation, outline, chapter };
}

/** Run the 3-stage pipeline, emitting AgentEvent through cb.emit. */
export async function runNovelPipeline(
  premise: string,
  cb: PipelineCallbacks,
): Promise<string> {
  const { ideation, outline, chapter } = makeAgents();

  const stages: StageDef[] = [
    {
      stage: "ideation",
      agent: ideation,
      buildInput: ({ premise: p }) => `Premise:\n${p}`,
    },
    {
      stage: "outline",
      agent: outline,
      buildInput: ({ premise: p, ideation: i }) =>
        `Premise:\n${p}\n\nIdeation Notes:\n${i ?? ""}`,
    },
    {
      stage: "chapter",
      agent: chapter,
      buildInput: ({ premise: p, ideation: i, outline: o }) =>
        `Premise:\n${p}\n\nIdeation Notes:\n${i ?? ""}\n\nOutline:\n${o ?? ""}`,
    },
  ];

  const ctx: { premise: string; ideation?: string; outline?: string } = {
    premise,
  };

  for (const def of stages) {
    cb.emit({
      type: "agent_started",
      stage: def.stage,
      agentName: def.agent.name,
    });

    const input = def.buildInput(ctx);
    const result = await run(def.agent, input, { stream: true });

    let aggregated = "";
    for await (const ev of result) {
      // Token deltas
      if (
        ev.type === "raw_model_stream_event" &&
        ev.data?.type === "output_text_delta"
      ) {
        const delta = (ev.data as { delta?: string }).delta ?? "";
        if (delta) {
          aggregated += delta;
          cb.emit({ type: "token", stage: def.stage, delta });
        }
      } else if (ev.type === "run_item_stream_event") {
        const item = (ev as { item?: { type?: string; rawItem?: unknown } }).item;
        if (item?.type === "tool_call_item") {
          const raw = item.rawItem as
            | { name?: string; arguments?: string }
            | undefined;
          cb.emit({
            type: "tool_call",
            stage: def.stage,
            toolName: raw?.name ?? "unknown",
            argsPreview: raw?.arguments?.slice(0, 200),
          });
        }
      }
    }
    await result.completed;

    const finalOutput =
      (typeof result.finalOutput === "string" ? result.finalOutput : aggregated) ||
      aggregated;

    cb.emit({
      type: "agent_finished",
      stage: def.stage,
      agentName: def.agent.name,
      output: finalOutput,
    });

    if (def.stage === "ideation") ctx.ideation = finalOutput;
    if (def.stage === "outline") ctx.outline = finalOutput;
    if (def.stage === "chapter") return finalOutput;
  }

  return "";
}
