import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  size?: "default" | "wide";
  children?: ReactNode;
  footer?: ReactNode;
  onClose(): void;
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  pending?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

interface PromptModalProps {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  value: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  error?: string | null;
  pending?: boolean;
  onChange(value: string): void;
  onConfirm(): void;
  onCancel(): void;
}

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  description,
  size = "default",
  children,
  footer,
  onClose,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      const focusTarget = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      focusTarget?.focus();
    }, 0);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className={`modal-card ${size === "wide" ? "modal-card-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="modal-description">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        {children && <div className="modal-body">{children}</div>}
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "default",
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={() => {
        if (!pending) onCancel();
      }}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "btn-danger modal-confirm-danger" : "icon-button primary"}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "处理中..." : confirmLabel}
          </button>
        </>
      }
    />
  );
}

export function PromptModal({
  open,
  title,
  description,
  label,
  value,
  placeholder,
  confirmLabel = "确认",
  cancelLabel = "取消",
  error,
  pending = false,
  onChange,
  onConfirm,
  onCancel,
}: PromptModalProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) onConfirm();
  }

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={() => {
        if (!pending) onCancel();
      }}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </button>
          <button type="submit" form="modal-prompt-form" className="icon-button primary" disabled={pending}>
            {pending ? "处理中..." : confirmLabel}
          </button>
        </>
      }
    >
      <form id="modal-prompt-form" className="modal-form" onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>{label}</span>
          <input
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            disabled={pending}
          />
        </label>
        {error && <div className="modal-error">{error}</div>}
      </form>
    </Modal>
  );
}
