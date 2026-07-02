"use client";

import { apiFetch } from "@/lib/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";

type Attachment = {
  id: string;
  name: string;
  size: number;
  type: string;
};

type ComposerValue = {
  html: string;
  text: string;
  attachments: Attachment[];
};

type ComposerProps = {
  initialHtml?: string | null;
  initialText: string;
  subject: string;
  onChange: (value: ComposerValue) => void;
  onSubject?: (subject: string) => void;
  onDirty?: () => void;
};

const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace(/['"]+/g, ""),
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            }
          }
        }
      }
    ];
  }
});

const templates = [
  { name: "Frequently Used", subject: "Re: Your project inquiry", html: "<p>Hi {{name}},</p><p>Thanks for reaching out. We can certainly help with this. Could you please share a little more detail about your goals, timeline, and any existing website/app links?</p>" },
  { name: "SEO Proposal", subject: "SEO support for your website", html: "<p>Hi {{name}},</p><p>We can help improve Google visibility, ranking opportunities, technical SEO, and qualified traffic. A good next step would be a quick review of your current website and target locations.</p>" },
  { name: "Website Proposal", subject: "Website redesign discussion", html: "<p>Hi {{name}},</p><p>We can certainly help with a cleaner, faster, mobile-friendly website focused on conversions. Please share your current website and any design references you like.</p>" },
  { name: "AI Proposal", subject: "AI automation idea", html: "<p>Hi {{name}},</p><p>We can help create an AI automation/agent MVP that reduces manual work and improves workflow speed. Could you share the process you want to automate?</p>" },
  { name: "App Proposal", subject: "Mobile app MVP discussion", html: "<p>Hi {{name}},</p><p>We can help shape this into a practical MVP with the right feature set, user flow, and launch plan. Please share the main user roles and core features.</p>" },
  { name: "CRM Proposal", subject: "CRM and follow-up automation", html: "<p>Hi {{name}},</p><p>We can help with lead management, follow-up automation, sales tracking, and CRM integrations. Could you share your current sales workflow?</p>" },
  { name: "Proposal Follow-up", subject: "Following up", html: "<p>Hi {{name}},</p><p>Just following up to see if you had a chance to review my previous email. Happy to clarify anything or suggest the best next step.</p>" }
];

const signatures = [
  {
    name: "Abhay Kumar",
    html: "<p>Best regards,<br><strong>Abhay Kumar</strong><br>Sales &amp; Marketing Director<br>AResourcePool</p>"
  },
  {
    name: "Short Signature",
    html: "<p>Regards,<br>Abhay<br>AResourcePool</p>"
  }
];

const aiActions = [
  "Rewrite",
  "Shorter",
  "Longer",
  "Professional",
  "Friendly",
  "Formal",
  "Grammar Fix",
  "Translate",
  "Improve CTA",
  "Generate Subject",
  "Generate Follow-up",
  "Regenerate",
  "Save as Template"
];

