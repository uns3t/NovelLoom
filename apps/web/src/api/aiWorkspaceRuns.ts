import type { UIMessage } from "ai";
import type {
  AiWorkspaceRunSnapshot,
  ApplyAiDraftChangesRequest,
  ApplyAiDraftChangesResponse,
  DiscardAiDraftChangesRequest,
  DiscardAiDraftChangesResponse,
  StartAiWorkspaceRunRequest,
} from "@novelloom/shared";

interface ApiErrorBody {
  error?: string;
  details?: unknown;
  conflicts?: unknown;
}

export class AiWorkspaceRunApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  readonly conflicts: string[];

  constructor(
    status: number,
    message: string,
    details?: unknown,
    conflicts: string[] = [],
  ) {
    const conflictSuffix =
      conflicts.length > 0 ? `: ${conflicts.join(", ")}` : "";
    super(`${status} ${message}${conflictSuffix}`.trim());
    this.name = "AiWorkspaceRunApiError";
    this.status = status;
    this.details = details;
    this.conflicts = conflicts;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readConflictPaths(data: ApiErrorBody): string[] {
  const directConflicts = asStringArray(data.conflicts);
  if (directConflicts.length > 0) return directConflicts;

  const detailsConflicts = asStringArray(data.details);
  if (detailsConflicts.length > 0) return detailsConflicts;

  if (!isRecord(data.details)) return [];
  return asStringArray(data.details.conflicts);
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
    let details: unknown;
    let conflicts: string[] = [];
    try {
      const data = (await res.json()) as ApiErrorBody;
      if (typeof data.error === "string" && data.error) {
        message = data.error;
      }
      details = data.details;
      if (res.status === 409) {
        conflicts = readConflictPaths(data);
      }
    } catch {
      // Keep status text when the server does not return JSON.
    }
    throw new AiWorkspaceRunApiError(res.status, message, details, conflicts);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  return text === "" ? (undefined as T) : (JSON.parse(text) as T);
}

const enc = encodeURIComponent;

export const aiWorkspaceRunsApi = {
  start(
    bookId: string,
    body: StartAiWorkspaceRunRequest<UIMessage>,
  ): Promise<AiWorkspaceRunSnapshot<UIMessage>> {
    return request<AiWorkspaceRunSnapshot<UIMessage>>(
      "POST",
      `/api/books/${enc(bookId)}/ai-workspace-runs`,
      body,
    );
  },

  get(
    bookId: string,
    runId: string,
  ): Promise<AiWorkspaceRunSnapshot<UIMessage>> {
    return request<AiWorkspaceRunSnapshot<UIMessage>>(
      "GET",
      `/api/books/${enc(bookId)}/ai-workspace-runs/${enc(runId)}`,
    );
  },

  cancel(
    bookId: string,
    runId: string,
  ): Promise<AiWorkspaceRunSnapshot<UIMessage>> {
    return request<AiWorkspaceRunSnapshot<UIMessage>>(
      "POST",
      `/api/books/${enc(bookId)}/ai-workspace-runs/${enc(runId)}/cancel`,
    );
  },

  applyChanges(
    bookId: string,
    runId: string,
    paths?: string[],
  ): Promise<ApplyAiDraftChangesResponse> {
    const body: ApplyAiDraftChangesRequest | undefined = paths
      ? { paths }
      : undefined;
    return request<ApplyAiDraftChangesResponse>(
      "POST",
      `/api/books/${enc(bookId)}/ai-workspace-runs/${enc(runId)}/changes/apply`,
      body,
    );
  },

  discardChanges(
    bookId: string,
    runId: string,
    paths?: string[],
  ): Promise<DiscardAiDraftChangesResponse> {
    const body: DiscardAiDraftChangesRequest | undefined = paths
      ? { paths }
      : undefined;
    return request<DiscardAiDraftChangesResponse>(
      "POST",
      `/api/books/${enc(bookId)}/ai-workspace-runs/${enc(runId)}/changes/discard`,
      body,
    );
  },
};
