import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AI_SESSION_HISTORY_MAX_BYTES,
  AI_SESSION_INPUT_MAX_LEN,
  AI_SESSION_MAX_COUNT,
  AI_SESSION_TITLE_MAX_LEN,
  BOOK_ID_REGEX,
  MARKDOWN_MAX_LEN,
  PROJECT_FILE_PATH_MAX_LEN,
  PROJECT_FILE_PATH_REGEX,
  type UpdateAiSessionsRequest,
} from "@novelloom/shared";
import {
  ConflictError,
  InvalidIdError,
  NotFoundError,
  readAiSessions,
  writeAiSessions,
} from "../books/storage.js";

const IdSchema = z.string().regex(BOOK_ID_REGEX);
const BookIdParams = z.object({ bookId: IdSchema });
const ProjectPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROJECT_FILE_PATH_MAX_LEN)
  .regex(PROJECT_FILE_PATH_REGEX);
const ContentSchema = z.string().max(MARKDOWN_MAX_LEN);

const ProjectFileOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_file"),
    path: ProjectPathSchema,
    content: ContentSchema.optional(),
  }),
  z.object({
    type: z.literal("create_directory"),
    path: ProjectPathSchema,
  }),
  z.object({
    type: z.literal("write_file"),
    path: ProjectPathSchema,
    content: ContentSchema,
  }),
  z.object({
    type: z.literal("rename"),
    fromPath: ProjectPathSchema,
    toPath: ProjectPathSchema,
  }),
  z.object({
    type: z.literal("delete"),
    path: ProjectPathSchema,
    recursive: z.boolean().optional(),
  }),
]);

const AiStreamEventSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().optional(),
    kind: z.literal("thinking"),
    title: z.string(),
    detail: z.string(),
    createdAt: z.string().optional(),
  }),
  z.object({
    id: z.string().optional(),
    kind: z.literal("tool_start"),
    toolCallId: z.string().optional(),
    toolName: z.string(),
    input: z.any(),
    createdAt: z.string().optional(),
  }),
  z.object({
    id: z.string().optional(),
    kind: z.literal("tool_finish"),
    toolCallId: z.string().optional(),
    toolName: z.string(),
    durationMs: z.number().optional(),
    output: z.any().optional(),
    error: z.string().optional(),
    createdAt: z.string().optional(),
  }),
  z.object({
    id: z.string().optional(),
    kind: z.literal("file_changed"),
    operation: ProjectFileOperationSchema,
    createdAt: z.string().optional(),
  }),
]);

const AiWorkspaceRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "cancelled",
]);
const AiSessionModeSchema = z.enum(["workspace", "character_roleplay"]);
const KnowledgeBaseItemTypeSchema = z.enum(["character", "world", "item"]);
const AiDraftFileChangeSchema = z.object({
  path: ProjectPathSchema,
  status: z.enum(["created", "modified"]),
  baseHash: z.string().nullable(),
  draftHash: z.string(),
  additions: z.number(),
  deletions: z.number(),
  diff: z.string(),
  draftContent: ContentSchema,
});
const AiDraftChangeSetSchema = z.object({
  runId: z.string().trim().min(1).max(128),
  status: z.enum(["pending_review", "applied", "discarded"]),
  files: z.array(AiDraftFileChangeSchema).max(20),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const AiSessionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(AI_SESSION_TITLE_MAX_LEN),
  input: z.string().max(AI_SESSION_INPUT_MAX_LEN),
  messages: z.array(z.any()),
  events: z.array(AiStreamEventSchema),
  pendingChanges: AiDraftChangeSetSchema.optional(),
  mode: AiSessionModeSchema,
  sourceRef: z.object({
    type: z.literal("knowledge_base_item"),
    itemType: KnowledgeBaseItemTypeSchema,
    path: ProjectPathSchema,
    title: z.string().trim().min(1).max(AI_SESSION_TITLE_MAX_LEN),
  }).optional(),
  activeRunId: z.string().optional(),
  activeRunStatus: AiWorkspaceRunStatusSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const UpdateAiSessionsBody = z.object({
  sessions: z.array(AiSessionSchema).max(AI_SESSION_MAX_COUNT),
  activeSessionId: z.string().nullable(),
}) satisfies z.ZodType<UpdateAiSessionsRequest>;

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
      if (err instanceof NotFoundError) {
        reply.code(404);
        return { error: "Not found" };
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

export async function aiSessionsRoutes(app: FastifyInstance) {
  app.get(
    "/api/books/:bookId/ai-sessions",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      return await readAiSessions(params.bookId);
    }),
  );

  app.put(
    "/api/books/:bookId/ai-sessions",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      if (JSON.stringify(req.body).length > AI_SESSION_HISTORY_MAX_BYTES) {
        reply.code(400);
        return { error: "Invalid input", details: "AI session history is too large" };
      }
      const body = parseOrFail(UpdateAiSessionsBody, req.body, reply);
      if (!body) return reply;
      return await writeAiSessions(params.bookId, body);
    }),
  );
}
