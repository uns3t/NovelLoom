import type {
  ChapterBatchRunSnapshot,
  StartChapterBatchRunRequest,
} from "@novelloom/shared";

interface ApiErrorBody {
  error?: string;
  details?: unknown;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  const res = await fetch(path, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as ApiErrorBody;
      if (typeof data.error === "string" && data.error) {
        message = data.error;
      }
      if (typeof data.details === "string" && data.details) {
        message = `${message}: ${data.details}`;
      }
    } catch {
      // Keep status text when the server does not return JSON.
    }
    throw new Error(`${res.status} ${message}`.trim());
  }

  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  return text === "" ? (undefined as T) : (JSON.parse(text) as T);
}

const enc = encodeURIComponent;

export const chapterBatchRunsApi = {
  start(
    bookId: string,
    body: StartChapterBatchRunRequest,
  ): Promise<ChapterBatchRunSnapshot> {
    return request<ChapterBatchRunSnapshot>(
      "POST",
      `/api/books/${enc(bookId)}/chapter-batch-runs`,
      body,
    );
  },

  get(bookId: string, runId: string): Promise<ChapterBatchRunSnapshot> {
    return request<ChapterBatchRunSnapshot>(
      "GET",
      `/api/books/${enc(bookId)}/chapter-batch-runs/${enc(runId)}`,
    );
  },

  cancel(bookId: string, runId: string): Promise<ChapterBatchRunSnapshot> {
    return request<ChapterBatchRunSnapshot>(
      "POST",
      `/api/books/${enc(bookId)}/chapter-batch-runs/${enc(runId)}/cancel`,
    );
  },
};
