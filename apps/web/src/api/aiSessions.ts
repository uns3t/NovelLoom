import type { UIMessage } from "ai";
import type {
  AiSessionsResponse,
  UpdateAiSessionsRequest,
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
  const init: RequestInit = {
    method,
  };
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

export const aiSessionsApi = {
  load(bookId: string): Promise<AiSessionsResponse<UIMessage>> {
    return request<AiSessionsResponse<UIMessage>>(
      "GET",
      `/api/books/${enc(bookId)}/ai-sessions`,
    );
  },

  save(
    bookId: string,
    body: UpdateAiSessionsRequest<UIMessage>,
  ): Promise<AiSessionsResponse<UIMessage>> {
    return request<AiSessionsResponse<UIMessage>>(
      "PUT",
      `/api/books/${enc(bookId)}/ai-sessions`,
      body,
    );
  },
};
