import type {
  AiAgentsResponse,
  UpdateAiAgentsRequest,
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

export const aiAgentsApi = {
  load(): Promise<AiAgentsResponse> {
    return request<AiAgentsResponse>("GET", "/api/ai-agents");
  },

  save(body: UpdateAiAgentsRequest): Promise<AiAgentsResponse> {
    return request<AiAgentsResponse>("PUT", "/api/ai-agents", body);
  },
};
