import type {
  CreateKnowledgeBaseItemRequest,
  KnowledgeBaseItemDoc,
  KnowledgeBaseItemSummary,
  KnowledgeBaseItemType,
  UpdateKnowledgeBaseItemRequest,
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

export const knowledgeBaseApi = {
  list(
    bookId: string,
    type?: KnowledgeBaseItemType,
  ): Promise<KnowledgeBaseItemSummary[]> {
    const query = type ? `?type=${enc(type)}` : "";
    return request<KnowledgeBaseItemSummary[]>(
      "GET",
      `/api/books/${enc(bookId)}/knowledge-base${query}`,
    );
  },

  create(
    bookId: string,
    body: CreateKnowledgeBaseItemRequest,
  ): Promise<KnowledgeBaseItemDoc> {
    return request<KnowledgeBaseItemDoc>(
      "POST",
      `/api/books/${enc(bookId)}/knowledge-base`,
      body,
    );
  },

  get(
    bookId: string,
    type: KnowledgeBaseItemType,
    id: string,
  ): Promise<KnowledgeBaseItemDoc> {
    return request<KnowledgeBaseItemDoc>(
      "GET",
      `/api/books/${enc(bookId)}/knowledge-base/${enc(type)}/${enc(id)}`,
    );
  },

  save(
    bookId: string,
    type: KnowledgeBaseItemType,
    id: string,
    body: UpdateKnowledgeBaseItemRequest,
  ): Promise<KnowledgeBaseItemDoc> {
    return request<KnowledgeBaseItemDoc>(
      "PUT",
      `/api/books/${enc(bookId)}/knowledge-base/${enc(type)}/${enc(id)}`,
      body,
    );
  },

  delete(
    bookId: string,
    type: KnowledgeBaseItemType,
    id: string,
  ): Promise<void> {
    return request<void>(
      "DELETE",
      `/api/books/${enc(bookId)}/knowledge-base/${enc(type)}/${enc(id)}`,
    );
  },
};
