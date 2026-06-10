import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SSE_EVENT_NAME,
  type AgentEvent,
  type RunNovelRequest,
} from "@novelloom/shared";
import { runNovelPipeline } from "../agents/novelPipeline.js";

const RunBody = z.object({
  premise: z.string().min(1).max(4000),
}) satisfies z.ZodType<RunNovelRequest>;

export async function novelRoutes(app: FastifyInstance) {
  app.post("/api/novel/run", async (req, reply) => {
    const parsed = RunBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid body", details: parsed.error.flatten() };
    }

    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const emit = (event: AgentEvent) => {
      raw.write(`event: ${SSE_EVENT_NAME}\n`);
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    let closed = false;
    req.raw.on("close", () => {
      closed = true;
    });

    try {
      const finalChapter = await runNovelPipeline(parsed.data.premise, {
        emit: (e) => {
          if (!closed) emit(e);
        },
      });
      if (!closed) emit({ type: "done", finalChapter });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!closed) emit({ type: "error", message });
    } finally {
      raw.end();
    }

    return reply;
  });
}
