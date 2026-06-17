import type { AiPresetsOverviewResponse } from "@novelloom/shared";

interface ApiErrorBody {
  error?: string;
  details?: unknown;
}

async function request<T>(method: string, path: string): Promise<T> {
  const res = await fetch(path, { method });
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

  const text = await res.text();
  return text === "" ? (undefined as T) : (JSON.parse(text) as T);
}

export const aiPresetsApi = {
  load(): Promise<AiPresetsOverviewResponse> {
    return request<AiPresetsOverviewResponse>("GET", "/api/ai-presets");
  },
};
