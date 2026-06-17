import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import {
  CURRENT_CHAPTER_OUTLINE_FILE,
  NOVEL_SPEC_FILE,
  PLOT_FILE,
  STORY_STATUS_FILE,
  type BookMeta,
  type ProjectFileDoc,
  type ProjectFileNode,
  type ProjectFileOperation,
} from "@novelloom/shared";
import { booksApi } from "../api/books";
import { projectFilesApi } from "../api/projectFiles";
import { AiCollaborationPanel } from "../components/AiCollaborationPanel";
import { ConfirmModal, PromptModal } from "../components/Modal";
import { RenderedMarkdownEditor } from "../components/RenderedMarkdownEditor";

const AUTO_SAVE_DELAY_MS = 2000;

interface WorkbenchProps {
  bookId: string;
  onOpenBooks(): void;
  registerLeaveGuard?(guard: (() => boolean) | null): void;
}

interface FileChangeRefreshOptions {
  changedPaths?: string[];
  reloadCurrent?: boolean;
}

interface TreeNodeProps {
  node: ProjectFileNode;
  activePath: string | null;
  depth: number;
  expandedPaths: Set<string>;
  onSelect(node: ProjectFileNode): void;
  onArchiveCurrentOutline(): void;
  onRenamePath(path: string): void;
  onDeletePath(path: string): void;
  archiveDisabled: boolean;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatFileMeta(node: ProjectFileNode): string {
  if (node.path.toLowerCase().endsWith(".md") && node.wordCount !== undefined) {
    return `${node.wordCount.toLocaleString()} 字`;
  }
  return formatBytes(node.sizeBytes);
}

function parentPath(path: string | null): string {
  if (!path) return "";
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function collectDirectoryPaths(nodes: ProjectFileNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children ?? []));
  }
  return paths;
}

function ancestorDirectoryPaths(path: string): string[] {
  const parts = path.split("/");
  const ancestors: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join("/"));
  }
  return ancestors;
}

function affectsCurrentFile(
  operation: ProjectFileOperation,
  currentPath: string | null,
): boolean {
  if (!currentPath) return false;
  switch (operation.type) {
    case "create_file":
    case "write_file":
    case "delete":
      return operation.path === currentPath;
    case "rename":
      return (
        operation.fromPath === currentPath || operation.toPath === currentPath
      );
    case "create_directory":
      return false;
  }
}

