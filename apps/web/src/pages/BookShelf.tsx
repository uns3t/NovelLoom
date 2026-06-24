import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Workflow } from "lucide-react";
import type { BookMeta } from "@novelloom/shared";
import { booksApi } from "../api/books";
import { ConfirmModal, PromptModal } from "../components/Modal";

interface BookShelfProps {
  onOpen(bookId: string): void;
}

export function BookShelf({ onOpen }: BookShelfProps) {
  const [books, setBooks] = useState<BookMeta[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [bookToRename, setBookToRename] = useState<BookMeta | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [bookToDelete, setBookToDelete] = useState<BookMeta | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await booksApi.listBooks();
      setBooks(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate() {
    const title = createTitle.trim();
    if (title === "") {
      setCreateError("书名不能为空");
      return;
    }
    setCreating(true);
    setError(null);
    setCreateError(null);
    try {
      await booksApi.createBook({ title });
      setCreateOpen(false);
      setCreateTitle("");
      await refresh();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!bookToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await booksApi.deleteBook(bookToDelete.id);
      setBookToDelete(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleRename() {
    if (!bookToRename) return;
    const title = renameTitle.trim();
    if (title === "") {
      setRenameError("书名不能为空");
      return;
    }
    setRenaming(true);
    setError(null);
    setRenameError(null);
    try {
      await booksApi.renameBook(bookToRename.id, { title });
      setBookToRename(null);
      setRenameTitle("");
      await refresh();
    } catch (err) {
      setRenameError((err as Error).message);
    } finally {
      setRenaming(false);
    }
  }

  function openCreateModal() {
    setCreateTitle("");
    setCreateError(null);
    setCreateOpen(true);
  }

  function openRenameModal(book: BookMeta) {
    setBookToRename(book);
    setRenameTitle(book.title);
    setRenameError(null);
  }

  return (
    <div className="shelf">
      <header className="shelf-header">
        <div>
          <h1>书籍管理</h1>
        </div>
        <div className="shelf-actions">
          <button className="icon-button primary" onClick={openCreateModal}>
            <Plus size={15} aria-hidden="true" />
            <span>新建书籍</span>
          </button>
        </div>
      </header>

      {error && <div className="error">错误：{error}</div>}

      {loading && <div className="muted">加载中…</div>}

      {!loading && books && books.length === 0 && (
        <div className="muted">还没有书籍，点击右上角"新建书籍"开始创作。</div>
      )}

      {!loading && books && books.length > 0 && (
        <div className="book-table" role="table" aria-label="书籍列表">
          <div className="book-table-row book-table-head" role="row">
            <span role="columnheader">书名</span>
            <span role="columnheader">路径</span>
            <span role="columnheader">更新时间</span>
            <span role="columnheader">操作</span>
          </div>
          {books.map((book) => (
            <div key={book.id} className="book-table-row" role="row">
              <div className="book-title-cell" role="cell">
                <strong>{book.title}</strong>
                <span>ID：{book.id}</span>
              </div>
              <code className="book-path-cell" role="cell" title={book.path}>
                {book.path}
              </code>
              <div className="book-time-cell" role="cell">
                <span>更新：{new Date(book.updatedAt).toLocaleString()}</span>
                <span>创建：{new Date(book.createdAt).toLocaleString()}</span>
              </div>
              <div className="book-row-actions" role="cell">
                <button
                  className="icon-button primary"
                  onClick={() => onOpen(book.id)}
                >
                  <Workflow size={15} aria-hidden="true" />
                  <span>进入创作台</span>
                </button>
                <button
                  className="btn-secondary icon-button"
                  onClick={() => openRenameModal(book)}
                >
                  <Pencil size={14} aria-hidden="true" />
                  <span>改名</span>
                </button>
                <button
                  className="btn-danger icon-button"
                  onClick={() => setBookToDelete(book)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  <span>删除</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PromptModal
        open={createOpen}
        title="新建书籍"
        description="创建后会自动生成 idea.md、plot.md、novel-spec.md、style-sample.md、大纲、状态和资料库骨架。"
        label="书名"
        value={createTitle}
        placeholder="例如：雾城来信"
        confirmLabel="创建"
        error={createError}
        pending={creating}
        onChange={(value) => {
          setCreateTitle(value);
          if (createError) setCreateError(null);
        }}
        onConfirm={() => void handleCreate()}
        onCancel={() => {
          setCreateOpen(false);
          setCreateError(null);
        }}
      />

      <ConfirmModal
        open={bookToDelete !== null}
        title={bookToDelete ? `删除《${bookToDelete.title}》？` : "删除书籍？"}
        description="这会删除这本书及其全部项目文件，此操作不可恢复。"
        confirmLabel="删除"
        cancelLabel="取消"
        tone="danger"
        pending={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setBookToDelete(null)}
      />

      <PromptModal
        open={bookToRename !== null}
        title={bookToRename ? `修改《${bookToRename.title}》的书名` : "修改书名"}
        description="只修改书籍显示名称，不会改变书籍 ID 或本地目录路径。"
        label="新书名"
        value={renameTitle}
        placeholder="请输入新的书名"
        confirmLabel="保存"
        error={renameError}
        pending={renaming}
        onChange={(value) => {
          setRenameTitle(value);
          if (renameError) setRenameError(null);
        }}
        onConfirm={() => void handleRename()}
        onCancel={() => {
          setBookToRename(null);
          setRenameError(null);
        }}
      />
    </div>
  );
}
