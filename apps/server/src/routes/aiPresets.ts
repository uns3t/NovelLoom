import type { FastifyInstance } from "fastify";
import {
  AI_SLASH_COMMANDS,
  toAiPresetSlashCommand,
  type AiPresetsOverviewResponse,
} from "@novelloom/shared";
import {
  InvalidIdError,
  readAiAgents,
} from "../books/storage.js";
import {
  describeAiWorkspacePromptSections,
  describeAiWorkspaceTools,
  getAiWorkspaceRuntimeSettings,
} from "./aiWorkspace.js";

export async function aiPresetsRoutes(app: FastifyInstance) {
  app.get("/api/ai-presets", async (_req, reply) => {
    try {
      const agentsConfig = await readAiAgents();
      const response: AiPresetsOverviewResponse = {
        agents: agentsConfig.agents,
        activeAgentId: agentsConfig.activeAgentId,
        slashCommands: AI_SLASH_COMMANDS.map((command) => toAiPresetSlashCommand(command)),
        tools: describeAiWorkspaceTools(),
        promptSections: describeAiWorkspacePromptSections(),
        runtimeSettings: getAiWorkspaceRuntimeSettings(),
        updatedAt: agentsConfig.updatedAt,
      };
      return response;
    } catch (err) {
      if (err instanceof InvalidIdError) {
        reply.code(400);
        return { error: "Invalid input", details: err.message };
      }
      app.log.error(err);
      reply.code(500);
      return { error: "Internal error" };
    }
  });
}
