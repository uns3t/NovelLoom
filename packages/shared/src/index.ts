/**
 * Shared protocol types between NovelLoom frontend (apps/web)
 * and backend (apps/server).
 */

/** Stages in the novel-creation pipeline. */
export type AgentStage = "ideation" | "outline" | "chapter";

/** POST /api/novel/run request body. */
export interface RunNovelRequest {
  premise: string;
}

/** An agent has started working on its stage. */
export interface AgentStartedEvent {
  type: "agent_started";
  stage: AgentStage;
  agentName: string;
}

/** A streamed text delta produced by the currently-running agent. */
export interface TokenEvent {
  type: "token";
  stage: AgentStage;
  delta: string;
}

/** A tool call performed by the agent (name + arguments preview). */
export interface ToolCallEvent {
  type: "tool_call";
  stage: AgentStage;
  toolName: string;
  argsPreview?: string;
}

/** An agent finished its stage with the final aggregated text output. */
export interface AgentFinishedEvent {
  type: "agent_finished";
  stage: AgentStage;
  agentName: string;
  output: string;
}

/** The whole pipeline completed successfully. */
export interface DoneEvent {
  type: "done";
  finalChapter: string;
}

/** A fatal error happened; the connection will be closed afterwards. */
export interface ErrorEvent {
  type: "error";
  message: string;
}

export type AgentEvent =
  | AgentStartedEvent
  | TokenEvent
  | ToolCallEvent
  | AgentFinishedEvent
  | DoneEvent
  | ErrorEvent;

/** SSE event name used on the wire (single channel for simplicity). */
export const SSE_EVENT_NAME = "agent";
