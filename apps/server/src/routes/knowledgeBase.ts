import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BOOK_ID_REGEX,
  MARKDOWN_MAX_LEN,
  TITLE_MAX_LEN,
  type CreateKnowledgeBaseItemRequest,
  type KnowledgeBaseItemType,
  type UpdateKnowledgeBaseItemRequest,
} from "@novelloom/shared";
import {
  ConflictError,
  InvalidIdError,
  NotFoundError,
  createKnowledgeBaseItem,
  deleteKnowledgeBaseItem,
  knowledgeBaseTypeFromString,
  listKnowledgeBaseItems,
  readKnowledgeBaseItem,
  updateKnowledgeBaseItem,
} from "../books/storage.js";

const IdSchema = z.string().regex(BOOK_ID_REGEX);
const KnowledgeBaseTypeSchema = z.enum([
  "character",
  "world",
  "item",
] satisfies [KnowledgeBaseItemType, ...KnowledgeBaseItemType[]]);
const KnowledgeBaseItemIdSchema = z.string().trim().min(1).max(128);

const BookIdParams = z.object({ bookId: IdSchema });
const ItemParams = BookIdParams.extend({
  type: KnowledgeBaseTypeSchema,
  id: KnowledgeBaseItemIdSchema,
});
const ListQuery = z.object({
  type: KnowledgeBaseTypeSchema.optional(),
});

const CreateBody = z.object({
  type: KnowledgeBaseTypeSchema,
  title: z.string().trim().min(1).max(TITLE_MAX_LEN),
}) satisfies z.ZodType<CreateKnowledgeBaseItemRequest>;

const UpdateBody = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX_LEN),
  content: z.string().max(MARKDOWN_MAX_LEN),
}) satisfies z.ZodType<UpdateKnowledgeBaseItemRequest>;

type Handler = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown> | unknown;

function wrap(app: FastifyInstance, handler: Handler): Handler {
  return async (req, reply) => {
    try {
      return await handler(req, reply);
    } catch (err) {
      if (err instanceof InvalidIdError || err instanceof z.ZodError) {
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

export async function knowledgeBaseRoutes(app: FastifyInstance) {
  app.get(
    "/api/books/:bookId/knowledge-base",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      const query = parseOrFail(ListQuery, req.query, reply);
      if (!query) return reply;
      return await listKnowledgeBaseItems(
        params.bookId,
        query.type ? knowledgeBaseTypeFromString(query.type) : undefined,
      );
    }),
  );

  app.post(
    "/api/books/:bookId/knowledge-base",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      const body = parseOrFail(CreateBody, req.body, reply);
      if (!body) return reply;
      reply.code(201);
      return await createKnowledgeBaseItem(params.bookId, {
        type: knowledgeBaseTypeFromString(body.type),
        title: body.title,
      });
    }),
  );

  app.get(
    "/api/books/:bookId/knowledge-base/:type/:id",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(ItemParams, req.params, reply);
      if (!params) return reply;
      return await readKnowledgeBaseItem(
        params.bookId,
        knowledgeBaseTypeFromString(params.type),
        params.id,
      );
    }),
  );

  app.put(
    "/api/books/:bookId/knowledge-base/:type/:id",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(ItemParams, req.params, reply);
      if (!params) return reply;
      const body = parseOrFail(UpdateBody, req.body, reply);
      if (!body) return reply;
      return await updateKnowledgeBaseItem(
        params.bookId,
        knowledgeBaseTypeFromString(params.type),
        params.id,
        body,
      );
    }),
  );

  app.delete(
    "/api/books/:bookId/knowledge-base/:type/:id",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(ItemParams, req.params, reply);
      if (!params) return reply;
      await deleteKnowledgeBaseItem(
        params.bookId,
        knowledgeBaseTypeFromString(params.type),
        params.id,
      );
      return { ok: true };
    }),
  );
}
