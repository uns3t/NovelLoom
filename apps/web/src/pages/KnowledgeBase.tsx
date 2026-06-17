import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Box,
  ChevronRight,
  Globe2,
  MessageSquare,
  Plus,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  KNOWLEDGE_BASE_TYPE_META,
  type BookMeta,
  type KnowledgeBaseItemDoc,
  type KnowledgeBaseItemSummary,
  type KnowledgeBaseItemType,
} from "@novelloom/shared";
import { booksApi } from "../api/books";
import { knowledgeBaseApi } from "../api/knowledgeBase";
import { CharacterRoleplayPanel } from "../components/CharacterRoleplayPanel";
import { ConfirmModal, PromptModal } from "../components/Modal";
import { RenderedMarkdownEditor } from "../components/RenderedMarkdownEditor";

interface KnowledgeBaseProps {
  bookId: string;
  onOpenBooks(): void;
  registerLeaveGuard?(guard: (() => boolean) | null): void;
}

const TYPE_ORDER: KnowledgeBaseItemType[] = ["character", "world", "item"];

const INITIAL_EXPANDED_TYPES: Record<KnowledgeBaseItemType, boolean> = {
  character: true,
  world: true,
  item: true,
};

function typeIcon(type: KnowledgeBaseItemType) {
  if (type === "character") return <UserRound size={14} aria-hidden="true" />;
  if (type === "world") return <Globe2 size={14} aria-hidden="true" />;
  return <Box size={14} aria-hidden="true" />;
}

function formatTime(value?: string): string {
  return value ? new Date(value).toLocaleString() : "";
}

function fallbackTitle(type: KnowledgeBaseItemType): string {
  return `新${KNOWLEDGE_BASE_TYPE_META[type].singularLabel}`;
}

