import type {
  BookMeta,
  CreateBookRequest,
  UpdateBookRequest,
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
    let errMsg = "";
    try {
      const errBody = (await res.json()) as ApiErrorBody;
      if (errBody && typeof errBody.error === "string") {
        errMsg = errBody.error;
      }
    } catch {
      // ignore JSON parse errors; fall back to status text
    }
    throw new Error(`${res.status} ${errMsg || res.statusText}`.trim());
  }

  if (res.status === 204 || res.headers.get("Content-Length") === "0") {
    return undefined as T;
  }

  const text = await res.text();
  if (text === "") {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

const enc = encodeURIComponent;

export const booksApi = {
  listBooks(): Promise<BookMeta[]> {
    return request<BookMeta[]>("GET", "/api/books");
  },

  createBook(body: CreateBookRequest): Promise<BookMeta> {
    return request<BookMeta>("POST", "/api/books", body);
  },

  renameBook(bookId: string, body: UpdateBookRequest): Promise<BookMeta> {
    return request<BookMeta>("PATCH", `/api/books/${enc(bookId)}`, body);
  },

  deleteBook(bookId: string): Promise<void> {
    return request<void>("DELETE", `/api/books/${enc(bookId)}`);
  },
};
