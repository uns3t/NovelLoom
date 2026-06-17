import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AI_AGENTS_PAYLOAD_MAX_BYTES,
  AI_AGENT_DESCRIPTION_MAX_LEN,
  AI_AGENT_ID_REGEX,
  AI_AGENT_MAX_COUNT,
  AI_AGENT_NAME_MAX_LEN,
  AI_AGENT_SYSTEM_PROMPT_MAX_LEN,
  type UpdateAiAgentsRequest,
} from "@novelloom/shared";
import {
  ConflictError,
  InvalidIdError,
  readAiAgents,
  writeAiAgents,
} from "../books/storage.js";

const AgentIdSchema = z.string().regex(AI_AGENT_ID_REGEX);

const AiAgentSchema = z.object({
  id: AgentIdSchema,
  name: z.string().trim().min(1).max(AI_AGENT_NAME_MAX_LEN),
  description: z.string().trim().max(AI_AGENT_DESCRIPTION_MAX_LEN),
  systemPrompt: z.string().trim().min(1).max(AI_AGENT_SYSTEM_PROMPT_MAX_LEN),
  enabled: z.boolean(),
  builtIn: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const UpdateAiAgentsBody = z
  .object({
    agents: z.array(AiAgentSchema).max(AI_AGENT_MAX_COUNT),
    activeAgentId: AgentIdSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const agent of value.agents) {
      if (seen.has(agent.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents"],
          message: `Duplicate agent id: ${agent.id}`,
        });
      }
      seen.add(agent.id);
    }
    if (value.activeAgentId && !seen.has(value.activeAgentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeAgentId"],
        message: "Active agent does not exist",
      });
    }
  }) satisfies z.ZodType<UpdateAiAgentsRequest>;

type Handler = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown> | unknown;

function wrap(app: FastifyInstance, handler: Handler): Handler {
  return async (req, reply) => {
    try {
      return await handler(req, reply);
    } catch (err) {
      if (err instanceof InvalidIdError) {
        reply.code(400);
        return { error: "Invalid input", details: err.message };
      }
      if (err instanceof ConflictError) {
        reply.code(409);
        return { error: "Conflict", details: err.message };
      }
      app.log.error(err);
      reply.code(500);
      return { error: "Internal error" };
    }
  };
}

function parseOrFail<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: unknown,
  reply: FastifyReply,
): T | undefined {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    reply.code(400);
    reply.send({ error: "Invalid input", details: parsed.error.flatten() });
    return undefined;
  }
  return parsed.data;
}

export async function aiAgentsRoutes(app: FastifyInstance) {
  app.get(
    "/api/ai-agents",
    wrap(app, async () => {
      return await readAiAgents();
    }),
  );

  app.put(
    "/api/ai-agents",
    wrap(app, async (req, reply) => {
      if (JSON.stringify(req.body).length > AI_AGENTS_PAYLOAD_MAX_BYTES) {
        reply.code(400);
        return { error: "Invalid input", details: "AI agents config is too large" };
      }
      const body = parseOrFail(UpdateAiAgentsBody, req.body, reply);
      if (!body) return reply;
      return await writeAiAgents(body);
    }),
  );
}