export function ProfessionalEmailComposer({ initialHtml, initialText, subject, onChange, onSubject, onDirty }: ComposerProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState<"desktop" | "mobile" | "html" | null>(null);
  const [aiBusy, setAiBusy] = useState("");
  const [toast, setToast] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const templatesRef = useRef<HTMLDetailsElement>(null);
  const html = initialHtml || textToHtml(initialText);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { HTMLAttributes: { style: "background:#f8fafc;padding:12px;border-radius:6px" } } }),
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Write your email..." })
    ],
    content: html,
    editorProps: {
      attributes: {
        class: "min-h-[380px] bg-surface px-5 py-4 leading-7 outline-none"
      },
      handleDrop(_view, event) {
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return false;
        handleFiles(files);
        return true;
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files || []);
        if (files.length) {
          handleFiles(files);
          return true;
        }
        return false;
      }
    },
    onUpdate({ editor }) {
      emitChange(editor.getHTML(), editor.getText());
      onDirty?.();
    }
  });

  useEffect(() => {
    if (editor) {
      onChange({ html: editor.getHTML(), text: editor.getText(), attachments });
    }
  }, [attachments, editor, onChange]);

  const currentHtml = editor?.getHTML() || html;
  const currentText = editor?.getText() || initialText;
  const previewHtml = useMemo(() => wrapEmailHtml(currentHtml), [currentHtml]);

  function emitChange(nextHtml: string, nextText: string) {
    onChange({ html: nextHtml, text: nextText, attachments });
  }

  function emitLatestChange() {
    if (!editor) return;
    window.setTimeout(() => {
      emitChange(editor.getHTML(), editor.getText());
      onDirty?.();
      editor.commands.focus();
    }, 0);
  }

  function handleFiles(files: File[]) {
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => editor?.chain().focus().setImage({ src: String(reader.result), alt: file.name }).run();
        reader.readAsDataURL(file);
      } else {
        setAttachments((items) => [...items, { id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type || "application/octet-stream" }]);
      }
    }
  }

  async function aiAction(action: string) {
    if (!editor) return;
    if (action === "Save as Template") {
      window.localStorage.setItem("lastEmailTemplate", editor.getHTML());
      setToast("Template saved.");
      window.setTimeout(() => setToast(""), 2500);
      editor.commands.focus();
      return;
    }
    setAiBusy(action);
    setToast("");
    const { from, to, empty } = editor.state.selection;
    const selectedText = empty ? "" : editor.state.doc.textBetween(from, to, "\n").trim();
    const sourceHtml = empty ? editor.getHTML() : textToHtml(selectedText);
    const sourceText = empty ? editor.getText() : selectedText;
    const response = await apiFetch("/api/composer/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, html: sourceHtml, text: sourceText, subject })
    });
    const data = await response.json();
    setAiBusy("");
    if (!response.ok) return;
    if (data.subject && onSubject) onSubject(data.subject);
    const nextHtml = data.html || (data.text ? textToHtml(data.text) : "");
    if (nextHtml) {
      if (empty) {
        editor.chain().focus().setContent(nextHtml).run();
      } else {
        editor.chain().focus().insertContent(nextHtml).run();
      }
      emitLatestChange();
      setToast("Draft updated.");
      window.setTimeout(() => setToast(""), 2500);
    }
  }

  useEffect(() => {
    function onAiAction(event: Event) {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action) aiAction(action);
    }
    function onPreview(event: Event) {
      const mode = (event as CustomEvent<{ mode?: "desktop" | "mobile" | "html" }>).detail?.mode || "desktop";
      setPreview(mode);
    }
    function onOpenTemplates() {
      if (templatesRef.current) templatesRef.current.open = true;
      setToast("Choose a template below.");
      window.setTimeout(() => setToast(""), 2500);
    }
    window.addEventListener("composer-ai-action", onAiAction);
    window.addEventListener("composer-preview", onPreview);
    window.addEventListener("composer-open-templates", onOpenTemplates);
    return () => {
      window.removeEventListener("composer-ai-action", onAiAction);
      window.removeEventListener("composer-preview", onPreview);
      window.removeEventListener("composer-open-templates", onOpenTemplates);
    };
  });

  if (!editor) return <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">Loading composer...</div>;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-surface/95 p-2 backdrop-blur-xl">
        <IconButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>↶</IconButton>
        <IconButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>↷</IconButton>
        <IconButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>B</IconButton>
        <IconButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></IconButton>
        <IconButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></IconButton>
        <IconButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></IconButton>
        <select className="h-9 rounded-xl border border-line bg-surface px-2 text-sm" onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()} defaultValue="">
          <option value="">Font</option>
          {["Arial", "Georgia", "Times New Roman", "Verdana", "Tahoma", "Courier New"].map((font) => <option key={font} value={font}>{font}</option>)}
        </select>
        <select className="h-9 rounded-xl border border-line bg-surface px-2 text-sm" onChange={(e) => editor.chain().focus().setMark("textStyle", { fontSize: e.target.value }).run()} defaultValue="">
          <option value="">Size</option>
          {["12px", "14px", "16px", "18px", "24px", "32px"].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <input title="Text color" type="color" className="h-9 w-10 rounded-xl border border-line bg-surface" onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
        <input title="Highlight color" type="color" className="h-9 w-10 rounded-xl border border-line bg-surface" onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()} />
        <IconButton label="Heading" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H</IconButton>
        <IconButton label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()}>•</IconButton>
        <IconButton label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</IconButton>
        <IconButton label="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</IconButton>
        <IconButton label="Code block" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{"</>"}</IconButton>
        <IconButton label="Horizontal line" onClick={() => editor.chain().focus().setHorizontalRule().run()}>―</IconButton>
        <IconButton label="Link" onClick={() => {
          const href = window.prompt("URL");
          if (href) editor.chain().focus().setLink({ href }).run();
        }}>🔗</IconButton>
        <IconButton label="Image" onClick={() => imageRef.current?.click()}>▧</IconButton>
        <IconButton label="Table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</IconButton>
        <IconButton label="Button" onClick={() => {
          const url = window.prompt("Button URL") || "#";
          const text = window.prompt("Button text") || "View Details";
          editor.chain().focus().insertContent(`<p><a href="${escapeAttr(url)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">${escapeHtml(text)}</a></p>`).run();
        }}>CTA</IconButton>
        <IconButton label="Attachment" onClick={() => fileRef.current?.click()}>📎</IconButton>
        <select className="h-9 rounded-xl border border-line bg-surface px-2 text-sm" onChange={(e) => e.target.value && editor.chain().focus().insertContent(e.target.value).run()} defaultValue="">
          <option value="">Emoji</option>
          {["🙂", "👍", "✅", "📌", "🚀", "💡"].map((emoji) => <option key={emoji} value={emoji}>{emoji}</option>)}
        </select>
        <select className="h-9 rounded-xl border border-line bg-surface px-2 text-sm" onChange={(e) => {
          const selected = signatures.find((item) => item.name === e.target.value);
          if (selected) editor.chain().focus().insertContent(selected.html).run();
        }} defaultValue="">
          <option value="">Signature</option>
          {signatures.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">AI</span>
        {["Rewrite", "Shorter", "Professional"].map((action) => (
          <button key={action} type="button" onClick={() => aiAction(action)} disabled={Boolean(aiBusy)} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold shadow-sm hover:border-strong disabled:cursor-not-allowed disabled:opacity-60">
            {aiBusy === action ? "Improving..." : action}
          </button>
        ))}
        <select
          className="h-8 rounded-lg border border-line bg-surface px-2 text-xs font-semibold"
          value=""
          disabled={Boolean(aiBusy)}
          onChange={(e) => {
            if (e.target.value) aiAction(e.target.value);
          }}
        >
          <option value="">AI Assistant</option>
          {aiActions.map((action) => <option key={action} value={action}>{action}</option>)}
        </select>
        {aiBusy ? <span className="text-xs font-medium text-muted">Improving draft...</span> : null}
        {toast ? <span className="text-xs font-semibold text-emerald-700">{toast}</span> : null}
      </div>
      <details ref={templatesRef} className="border-b border-line bg-subtle">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-muted">Templates & saved content</summary>
        <div className="flex flex-wrap gap-2 px-3 pb-3">
          <select className="rounded-lg border border-line bg-surface px-2 py-1 text-xs" onChange={(e) => {
            const selected = templates.find((item) => item.name === e.target.value);
            if (selected) {
              editor.commands.setContent(selected.html);
              onSubject?.(selected.subject);
              emitLatestChange();
            }
          }} defaultValue="">
            <option value="">Templates</option>
            {templates.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </div>
      </details>
      <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFiles(Array.from(e.target.files || []))} />
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(Array.from(e.target.files || []))} />
      <EditorContent editor={editor} />
      {attachments.length ? (
        <div className="border-t border-line p-3 text-sm">
          <div className="mb-2 font-semibold">Attachments</div>
          <div className="flex flex-wrap gap-2">
            {attachments.map((file) => (
          <span key={file.id} className="rounded-lg bg-subtle px-2 py-1">{file.name} ({Math.ceil(file.size / 1024)} KB)</span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="border-t border-line px-3 py-2">
        <div className="flex flex-wrap gap-2">
          {(["desktop", "mobile", "html"] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => setPreview(mode)} className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold hover:border-strong">
              {mode === "html" ? "HTML Preview" : `${mode[0].toUpperCase()}${mode.slice(1)} Preview`}
            </button>
          ))}
        </div>
      </div>
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={() => setPreview(null)}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl border border-line bg-white p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-bold">{preview === "html" ? "HTML Preview" : `${preview[0].toUpperCase()}${preview.slice(1)} Preview`}</h3>
              <button type="button" onClick={() => setPreview(null)} className="rounded-lg border border-line px-3 py-1 text-sm font-semibold hover:border-strong">Close</button>
            </div>
            {preview === "html" ? (
              <pre className="max-h-[70vh] overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-50">{previewHtml}</pre>
            ) : (
              <div className={`mx-auto overflow-auto rounded-2xl border border-line p-4 shadow-sm ${preview === "mobile" ? "max-w-sm" : "max-w-3xl"} bg-surface`}>
                <div dangerouslySetInnerHTML={{ __html: currentHtml }} />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IconButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`h-9 min-w-9 rounded-xl border border-line px-2 text-sm font-semibold shadow-sm ${active ? "bg-accent text-white" : "bg-surface hover:border-strong"}`}>
      {children}
    </button>
  );
}

function textToHtml(value: string) {
  return value.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

function wrapEmailHtml(value: string) {
  return `<!doctype html><html><body><div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${value}</div></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
