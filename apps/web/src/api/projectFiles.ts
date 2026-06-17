import type {
  ArchiveCurrentOutlineResponse,
  CreateProjectFileRequest,
  ProjectFileDoc,
  ProjectFileNode,
  RenameProjectFileRequest,
  UpdateProjectFileRequest,
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

function fileQuery(path: string): string {
  return `path=${enc(path)}`;
}

export const projectFilesApi = {
  listTree(bookId: string): Promise<ProjectFileNode[]> {
    return request<ProjectFileNode[]>(
      "GET",
      `/api/books/${enc(bookId)}/project-files`,
    );
  },

  readFile(bookId: string, path: string): Promise<ProjectFileDoc> {
    return request<ProjectFileDoc>(
      "GET",
      `/api/books/${enc(bookId)}/project-files/file?${fileQuery(path)}`,
    );
  },

  saveFile(
    bookId: string,
    path: string,
    body: UpdateProjectFileRequest,
  ): Promise<ProjectFileDoc> {
    return request<ProjectFileDoc>(
      "PUT",
      `/api/books/${enc(bookId)}/project-files/file?${fileQuery(path)}`,
      body,
    );
  },

  create(
    bookId: string,
    body: CreateProjectFileRequest,
  ): Promise<ProjectFileDoc | ProjectFileNode> {
    return request<ProjectFileDoc | ProjectFileNode>(
      "POST",
      `/api/books/${enc(bookId)}/project-files`,
      body,
    );
  },

  archiveCurrentOutline(bookId: string): Promise<ArchiveCurrentOutlineResponse> {
    return request<ArchiveCurrentOutlineResponse>(
      "POST",
      `/api/books/${enc(bookId)}/project-files/archive-current-outline`,
    );
  },

  rename(
    bookId: string,
    fromPath: string,
    body: RenameProjectFileRequest,
  ): Promise<ProjectFileDoc | ProjectFileNode> {
    return request<ProjectFileDoc | ProjectFileNode>(
      "PATCH",
      `/api/books/${enc(bookId)}/project-files/file?${fileQuery(fromPath)}`,
      body,
    );
  },

  delete(bookId: string, path: string, recursive = true): Promise<void> {
    return request<void>(
      "DELETE",
      `/api/books/${enc(bookId)}/project-files/file?${fileQuery(path)}&recursive=${String(
        recursive,
      )}`,
    );
  },
};
