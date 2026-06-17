import { useEffect, useMemo, useState } from "react";
import { Bot, BookOpen, Library, PenTool, SlidersHorizontal } from "lucide-react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { booksApi } from "./api/books";
import { ConfirmModal } from "./components/Modal";
import { AgentSettings } from "./pages/AgentSettings";
import { AiPresetsOverview } from "./pages/AiPresetsOverview";
import { BookShelf } from "./pages/BookShelf";
import { KnowledgeBase } from "./pages/KnowledgeBase";
import { Workbench } from "./pages/Workbench";

type LeaveGuard = () => boolean;

function workbenchPath(bookId: string): string {
  return `/workbench/${encodeURIComponent(bookId)}`;
}

function knowledgeBasePath(bookId: string): string {
  return `/knowledge-base/${encodeURIComponent(bookId)}`;
}

function viewKindFromPath(pathname: string): string {
  if (pathname.startsWith("/workbench/")) return "workbench";
  if (pathname.startsWith("/knowledge-base")) return "knowledge-base";
  if (pathname === "/books" || pathname === "/") return "shelf";
  if (pathname === "/agents") return "agents";
  if (pathname === "/ai-presets") return "ai-presets";
  return "";
}

function bookIdFromPath(pathname: string): string | null {
  const match = /^\/(?:workbench|knowledge-base)\/([^/]+)(?:\/|$)/.exec(
    pathname,
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function KnowledgeBaseRoute({
  registerLeaveGuard,
  onOpenBooks,
}: {
  registerLeaveGuard(guard: LeaveGuard | null): void;
  onOpenBooks(): void;
}) {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) {
      navigate("/books", { replace: true });
      return;
    }

    let cancelled = false;
    setChecking(true);
    setError(null);
    booksApi
      .listBooks()
      .then((books) => {
        if (cancelled) return;
        if (!books.some((book) => book.id === bookId)) {
          navigate("/books", { replace: true });
          return;
        }
        setChecking(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setChecking(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, navigate]);

  if (!bookId) return null;

  if (checking) {
    return <div className="shelf muted">正在打开资料库...</div>;
  }

  if (error) {
    return (
      <div className="shelf">
        <div className="error">打开资料库失败：{error}</div>
        <button className="icon-button" onClick={onOpenBooks}>
          返回书籍管理
        </button>
      </div>
    );
  }

  return (
    <KnowledgeBase
      bookId={bookId}
      onOpenBooks={onOpenBooks}
      registerLeaveGuard={registerLeaveGuard}
    />
  );
}

function WorkbenchRoute({
  registerLeaveGuard,
  onOpenBooks,
}: {
  registerLeaveGuard(guard: LeaveGuard | null): void;
  onOpenBooks(): void;
}) {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) {
      navigate("/books", { replace: true });
      return;
    }

    let cancelled = false;
    setChecking(true);
    setError(null);
    booksApi
      .listBooks()
      .then((books) => {
        if (cancelled) return;
        if (!books.some((book) => book.id === bookId)) {
          navigate("/books", { replace: true });
          return;
        }
        setChecking(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setChecking(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, navigate]);

  if (!bookId) return null;

  if (checking) {
    return <div className="shelf muted">正在打开创作台...</div>;
  }

  if (error) {
    return (
      <div className="shelf">
        <div className="error">打开创作台失败：{error}</div>
        <button className="icon-button" onClick={onOpenBooks}>
          返回书籍管理
        </button>
      </div>
    );
  }

  return (
    <Workbench
      bookId={bookId}
      onOpenBooks={onOpenBooks}
      registerLeaveGuard={registerLeaveGuard}
    />
  );
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [leaveGuard, setLeaveGuard] = useState<LeaveGuard | null>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const viewKind = useMemo(
    () => viewKindFromPath(location.pathname),
    [location.pathname],
  );

  const currentBookId = useMemo(
    () => bookIdFromPath(location.pathname),
    [location.pathname],
  );

  function commitNavigation(path: string, options?: { replace?: boolean }) {
    if (!path.startsWith("/workbench/") && !path.startsWith("/knowledge-base/")) {
      setLeaveGuard(null);
    }
    navigate(path, options);
  }

  function guardedNavigate(path: string, options?: { replace?: boolean }) {
    if (location.pathname !== path && leaveGuard) {
      setPendingPath(path);
      return;
    }
    commitNavigation(path, options);
  }

  function confirmPendingNavigation() {
    if (!pendingPath) return;
    const next = pendingPath;
    setPendingPath(null);
    setLeaveGuard(null);
    commitNavigation(next);
  }

  function registerLeaveGuard(guard: LeaveGuard | null) {
    setLeaveGuard(() => guard);
  }

  return (
    <div className="app-shell">
      <aside className="activity-bar" aria-label="主导航">
        <div className="brand">
          <span className="brand-mark" title="NovelLoom">NL</span>
        </div>

        <nav className="module-nav" aria-label="主导航">
          <button
            className={`activity-item ${
              viewKind === "workbench" ? "active" : ""
            }`}
            onClick={() => {
              if (viewKind === "workbench") return;
              if (currentBookId) {
                guardedNavigate(workbenchPath(currentBookId));
                return;
              }
              guardedNavigate("/books");
            }}
            title="创作台"
            aria-label="创作台"
            aria-pressed={viewKind === "workbench"}
            data-tooltip="创作台"
          >
            <PenTool size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            className={`activity-item ${
              viewKind === "knowledge-base" ? "active" : ""
            }`}
            onClick={() => {
              if (viewKind === "knowledge-base") return;
              if (currentBookId) {
                guardedNavigate(knowledgeBasePath(currentBookId));
                return;
              }
              guardedNavigate("/books");
            }}
            title="资料库"
            aria-label="资料库"
            aria-pressed={viewKind === "knowledge-base"}
            data-tooltip="资料库"
          >
            <Library size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            className={`activity-item ${viewKind === "shelf" ? "active" : ""}`}
            onClick={() => guardedNavigate("/books")}
            title="书籍管理"
            aria-label="书籍管理"
            aria-pressed={viewKind === "shelf"}
            data-tooltip="书籍管理"
          >
            <BookOpen size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            className={`activity-item ${viewKind === "agents" ? "active" : ""}`}
            onClick={() => guardedNavigate("/agents")}
            title="Agent 管理"
            aria-label="Agent 管理"
            aria-pressed={viewKind === "agents"}
            data-tooltip="Agent 管理"
          >
            <Bot size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            className={`activity-item ${viewKind === "ai-presets" ? "active" : ""}`}
            onClick={() => guardedNavigate("/ai-presets")}
            title="AI 预设"
            aria-label="AI 预设"
            aria-pressed={viewKind === "ai-presets"}
            data-tooltip="AI 预设"
          >
            <SlidersHorizontal size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </nav>
      </aside>

      <main className="module-main">
        <Routes>
          <Route path="/" element={<Navigate to="/books" replace />} />
          <Route path="/workbench" element={<Navigate to="/books" replace />} />
          <Route
            path="/knowledge-base"
            element={<Navigate to="/books" replace />}
          />
          <Route
            path="/books"
            element={
              <BookShelf
                onOpen={(id) => guardedNavigate(workbenchPath(id))}
              />
            }
          />
          <Route
            path="/workbench/:bookId"
            element={
              <WorkbenchRoute
                registerLeaveGuard={registerLeaveGuard}
                onOpenBooks={() => guardedNavigate("/books")}
              />
            }
          />
          <Route
            path="/knowledge-base/:bookId"
            element={
              <KnowledgeBaseRoute
                registerLeaveGuard={registerLeaveGuard}
                onOpenBooks={() => guardedNavigate("/books")}
              />
            }
          />
          <Route
            path="/agents"
            element={<AgentSettings registerLeaveGuard={registerLeaveGuard} />}
          />
          <Route path="/ai-presets" element={<AiPresetsOverview />} />
          <Route path="*" element={<Navigate to="/books" replace />} />
        </Routes>
      </main>

      <ConfirmModal
        open={pendingPath !== null}
        title="离开当前页面？"
        description="当前有未保存的修改，离开后这些修改可能会丢失。"
        confirmLabel="仍要离开"
        cancelLabel="继续编辑"
        tone="danger"
        onConfirm={confirmPendingNavigation}
        onCancel={() => setPendingPath(null)}
      />
    </div>
  );
}