export function KnowledgeBase({
  bookId,
  onOpenBooks,
  registerLeaveGuard,
}: KnowledgeBaseProps) {
  const [book, setBook] = useState<BookMeta | null>(null);
  const [items, setItems] = useState<KnowledgeBaseItemSummary[]>([]);
  const [activeType, setActiveType] = useState<KnowledgeBaseItemType>("character");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [doc, setDoc] = useState<KnowledgeBaseItemDoc | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeBaseItemSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedTypes, setExpandedTypes] = useState(INITIAL_EXPANDED_TYPES);
  const activeIdRef = useRef<string | null>(activeId);
  const activeTypeRef = useRef<KnowledgeBaseItemType>(activeType);
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    activeTypeRef.current = activeType;
  }, [activeType]);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    registerLeaveGuard?.(dirty ? () => false : null);
    return () => registerLeaveGuard?.(null);
  }, [dirty, registerLeaveGuard]);

  const itemsByType = useMemo(
    () =>
      TYPE_ORDER.reduce(
        (acc, type) => {
          acc[type] = items.filter((item) => item.type === type);
          return acc;
        },
        {
          character: [],
          world: [],
          item: [],
        } as Record<KnowledgeBaseItemType, KnowledgeBaseItemSummary[]>,
      ),
    [items],
  );

  const activeItem = useMemo(
    () => items.find((item) => item.type === activeType && item.id === activeId) ?? null,
    [activeId, activeType, items],
  );

  const refreshItems = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const nextItems = await knowledgeBaseApi.list(bookId);
      setItems(nextItems);
      if (
        activeIdRef.current &&
        !nextItems.some(
          (item) =>
            item.type === activeTypeRef.current && item.id === activeIdRef.current,
        )
      ) {
        setActiveId(null);
        setDoc(null);
        setTitle("");
        setContent("");
        setDirty(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingList(false);
    }
  }, [bookId]);

  useEffect(() => {
    let cancelled = false;
    booksApi
      .listBooks()
      .then((books) => {
        if (!cancelled) setBook(books.find((item) => item.id === bookId) ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  useEffect(() => {
    void refreshItems();
  }, [refreshItems]);

  const loadItem = useCallback(
    async (item: KnowledgeBaseItemSummary) => {
      setLoadingDoc(true);
      setError(null);
      setNotice(null);
      try {
        const nextDoc = await knowledgeBaseApi.get(bookId, item.type, item.id);
        setActiveType(nextDoc.type);
        setExpandedTypes((current) => ({ ...current, [nextDoc.type]: true }));
        setActiveId(nextDoc.id);
        setDoc(nextDoc);
        setTitle(nextDoc.title);
        setContent(nextDoc.content);
        setDirty(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingDoc(false);
      }
    },
    [bookId],
  );

  async function saveCurrent(): Promise<boolean> {
    const id = activeIdRef.current;
    const currentType = activeTypeRef.current;
    if (!id || !dirtyRef.current) return true;
    const nextTitle = titleRef.current.trim();
    if (!nextTitle) {
      setError("标题不能为空");
      return false;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await knowledgeBaseApi.save(bookId, currentType, id, {
        title: nextTitle,
        content: contentRef.current,
      });
      setDoc(saved);
      setActiveType(saved.type);
      setActiveId(saved.id);
      setTitle(saved.title);
      setContent(saved.content);
      setDirty(false);
      setNotice("资料卡已保存");
      await refreshItems();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function saveBeforeContinue(next: () => void) {
    if (!dirtyRef.current) {
      next();
      return;
    }
    void (async () => {
      if (await saveCurrent()) next();
    })();
  }

  function activateType(type: KnowledgeBaseItemType) {
    saveBeforeContinue(() => {
      setActiveType(type);
      setExpandedTypes((current) => ({ ...current, [type]: true }));
      if (doc && doc.type !== type) {
        setActiveId(null);
        setDoc(null);
        setTitle("");
        setContent("");
        setDirty(false);
      }
    });
  }

  function toggleType(type: KnowledgeBaseItemType) {
    if (type !== activeType) {
      activateType(type);
      return;
    }
    saveBeforeContinue(() => {
      setExpandedTypes((current) => ({ ...current, [type]: !current[type] }));
    });
  }

  function selectItem(item: KnowledgeBaseItemSummary) {
    if (item.type === activeType && item.id === activeId) return;
    saveBeforeContinue(() => {
      void loadItem(item);
    });
  }

  function openCreateModal() {
    setCreateTitle(fallbackTitle(activeType));
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    const nextTitle = createTitle.trim();
    if (!nextTitle) {
      setCreateError("标题不能为空");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await knowledgeBaseApi.create(bookId, {
        type: activeType,
        title: nextTitle,
      });
      setCreateOpen(false);
      await refreshItems();
      await loadItem(created);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await knowledgeBaseApi.delete(bookId, deleteTarget.type, deleteTarget.id);
      setDeleteTarget(null);
      if (deleteTarget.type === activeType && deleteTarget.id === activeId) {
        setActiveId(null);
        setDoc(null);
        setTitle("");
        setContent("");
        setDirty(false);
      }
      await refreshItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="knowledge-base">
      <header className="knowledge-base-header">
        <div>
          <h1>资料库</h1>
          <p>{book?.title ?? bookId} · 人物、世界观与特殊物品设定</p>
        </div>
        <div className="knowledge-base-actions">
          {dirty && <span className="warning-tag">未保存</span>}
          {notice && <span className="kb-status-pill">{notice}</span>}
          <button className="btn-secondary icon-button" onClick={onOpenBooks}>
            <ArrowLeft size={15} aria-hidden="true" />
            <span>书籍管理</span>
          </button>
          <button className="icon-button primary" onClick={openCreateModal}>
            <Plus size={15} aria-hidden="true" />
            <span>新建资料卡</span>
          </button>
          <button
            className="icon-button"
            onClick={() => void saveCurrent()}
            disabled={!doc || saving || !dirty}
          >
            <Save size={15} aria-hidden="true" />
            <span>{saving ? "保存中" : "保存"}</span>
          </button>
        </div>
      </header>

      {error && <div className="error compact">错误：{error}</div>}

      <div className="knowledge-base-grid">
        <aside className="kb-sidebar" aria-label="资料库列表">
          {TYPE_ORDER.map((type) => {
            const meta = KNOWLEDGE_BASE_TYPE_META[type];
            const typeItems = itemsByType[type];
            const expanded = expandedTypes[type];
            const typeActive = type === activeType;
            return (
              <section
                key={type}
                className={`kb-type-section ${typeActive ? "active" : ""}`}
              >
                <button
                  className={`kb-type-header ${expanded ? "expanded" : ""}`}
                  aria-expanded={expanded}
                  onClick={() => toggleType(type)}
                >
                  <ChevronRight size={13} aria-hidden="true" />
                  {typeIcon(type)}
                  <span>{meta.label}</span>
                  <small className="kb-type-count">{typeItems.length}</small>
                </button>

                {expanded && (
                  <div className="kb-section-items">
                    {loadingList ? (
                      <div className="kb-section-empty">正在加载资料卡...</div>
                    ) : typeItems.length === 0 ? (
                      <div className="kb-section-empty">暂无资料卡</div>
                    ) : (
                      typeItems.map((item) => (
                        <button
                          key={item.path}
                          className={`kb-card-item ${
                            item.type === activeType && item.id === activeId
                              ? "active"
                              : ""
                          }`}
                          onClick={() => selectItem(item)}
                          title={item.path}
                        >
                          <strong>{item.title}</strong>
                          <span>{item.path}</span>
                          <small>
                            {item.wordCount ?? 0} 字
                            {item.updatedAt ? ` · ${formatTime(item.updatedAt)}` : ""}
                          </small>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </aside>

        <main className="kb-editor">
          {loadingDoc ? (
            <div className="muted">正在加载资料卡...</div>
          ) : doc ? (
            <>
              <div className="kb-editor-toolbar">
                <label>
                  <span>标题</span>
                  <input
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setDirty(true);
                      setNotice(null);
                    }}
                  />
                </label>
                <div className="kb-editor-actions">
                  <button
                    className="btn-danger icon-button"
                    onClick={() => activeItem && setDeleteTarget(activeItem)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span>删除</span>
                  </button>
                </div>
              </div>

              <div className="kb-editor-surface" data-color-mode="light">
                <RenderedMarkdownEditor
                  value={content}
                  onChange={(value) => {
                    setContent(value);
                    setDirty(true);
                    setNotice(null);
                  }}
                  placeholder="按模板补充资料卡内容..."
                />
              </div>
            </>
          ) : (
            <div className="editor-empty">
              <span>KB</span>
              <h3>选择或新建一张资料卡</h3>
              <p>资料库会以 Markdown 文件保存到当前书籍的 library 目录。</p>
            </div>
          )}
        </main>

        <aside className="kb-roleplay-column" aria-label="人物对话">
          {doc?.type === "character" ? (
            <CharacterRoleplayPanel
              bookId={bookId}
              characterPath={doc.path}
              characterTitle={title.trim() || doc.title}
            />
          ) : (
            <div className="kb-roleplay-empty">
              <span>
                <MessageSquare size={18} aria-hidden="true" />
              </span>
              <h3>选择人物卡开始对话</h3>
              <p>人物对话会参考资料库上下文，并保持只读。</p>
            </div>
          )}
        </aside>
      </div>

      <PromptModal
        open={createOpen}
        title={`新建${KNOWLEDGE_BASE_TYPE_META[activeType].singularLabel}资料卡`}
        description="资料卡会保存为当前书籍 library 目录下的 Markdown 文件。"
        label="资料卡标题"
        value={createTitle}
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
        open={deleteTarget !== null}
        title={deleteTarget ? `删除「${deleteTarget.title}」？` : "删除资料卡？"}
        description="此操作不可恢复，会删除当前书籍中的这张资料卡 Markdown 文件。"
        confirmLabel="删除"
        cancelLabel="取消"
        tone="danger"
        pending={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
