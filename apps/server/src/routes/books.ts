import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BOOK_ID_REGEX,
  TITLE_MAX_LEN,
} from "@novelloom/shared";
import {
  InvalidIdError,
  NotFoundError,
  createBook,
  deleteBook,
  listBooks,
  renameBook,
} from "../books/storage.js";

const TitleSchema = z.string().trim().min(1).max(TITLE_MAX_LEN);
const IdSchema = z.string().regex(BOOK_ID_REGEX);

const CreateBookBody = z.object({ title: TitleSchema });
const UpdateBookBody = z.object({ title: TitleSchema });

const BookIdParams = z.object({ bookId: IdSchema });

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
      app.log.error(err);
      reply.code(500);
      if (err instanceof Error) {
        return {
          error: "Internal error",
          details: err.message,
          code: (err as NodeJS.ErrnoException).code,
        };
      }
      return { error: "Internal error" };
    }
  };
}

function parseOrFail<T>(
  schema: z.ZodType<T>,
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

export async function bookRoutes(app: FastifyInstance) {
  app.get(
    "/api/books",
    wrap(app, async () => {
      return await listBooks();
    }),
  );

  app.post(
    "/api/books",
    wrap(app, async (req, reply) => {
      const body = parseOrFail(CreateBookBody, req.body, reply);
      if (!body) return reply;
      return await createBook(body.title);
    }),
  );

  app.patch(
    "/api/books/:bookId",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      const body = parseOrFail(UpdateBookBody, req.body, reply);
      if (!body) return reply;
      return await renameBook(params.bookId, body.title);
    }),
  );

  app.delete(
    "/api/books/:bookId",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      await deleteBook(params.bookId);
      return { ok: true };
    }),
  );
}