function TreeNode({
  node,
  activePath,
  depth,
  expandedPaths,
  onSelect,
  onArchiveCurrentOutline,
  onRenamePath,
  onDeletePath,
  archiveDisabled,
}: TreeNodeProps) {
  const isDirectory = node.kind === "directory";
  const children = node.children ?? [];
  const expanded = isDirectory && expandedPaths.has(node.path);
  const fileMeta = isDirectory ? "" : formatFileMeta(node);
  const isCurrentOutline = node.path === CURRENT_CHAPTER_OUTLINE_FILE;

  function stopMenuEvent(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  return (
    <li>
      <div
        className={`tree-node-row ${activePath === node.path ? "active" : ""} ${
          isDirectory ? "directory" : "file"
        } ${isDirectory && expanded ? "expanded" : ""}`}
      >
        <button
          type="button"
          className="tree-node-main"
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onSelect(node)}
          title={node.path}
          aria-expanded={isDirectory ? expanded : undefined}
        >
          <span className="tree-disclosure" aria-hidden="true">
            {isDirectory && <ChevronRight size={12} />}
          </span>
          <span className="tree-icon" aria-hidden="true">
            {isDirectory ? <Folder size={14} /> : <FileText size={14} />}
          </span>
          <span className="tree-name">{node.name}</span>
          {fileMeta && <span className="tree-size">{fileMeta}</span>}
        </button>

        {!isDirectory && (
          <div className="tree-node-menu-wrap">
            <button
              type="button"
              className="tree-node-menu-trigger"
              onClick={stopMenuEvent}
              aria-label={`打开 ${node.name} 的文件操作`}
              title="文件操作"
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
            <div
              className="tree-node-menu"
              role="menu"
              aria-label={`${node.name} 文件操作`}
            >
              {isCurrentOutline && (
                <button
                  type="button"
                  className="tree-node-menu-item"
                  role="menuitem"
                  onClick={(event) => {
                    stopMenuEvent(event);
                    onArchiveCurrentOutline();
                  }}
                  disabled={archiveDisabled}
                >
                  <Archive size={13} aria-hidden="true" />
                  <span>{archiveDisabled ? "归档中..." : "归档当前细纲"}</span>
                </button>
              )}
              <button
                type="button"
                className="tree-node-menu-item"
                role="menuitem"
                onClick={(event) => {
                  stopMenuEvent(event);
                  onRenamePath(node.path);
                }}
              >
                <Pencil size={13} aria-hidden="true" />
                <span>重命名</span>
              </button>
              <button
                type="button"
                className="tree-node-menu-item danger"
                role="menuitem"
                onClick={(event) => {
                  stopMenuEvent(event);
                  onDeletePath(node.path);
                }}
              >
                <Trash2 size={13} aria-hidden="true" />
                <span>删除</span>
              </button>
            </div>
          </div>
        )}
      </div>
      {isDirectory && expanded && children.length > 0 && (
        <ul className="tree-children">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              activePath={activePath}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onSelect={onSelect}
              onArchiveCurrentOutline={onArchiveCurrentOutline}
              onRenamePath={onRenamePath}
              onDeletePath={onDeletePath}
              archiveDisabled={archiveDisabled}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Workbench({
  bookId,
  onOpenBooks,
  registerLeaveGuard,
}: WorkbenchProps) {
  const [book, setBook] = useState<BookMeta | null>(null);
  const [tree, setTree] = useState<ProjectFileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState<boolean>(true);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selectedPathRef = useRef<string | null>(selectedPath);
  const [doc, setDoc] = useState<ProjectFileDoc | null>(null);
  const [content, setContent] = useState<string>("");
  const [dirty, setDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [loadingFile, setLoadingFile] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [createTarget, setCreateTarget] = useState<"file" | "directory" | null>(
    null,
  );
  const [createPath, setCreatePath] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingPath, setCreatingPath] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTargetPath, setRenameTargetPath] = useState<string | null>(null);
  const [renamePath, setRenamePath] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetPath, setDeleteTargetPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState(false);
  const [archivingOutline, setArchivingOutline] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const contentRef = useRef(content);
  const dirtyRef = useRef(dirty);
  const saveTimerRef = useRef<number | null>(null);
  const saveRequestIdRef = useRef(0);
  const treeExpansionInitializedRef = useRef(false);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const selectedDirectory = useMemo(
    () => parentPath(selectedPath),
    [selectedPath],
  );

  useEffect(() => {
    if (treeExpansionInitializedRef.current || tree.length === 0) return;
    setExpandedPaths(new Set(collectDirectoryPaths(tree)));
    treeExpansionInitializedRef.current = true;
  }, [tree]);

  useEffect(() => {
    if (!selectedPath) return;
    const ancestors = ancestorDirectoryPaths(selectedPath);
    if (ancestors.length === 0) return;
    setExpandedPaths((current) => {
      const next = new Set(current);
      for (const ancestor of ancestors) next.add(ancestor);
      return next;
    });
  }, [selectedPath]);

  useEffect(() => {
    registerLeaveGuard?.(dirty ? () => false : null);
    return () => registerLeaveGuard?.(null);
  }, [dirty, registerLeaveGuard]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const books = await booksApi.listBooks();
        if (cancelled) return;
        setBook(books.find((item) => item.id === bookId) ?? null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const refreshTree = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading ?? true;
      if (showLoading) setTreeLoading(true);
      setError(null);
      try {
        setTree(await projectFilesApi.listTree(bookId));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        if (showLoading) setTreeLoading(false);
      }
    },
    [bookId],
  );

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  const doLoadFile = useCallback(
    async (path: string) => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveRequestIdRef.current += 1;
      setLoadingFile(true);
      setError(null);
      setEditorError(null);
      setSaving(false);
      try {
        const next = await projectFilesApi.readFile(bookId, path);
        setSelectedPath(next.path);
        setDoc(next);
        setContent(next.content);
        setDirty(false);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoadingFile(false);
      }
    },
    [bookId],
  );

  const saveCurrentFile = useCallback(
    async (options?: { force?: boolean }) => {
      const path = selectedPathRef.current;
      if (!path) return false;
      if (!options?.force && !dirtyRef.current) return true;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const contentToSave = contentRef.current;
      const requestId = saveRequestIdRef.current + 1;
      saveRequestIdRef.current = requestId;
      setSaving(true);
      setError(null);
      try {
        const saved = await projectFilesApi.saveFile(bookId, path, {
          content: contentToSave,
        });
        if (saveRequestIdRef.current !== requestId) return true;
        setDoc(saved);
        if (contentRef.current === contentToSave) {
          if (saved.content !== contentToSave) {
            contentRef.current = saved.content;
            setContent(saved.content);
          }
          setDirty(false);
        } else {
          setDirty(true);
          if (saveTimerRef.current === null) {
            saveTimerRef.current = window.setTimeout(() => {
              saveTimerRef.current = null;
              void saveCurrentFile();
            }, AUTO_SAVE_DELAY_MS);
          }
          await refreshTree({ showLoading: false });
          return false;
        }
        await refreshTree({ showLoading: false });
        return true;
      } catch (err) {
        if (saveRequestIdRef.current === requestId) {
          setError((err as Error).message);
        }
        return false;
      } finally {
        if (saveRequestIdRef.current === requestId) {
          setSaving(false);
        }
      }
    },
    [bookId, refreshTree],
  );

  useEffect(() => {
    if (!selectedPath || !dirty) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveCurrentFile();
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [dirty, saveCurrentFile, selectedPath]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s")
        return;
      if (!selectedPathRef.current) return;
      event.preventDefault();
      void saveCurrentFile({ force: true });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveCurrentFile]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  const saveBeforeContinue = useCallback(
    (onContinue: () => void) => {
      if (!dirtyRef.current) {
        onContinue();
        return;
      }
      void (async () => {
        const ok = await saveCurrentFile();
        if (ok) onContinue();
      })();
    },
    [saveCurrentFile],
  );

  const handleAiFilesChanged = useCallback(
    (
      operation?: ProjectFileOperation,
      options?: FileChangeRefreshOptions,
    ) => {
      void refreshTree();
      const currentPath = selectedPathRef.current;
      const shouldReloadCurrent =
        (operation && affectsCurrentFile(operation, currentPath)) ||
        Boolean(
          options?.reloadCurrent &&
            currentPath &&
            (!options.changedPaths || options.changedPaths.includes(currentPath)),
        );
      if (shouldReloadCurrent) {
        if (currentPath) void doLoadFile(currentPath);
      }
    },
    [doLoadFile, refreshTree],
  );

  function handleSelectNode(node: ProjectFileNode) {
    if (node.kind === "directory") {
      setExpandedPaths((current) => {
        const next = new Set(current);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      });
      return;
    }
    if (node.path === selectedPath) return;
    saveBeforeContinue(() => {
      void doLoadFile(node.path);
    });
  }

  async function handleSave() {
    await saveCurrentFile({ force: true });
  }

  function openCreateModal(kind: "file" | "directory") {
    const base = selectedDirectory ? `${selectedDirectory}/` : "";
    const fallback = kind === "file" ? `${base}untitled.md` : `${base}notes`;
    setCreateTarget(kind);
    setCreatePath(fallback);
    setCreateError(null);
  }

  async function handleCreate() {
    if (!createTarget) return;
    const path = createPath.trim();
    if (!path) {
      setCreateError("路径不能为空");
      return;
    }
    setCreatingPath(true);
    setCreateError(null);
    const nextContent =
      createTarget === "file"
        ? `# ${path.split("/").pop()?.replace(/\.md$/, "") ?? "Untitled"}\n`
        : undefined;
    setError(null);
    try {
      await projectFilesApi.create(bookId, {
        path,
        kind: createTarget,
        content: nextContent,
      });
      setCreateTarget(null);
      setCreatePath("");
      await refreshTree();
      if (createTarget === "file") await doLoadFile(path);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreatingPath(false);
    }
  }

  async function performArchiveCurrentOutline() {
    setArchivingOutline(true);
    setError(null);
    setArchiveMessage(null);
    try {
      const result = await projectFilesApi.archiveCurrentOutline(bookId);
      await refreshTree();
      setExpandedPaths((current) => {
        const next = new Set(current);
        next.add("outline");
        next.add("outline/archive");
        return next;
      });
      setArchiveMessage(`已归档到 ${result.archivedPath}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setArchivingOutline(false);
    }
  }

  function handleArchiveCurrentOutline() {
    saveBeforeContinue(() => {
      void performArchiveCurrentOutline();
    });
  }

  function openRenameModal(path: string) {
    setRenameTargetPath(path);
    setRenamePath(path);
    setRenameError(null);
    setRenameOpen(true);
  }

  async function performRename(fromPath: string, toPath: string) {
    setRenaming(true);
    setError(null);
    try {
      await projectFilesApi.rename(bookId, fromPath, { toPath });
      setRenameOpen(false);
      setRenameTargetPath(null);
      await refreshTree();
      if (fromPath === selectedPathRef.current) {
        await doLoadFile(toPath);
      }
    } catch (err) {
      setRenameOpen(true);
      setRenameError((err as Error).message);
    } finally {
      setRenaming(false);
    }
  }

  function handleRename() {
    if (!renameTargetPath) return;
    const toPath = renamePath.trim();
    if (!toPath) {
      setRenameError("路径不能为空");
      return;
    }
    if (toPath === renameTargetPath) {
      setRenameOpen(false);
      setRenameTargetPath(null);
      return;
    }
    setRenameError(null);
    setRenameOpen(false);
    const runRename = () => {
      void performRename(renameTargetPath, toPath);
    };
    if (renameTargetPath === selectedPathRef.current) {
      saveBeforeContinue(runRename);
      return;
    }
    runRename();
  }

  async function performDelete(targetPath: string) {
    const deletingCurrentFile = targetPath === selectedPathRef.current;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveRequestIdRef.current += 1;
    setDeletingPath(true);
    setError(null);
    setEditorError(null);
    try {
      await projectFilesApi.delete(bookId, targetPath, true);
      setDeleteOpen(false);
      setDeleteTargetPath(null);
      if (deletingCurrentFile) {
        setSelectedPath(null);
        setDoc(null);
        setContent("");
        setDirty(false);
      }
      await refreshTree();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingPath(false);
    }
  }

  function handleDelete() {
    if (!deleteTargetPath) return;
    const targetPath = deleteTargetPath;
    if (targetPath === selectedPathRef.current) {
      saveBeforeContinue(() => {
        void performDelete(targetPath);
      });
      return;
    }
    void performDelete(targetPath);
  }

  return (
    <section className="workbench">
      <header className="workbench-header">
        <div>
          <h1>{book?.title ?? "创作台"}</h1>
        </div>
        <div className="workbench-actions">
          <button className="btn-secondary icon-button" onClick={onOpenBooks}>
            <ArrowLeft size={15} aria-hidden="true" />
            <span>书籍管理</span>
          </button>
          <button
            className="icon-button"
            onClick={() => void refreshTree()}
            disabled={treeLoading}
          >
            <RefreshCw size={15} aria-hidden="true" />
            <span>刷新文件</span>
          </button>
        </div>
      </header>

      {error && <div className="error compact">错误：{error}</div>}
      {archiveMessage && <div className="success compact">{archiveMessage}</div>}

      <div className="workbench-grid">
        <aside className="file-pane">
          <div className="pane-header">
            <div>
              <h2>项目文件</h2>
              <p>{treeLoading ? "同步中" : `${tree.length} 个根节点`}</p>
            </div>
            <div className="mini-actions">
              <button
                className="icon-button compact"
                onClick={() => openCreateModal("file")}
                title="新建文件"
              >
                <FilePlus2 size={14} aria-hidden="true" />
                <span>文件</span>
              </button>
              <button
                className="icon-button compact"
                onClick={() => openCreateModal("directory")}
                title="新建目录"
              >
                <FolderPlus size={14} aria-hidden="true" />
                <span>目录</span>
              </button>
            </div>
          </div>

          <div className="file-tree-scroll">
            {treeLoading ? (
              <div className="muted">加载目录树…</div>
            ) : tree.length === 0 ? (
              <div className="empty-state">
                暂无文件，先创建一个 Markdown 文件。
              </div>
            ) : (
              <ul className="file-tree">
                {tree.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    activePath={selectedPath}
                    depth={0}
                    expandedPaths={expandedPaths}
                    onSelect={handleSelectNode}
                    onArchiveCurrentOutline={handleArchiveCurrentOutline}
                    onRenamePath={openRenameModal}
                    onDeletePath={(path) => {
                      setDeleteTargetPath(path);
                      setDeleteOpen(true);
                    }}
                    archiveDisabled={archivingOutline || treeLoading}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        <main className="editor-pane">
          <div className="pane-header editor-toolbar">
            <div className="file-title-block">
              <h2>{selectedPath ?? "选择文件开始编辑"}</h2>
              <p>
                {doc?.updatedAt
                  ? `更新于 ${new Date(doc.updatedAt).toLocaleString()}`
                  : "Markdown 编辑器"}
              </p>
            </div>
            <div className="save-status">
              {selectedPath && saving && (
                <span className="saving-tag">保存中</span>
              )}
              {selectedPath && !saving && dirty && (
                <span className="dirty-tag">待保存</span>
              )}
              {selectedPath && !saving && !dirty && (
                <span className="saved-tag">已保存</span>
              )}
              <button
                className="icon-button primary"
                onClick={() => void handleSave()}
                disabled={!selectedPath || saving}
              >
                <Save size={15} aria-hidden="true" />
                <span>{saving ? "保存中..." : "保存"}</span>
              </button>
            </div>
          </div>

          <div className="editor-surface" data-color-mode="light">
            {loadingFile ? (
              <div className="muted">加载文件内容…</div>
            ) : selectedPath ? (
              <div className="rendered-markdown-shell">
                {editorError && (
                  <div className="editor-inline-warning">
                    Markdown 渲染态导入失败：{editorError}
                    。请检查链接、表格、图片、HTML 或其它不支持的 Markdown
                    结构。
                  </div>
                )}
                <RenderedMarkdownEditor
                  value={content}
                  onChange={(value) => {
                    setEditorError(null);
                    setContent(value);
                    setDirty(true);
                  }}
                  onError={setEditorError}
                  placeholder="在这里书写章节、设定、研究笔记或任意项目 Markdown…"
                />
              </div>
            ) : (
              <div className="editor-empty">
                <span>MD</span>
                <h3>选择或创建一个项目文件</h3>
                <p>
                  左侧目录中的 <code>{NOVEL_SPEC_FILE}</code>、
                  <code>{PLOT_FILE}</code>、<code>{STORY_STATUS_FILE}</code>、
                  <code>idea.md</code>、<code>outline/index.md</code>、
                  <code>{CURRENT_CHAPTER_OUTLINE_FILE}</code>、
                  <code>library/</code>
                  与章节文件都可作为普通 Markdown 编辑。
                </p>
              </div>
            )}
          </div>
        </main>

        <AiCollaborationPanel
          bookId={bookId}
          selectedPath={selectedPath}
          currentFileDirty={dirty}
          onFilesChanged={handleAiFilesChanged}
        />
      </div>

      <PromptModal
        open={createTarget !== null}
        title={createTarget === "directory" ? "新建目录" : "新建文件"}
        description="项目文件路径使用 / 分隔，不能使用绝对路径或 ..。"
        label={createTarget === "directory" ? "目录路径" : "文件路径"}
        value={createPath}
        placeholder={createTarget === "directory" ? "notes" : "chapters/001.md"}
        confirmLabel="创建"
        error={createError}
        pending={creatingPath}
        onChange={(value) => {
          setCreatePath(value);
          if (createError) setCreateError(null);
        }}
        onConfirm={() => void handleCreate()}
        onCancel={() => {
          setCreateTarget(null);
          setCreateError(null);
        }}
      />

      <PromptModal
        open={renameOpen}
        title="重命名项目文件"
        description="输入新的相对路径；如果当前文件有待保存内容，确认后会先自动保存。"
        label="新路径"
        value={renamePath}
        confirmLabel="重命名"
        error={renameError}
        pending={renaming}
        onChange={(value) => {
          setRenamePath(value);
          if (renameError) setRenameError(null);
        }}
        onConfirm={handleRename}
        onCancel={() => {
          setRenameOpen(false);
          setRenameTargetPath(null);
          setRenameError(null);
        }}
      />

      <ConfirmModal
        open={deleteOpen}
        title={deleteTargetPath ? `删除 ${deleteTargetPath}？` : "删除项目文件？"}
        description="此操作不可恢复，文件会从当前书籍项目中删除。"
        confirmLabel="删除"
        cancelLabel="取消"
        tone="danger"
        pending={deletingPath}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setDeleteOpen(false);
          setDeleteTargetPath(null);
        }}
      />
    </section>
  );
}
