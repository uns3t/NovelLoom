import type { AgentEvent, RunNovelRequest } from "@novelloom/shared";

/**
 * Posts a run-novel request and parses the resulting SSE stream,
 * invoking onEvent for each parsed AgentEvent.
 */
export async function runNovel(
  body: RunNovelRequest,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/novel/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx: number;
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);

      const dataLines = rawEvent
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart());
      if (dataLines.length === 0) continue;

      const dataStr = dataLines.join("\n");
      try {
        const parsed = JSON.parse(dataStr) as AgentEvent;
        onEvent(parsed);
      } catch {
        // ignore malformed payload
      }
    }
  }
}
