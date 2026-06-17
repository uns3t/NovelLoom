import Fastify from "fastify";
import cors from "@fastify/cors";
import { ensureRuntimeDirs, env } from "./env.js";
import { configureLlm } from "./llm.js";
import { bookRoutes } from "./routes/books.js";
import { projectFileRoutes } from "./routes/projectFiles.js";
import { aiAgentsRoutes } from "./routes/aiAgents.js";
import { aiPresetsRoutes } from "./routes/aiPresets.js";
import { aiWorkspaceRoutes } from "./routes/aiWorkspace.js";
import { aiSessionsRoutes } from "./routes/aiSessions.js";
import { knowledgeBaseRoutes } from "./routes/knowledgeBase.js";

const SERVER_BODY_LIMIT_BYTES = 64 * 1024 * 1024;
const SERVER_BODY_LIMIT_MIB = Math.floor(SERVER_BODY_LIMIT_BYTES / 1024 / 1024);

type FastifyErrorLike = Error & {
  code?: string;
  statusCode?: number;
};

async function main() {
  const app = Fastify({
    logger: true,
    bodyLimit: SERVER_BODY_LIMIT_BYTES,
  });

  try {
    console.log(
      `[novelloom] Starting server on http://${env.HOST}:${env.PORT} (env: ${env.ENV_FILE}, loaded: ${env.ENV_FILE_LOADED}, books: ${env.BOOKS_DIR}, llm: ${env.LLM_PROVIDER}/${env.MODEL}, bodyLimit: ${SERVER_BODY_LIMIT_MIB} MiB)`,
    );
    ensureRuntimeDirs();
    app.setErrorHandler((err, _req, reply) => {
      const fastifyError = err as FastifyErrorLike;
      if (fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        reply.code(413);
        return {
          error: "Payload too large",
          details: `请求体过大，当前服务端接收上限约为 ${SERVER_BODY_LIMIT_MIB} MiB。`,
        };
      }

      app.log.error(err);
      const statusCode =
        typeof fastifyError.statusCode === "number" &&
        fastifyError.statusCode >= 400 &&
        fastifyError.statusCode < 600
          ? fastifyError.statusCode
          : 500;
      reply.code(statusCode);
      return statusCode >= 500
        ? { error: "Internal error" }
        : { error: "Invalid input", details: fastifyError.message };
    });
    app.log.info(
      {
        repoRoot: env.REPO_ROOT,
        envFile: env.ENV_FILE,
        envFileLoaded: env.ENV_FILE_LOADED,
        port: env.PORT,
        host: env.HOST,
        booksDir: env.BOOKS_DIR,
        llmProvider: env.LLM_PROVIDER,
        llmBaseUrl: env.LLM_BASE_URL,
        aiConfigured: Boolean(env.LLM_API_KEY),
        bodyLimitBytes: SERVER_BODY_LIMIT_BYTES,
        bodyLimitMiB: SERVER_BODY_LIMIT_MIB,
      },
      "Starting NovelLoom server",
    );

    configureLlm();

    await app.register(cors, { origin: true });
    await app.register(bookRoutes);
    await app.register(projectFileRoutes);
    await app.register(aiAgentsRoutes);
    await app.register(aiPresetsRoutes);
    await app.register(aiSessionsRoutes);
    await app.register(aiWorkspaceRoutes);
    await app.register(knowledgeBaseRoutes);

    app.get("/api/health", async () => ({ ok: true }));

    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`[novelloom] Server ready at http://${env.HOST}:${env.PORT}`);
    app.log.info(
      {
        repoRoot: env.REPO_ROOT,
        envFile: env.ENV_FILE,
        envFileLoaded: env.ENV_FILE_LOADED,
        port: env.PORT,
        host: env.HOST,
        booksDir: env.BOOKS_DIR,
        llmProvider: env.LLM_PROVIDER,
        llmBaseUrl: env.LLM_BASE_URL,
        aiConfigured: Boolean(env.LLM_API_KEY),
        bodyLimitBytes: SERVER_BODY_LIMIT_BYTES,
        bodyLimitMiB: SERVER_BODY_LIMIT_MIB,
      },
      "NovelLoom server ready",
    );
  } catch (err) {
    app.log.error(err);
    console.error("[novelloom] Server failed to start:", err);
    process.exit(1);
  }
}

main();
