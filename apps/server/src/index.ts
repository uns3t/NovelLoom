import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { configureDeepSeek } from "./llm.js";
import { novelRoutes } from "./routes/novel.js";

async function main() {
  configureDeepSeek();

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(novelRoutes);

  app.get("/api/health", async () => ({ ok: true }));

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
