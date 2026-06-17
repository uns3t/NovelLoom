import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BOOK_ID_REGEX,
  MARKDOWN_MAX_LEN,
  PROJECT_FILE_PATH_MAX_LEN,
  PROJECT_FILE_PATH_REGEX,
  type CreateProjectFileRequest,
  type RenameProjectFileRequest,
  type UpdateProjectFileRequest,
} from "@novelloom/shared";
import {
  ConflictError,
  InvalidIdError,
  NotFoundError,
  archiveCurrentChapterOutline,
  createProjectEntry,
  deleteProjectEntry,
  listProjectFiles,
  readProjectFile,
  renameProjectEntry,
  writeProjectFile,
} from "../books/storage.js";

const IdSchema = z.string().regex(BOOK_ID_REGEX);
const ProjectPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROJECT_FILE_PATH_MAX_LEN)
  .regex(PROJECT_FILE_PATH_REGEX);
const ContentSchema = z.string().max(MARKDOWN_MAX_LEN);

const BookIdParams = z.object({ bookId: IdSchema });
const PathQuery = z.object({ path: ProjectPathSchema });
const DeleteQuery = PathQuery.extend({
  recursive: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
});

const UpdateBody = z.object({
  content: ContentSchema,
}) satisfies z.ZodType<UpdateProjectFileRequest>;

const CreateBody = z.object({
  path: ProjectPathSchema,
  kind: z.enum(["file", "directory"]),
  content: ContentSchema.optional(),
}) satisfies z.ZodType<CreateProjectFileRequest>;

const RenameBody = z.object({
  toPath: ProjectPathSchema,
}) satisfies z.ZodType<RenameProjectFileRequest>;

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

export async function projectFileRoutes(app: FastifyInstance) {
  app.get(
    "/api/books/:bookId/project-files",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      return await listProjectFiles(params.bookId);
    }),
  );

  app.get(
    "/api/books/:bookId/project-files/file",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      const query = parseOrFail(PathQuery, req.query, reply);
      if (!query) return reply;
      return await readProjectFile(params.bookId, query.path);
    }),
  );

  app.put(
    "/api/books/:bookId/project-files/file",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      const query = parseOrFail(PathQuery, req.query, reply);
      if (!query) return reply;
      const body = parseOrFail(UpdateBody, req.body, reply);
      if (!body) return reply;
      return await writeProjectFile(params.bookId, query.path, body.content);
    }),
  );

  app.post(
    "/api/books/:bookId/project-files",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      const body = parseOrFail(CreateBody, req.body, reply);
      if (!body) return reply;
      reply.code(201);
      return await createProjectEntry(
        params.bookId,
        body.path,
        body.kind,
        body.content,
      );
    }),
  );

  app.post(
    "/api/books/:bookId/project-files/archive-current-outline",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      reply.code(201);
      return await archiveCurrentChapterOutline(params.bookId);
    }),
  );

  app.patch(
    "/api/books/:bookId/project-files/file",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      const query = parseOrFail(PathQuery, req.query, reply);
      if (!query) return reply;
      const body = parseOrFail(RenameBody, req.body, reply);
      if (!body) return reply;
      return await renameProjectEntry(params.bookId, query.path, body.toPath);
    }),
  );

  app.delete(
    "/api/books/:bookId/project-files/file",
    wrap(app, async (req, reply) => {
      const params = parseOrFail(BookIdParams, req.params, reply);
      if (!params) return reply;
      const query = parseOrFail(DeleteQuery, req.query, reply);
      if (!query) return reply;
      await deleteProjectEntry(params.bookId, query.path, query.recursive);
      return { ok: true };
    }),
  );
}
