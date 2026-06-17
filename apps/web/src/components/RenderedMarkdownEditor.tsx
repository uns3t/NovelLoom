import { useEffect, useMemo, useRef } from "react";
import {
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  MDXEditor,
  type MDXEditorMethods,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

interface RenderedMarkdownEditorProps {
  value: string;
  placeholder?: string;
  onChange(value: string): void;
  onError?(message: string): void;
}

function markdownEditorErrorMessage(payload: unknown): string {
  if (payload instanceof Error) return payload.message;
  if (payload && typeof payload === "object") {
    const error = "error" in payload ? payload.error : undefined;
    if (typeof error === "string" && error.trim()) return error;
    if (error instanceof Error) return error.message;
    const message = "message" in payload ? payload.message : undefined;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Markdown 内容无法导入渲染态编辑器";
}

export function RenderedMarkdownEditor({
  value,
  placeholder,
  onChange,
  onError,
}: RenderedMarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const lastValueRef = useRef(value);
  const lastEditorMarkdownRef = useRef(value);
  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      tablePlugin(),
      codeBlockPlugin(),
      codeMirrorPlugin(),
      diffSourcePlugin({ viewMode: "rich-text" }),
      markdownShortcutPlugin(),
    ],
    [],
  );

  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    if (value === lastEditorMarkdownRef.current) return;
    lastEditorMarkdownRef.current = value;
    editorRef.current?.setMarkdown(value);
  }, [value]);

  return (
    <MDXEditor
      ref={editorRef}
      className="rendered-markdown-editor"
      contentEditableClassName="rendered-markdown-content"
      markdown={value}
      onChange={(markdown, initialMarkdownNormalize) => {
        lastValueRef.current = markdown;
        lastEditorMarkdownRef.current = markdown;
        if (initialMarkdownNormalize) return;
        onChange(markdown);
      }}
      onError={(payload) => {
        onError?.(markdownEditorErrorMessage(payload));
      }}
      placeholder={placeholder}
      plugins={plugins}
      spellCheck
    />
  );
}
