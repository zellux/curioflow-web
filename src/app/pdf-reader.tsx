"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { SystemLanguage } from "@/app/i18n";
import { pdfLocation, type PdfLocation } from "@/app/pdf-location";
import { PdfPage, type LocatedPdfMark, type PdfMark, type PdfTool, type PdfZoom } from "@/app/pdf-page";
import { savedPdfPage, usePdfReadingProgress } from "@/app/pdf-reading-progress";
import { openPdfSource, PDF_RANGE_SIZE } from "@/app/pdf-source";

type OutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number];
type Editor = { mark?: PdfMark; location: PdfLocation | null; note: string; quote?: string };
type StoredMark = { id: string; locationJson: string; note: string | null; quote: string };

function readMark({ id, note, quote, locationJson }: StoredMark): PdfMark {
  let location = null;
  try {
    location = pdfLocation(JSON.parse(locationJson));
  } catch {
    // The quote and note remain available for older annotations.
  }
  return { id, note, quote, location };
}

function markTop(mark: PdfMark) {
  const location = mark.location;
  return location?.type === "pdf-text-underline" ? location.segments[0].y : location?.y ?? 0;
}

function PdfOutline({ items, onJump }: { items: OutlineItem[]; onJump: (item: OutlineItem) => void }) {
  return <ul>{items.map((item, index) => <li key={index}>
    {item.dest ? <button type="button" onClick={() => onJump(item)}>{item.title}</button> : <span>{item.title}</span>}
    {item.items.length ? <PdfOutline items={item.items} onJump={onJump} /> : null}
  </li>)}</ul>;
}

export function PdfReader({ itemId, initialProgress, positionJson, annotations, locale }: {
  itemId: string;
  initialProgress: number;
  positionJson: string;
  annotations: StoredMark[];
  locale: SystemLanguage;
}) {
  const zh = locale === "zh-Hans";
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [page, setPage] = useState(() => savedPdfPage(positionJson));
  const [pageInput, setPageInput] = useState<string | null>(null);
  const [zoom, setZoom] = useState<PdfZoom>("page");
  const [tool, setTool] = useState<PdfTool>("read");
  const [panel, setPanel] = useState<"outline" | "notes" | null>(null);
  // Reader annotations arrive newest first. Keep that order when adding marks.
  const [marks, setMarks] = useState(() => annotations.map(readMark));
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const canvasRoot = useRef<HTMLElement>(null);
  const editorInput = useRef<HTMLTextAreaElement>(null);
  const assetBase = "/api/pdf-assets";
  const itemUrl = `/api/items/${encodeURIComponent(itemId)}`;
  const pdfUrl = `${itemUrl}/pdf`;
  const { progress, save, saveFailed } = usePdfReadingProgress(itemId, initialProgress);
  const pageCount = pdf?.numPages ?? 0;
  const current = pageCount ? Math.min(page, pageCount) : page;
  const loading = zh ? "正在加载 PDF…" : "Loading PDF…";
  const pageLabel = (number: number) => zh ? `第 ${number} 页` : `Page ${number}`;

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    const controller = new AbortController();
    const fail = (error?: unknown) => {
      if (!active) return;
      const locked = error instanceof Error && error.name === "PasswordException";
      setPdf(undefined);
      setLoadError(locked
        ? (zh ? "这份 PDF 需要密码。可用系统 PDF 阅读器打开原文件。" : "This PDF requires a password. Open the original in your system PDF viewer.")
        : (zh ? "无法打开 PDF。请重新加载，或尝试打开原文件。" : "Could not open this PDF. Reload the reader or open the original."));
    };
    void (async () => {
      const { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, version } = await import("pdfjs-dist");
      if (!active) return;
      const range = await openPdfSource(PDFDataRangeTransport, pdfUrl, controller, () => {
        controller.abort();
        fail();
        void task?.destroy().catch(() => undefined);
      });
      if (!active) return;
      GlobalWorkerOptions.workerSrc = `${assetBase}/build/pdf.worker.min.mjs?v=${version}`;
      task = getDocument({
        range,
        rangeChunkSize: PDF_RANGE_SIZE,
        cMapUrl: `${assetBase}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assetBase}/standard_fonts/`,
        iccUrl: `${assetBase}/iccs/`,
        wasmUrl: `${assetBase}/wasm/`,
        disableStream: true,
        disableAutoFetch: true,
        isEvalSupported: false
      });
      const document = await task.promise;
      if (!active) return;
      setPdf(document);
      void document.getOutline().then(items => {
        if (active && items) setOutline(items);
      }).catch(() => undefined);
    })().catch(fail);
    return () => {
      active = false;
      controller.abort();
      void task?.destroy().catch(() => undefined);
    };
  }, [pdfUrl, zh]);

  const go = useCallback((target: number) => {
    if (!pageCount || !Number.isSafeInteger(target)) return;
    const next = Math.max(1, Math.min(pageCount, target));
    setPageInput(null);
    if (next === current) return;
    setPage(next);
    save(next, pageCount);
  }, [current, pageCount, save]);

  const closePanel = useCallback(() => {
    setEditor(null);
    setPanel(null);
    setError("");
  }, []);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) return;
      if (event.key === "Escape") {
        if (!busy) {
          closePanel();
          setTool("read");
        }
        return;
      }
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 1, End: pageCount }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      go(next);
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [busy, closePanel, current, go, pageCount]);

  const editing = Boolean(editor);
  const editingMark = editor?.mark?.id;
  useEffect(() => {
    if (editing) editorInput.current?.focus();
  }, [editing, editingMark]);

  function chooseTool(next: PdfTool) {
    setTool(tool === next ? "read" : next);
    closePanel();
    canvasRoot.current?.querySelector<HTMLElement>(".pdfViewport")?.focus({ preventScroll: true });
  }

  async function jumpToChapter(item: OutlineItem) {
    if (!pdf || !item.dest) return;
    try {
      const destination = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      if (!destination?.length) throw new Error();
      const reference = destination[0];
      const index = typeof reference === "number" ? reference : await pdf.getPageIndex(reference);
      go(index + 1);
      closePanel();
    } catch {
      setError(zh ? "无法跳到该章节。" : "Could not jump to this chapter.");
    }
  }

  function editMark(mark: PdfMark) {
    if (busy) return;
    if (mark.location) go(mark.location.page);
    setTool("read");
    setError("");
    setPanel("notes");
    setEditor({ mark, location: mark.location, note: mark.note ?? "" });
  }

  async function writeMark(action: "POST" | "PATCH" | "DELETE" | "undo", draft: Editor) {
    if (busy) return;
    const method = action === "undo" ? "DELETE" : action;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${itemUrl}/annotations`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(method === "POST"
          ? { location: draft.location, note: draft.note, quote: draft.quote }
          : { annotationId: draft.mark?.id, note: draft.note })
      });
      if (!response.ok) throw new Error();
      if (method === "POST") {
        const mark = readMark((await response.json()).annotation);
        if (!mark.location) throw new Error();
        setMarks(currentMarks => [mark, ...currentMarks]);
      } else {
        setMarks(currentMarks => method === "PATCH"
          ? currentMarks.map(mark => mark.id === draft.mark?.id ? { ...mark, note: draft.note.trim() || null } : mark)
          : currentMarks.filter(mark => mark.id !== draft.mark?.id));
      }
      setEditor(current => current === draft || (action === "undo" && current?.mark?.id === draft.mark?.id) ? null : current);
    } catch {
      if (action === "undo") {
        setError(zh ? "未能撤销，请重试。" : "Could not undo the annotation. Try again.");
      } else {
        setError(zh ? "未能保存批注，请重试。" : "Could not save the annotation. Try again.");
        setEditor(draft);
        setPanel("notes");
      }
    } finally {
      setBusy(false);
    }
  }

  function createMark(location: PdfLocation, quote?: string) {
    if (busy) return;
    const draft = { location, quote, note: "" };
    if (location.type !== "pdf-note") {
      void writeMark("POST", draft);
    } else {
      setTool("read");
      setPanel("notes");
      setEditor(draft);
    }
  }

  function setPageFromInput(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pageInput?.trim()) go(Number(pageInput));
    setPageInput(null);
  }

  const pageMarks = marks.filter((mark): mark is LocatedPdfMark => mark.location?.page === current);
  const latestMark = marks.find(mark => mark.location);
  const undoLabel = zh ? "撤销最近一次划线或批注" : "Undo last underline or note";
  const noteLabel = zh ? "批注" : "Notes";
  const panelLabel = panel === "outline" ? (zh ? "目录" : "Contents") : noteLabel;
  const cannotSave = !editor || (editor.location?.type === "pdf-note" && !editor.note.trim());

  return <section className="pdfReader" ref={canvasRoot} aria-label={zh ? "PDF 阅读器" : "PDF reader"}>
    <div className="pdfControls">
      <form className="pdfPagination" onSubmit={setPageFromInput}>
        <button type="button" disabled={!pageCount || current <= 1} onClick={() => go(current - 1)} aria-label={zh ? "上一页" : "Previous page"} title={zh ? "上一页" : "Previous page"}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label={zh ? "页码" : "Page number"} disabled={!pageCount}
          value={pageInput ?? (pageCount ? current : "")} onChange={event => setPageInput(event.target.value)}
          onFocus={event => event.currentTarget.select()} onBlur={() => setPageInput(null)} />
        <span>/ {pageCount || "…"}</span>
        <button type="button" disabled={!pageCount || current >= pageCount} onClick={() => go(current + 1)} aria-label={zh ? "下一页" : "Next page"} title={zh ? "下一页" : "Next page"}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </form>
      <select value={zoom} aria-label={zh ? "缩放" : "Zoom"} onChange={event => {
        const value = event.target.value;
        setZoom(value === "width" || value === "page" ? value : Number(value));
      }}>
        <option value="page">{zh ? "适合页面" : "Fit page"}</option>
        <option value="width">{zh ? "适合宽度" : "Fit width"}</option>
        <option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option>
      </select>
      <div className="pdfTools">
        <button type="button" disabled={!pageCount || busy} aria-pressed={tool === "underline"} onClick={() => chooseTool("underline")} aria-label={zh ? "划线" : "Underline"} title={zh ? "划线" : "Underline"}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v6a5 5 0 0 0 10 0V4M5 21h14" /></svg>
        </button>
        <button type="button" disabled={!pageCount || busy} aria-pressed={tool === "note"} onClick={() => chooseTool("note")} aria-label={zh ? "添加批注" : "Add note"} title={zh ? "添加批注" : "Add note"}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12h-5l-4 4v-4H4zM12 7v6M9 10h6" /></svg>
        </button>
        <button type="button" disabled={busy || !latestMark} aria-label={undoLabel} title={undoLabel}
          onClick={() => {
            if (latestMark) void writeMark("undo", { mark: latestMark, location: latestMark.location, note: "" });
          }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 3 10l5 5M3 10h11a5 5 0 0 1 0 10h-3" /></svg>
        </button>
        {outline.length ? <button type="button" disabled={busy} aria-pressed={panel === "outline"} onClick={() => {
          closePanel();
          setTool("read");
          if (panel !== "outline") setPanel("outline");
        }} aria-label={zh ? "目录" : "Contents"} title={zh ? "目录" : "Contents"}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" /></svg>
        </button> : null}
        <button type="button" disabled={busy} aria-pressed={panel === "notes"} onClick={() => {
          closePanel();
          setTool("read");
          if (panel !== "notes") setPanel("notes");
        }} aria-label={noteLabel} title={noteLabel}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12h-5l-4 4v-4H4zM8 8h8M8 12h6" /></svg>
        </button>
      </div>
      <span className="pdfProgress" title={zh ? "阅读进度" : "Reading progress"}>
        {saveFailed ? <button type="button" onClick={() => save(current, pageCount)}>{zh ? "重试保存进度" : "Retry saving progress"}</button> : pageCount === 1 && progress < 1 ? <button type="button" onClick={() => save(1, 1)}>{zh ? "标记已读" : "Mark read"}</button> : `${Math.round(progress * 100)}%`}
      </span>
    </div>
    <div className="pdfStage">
      {!panel && error ? <div className="pdfPageMessage pdfUndoError" role="alert">{error}</div> : null}
      {tool !== "read" ? <button className="pdfToolHint" type="button" onClick={() => setTool("read")}>
        {tool === "underline" ? (zh ? "选择文字，或在空白处拖动划线" : "Select text, or drag from a blank area to underline")
          : (zh ? "点击页面或按 Enter 添加批注" : "Tap the page or press Enter to add a note")} <span aria-hidden="true">×</span>
      </button> : null}
      {pdf ? <PdfPage key={current} pdf={pdf} number={current} zoom={zoom} tool={tool} marks={pageMarks}
        draft={editor?.location?.page === current && !editor.mark ? editor.location : undefined}
        onMark={createMark} onSelect={editMark} busy={busy || Boolean(editor)} loadingLabel={loading}
        selectionLabel={zh ? "划线" : "Underline selection"}
        errorLabel={zh ? "无法渲染此页。" : "Could not render this page."} pageLabel={pageLabel(current)} />
        : <div className="pdfPageMessage" role={loadError ? "alert" : "status"}>
          {loadError || loading}
          {loadError ? <a href={pdfUrl} target="_blank" rel="noreferrer">{zh ? "打开原文件" : "Open original"}</a> : null}
        </div>}
      {panel ? <aside className="pdfPanel" aria-label={panelLabel}>
        <header><strong>{panelLabel}</strong><button type="button" disabled={busy} onClick={closePanel} aria-label={zh ? "关闭" : "Close"}>×</button></header>
        {error ? <p className="pdfError" role="alert">{error}</p> : null}
        {panel === "outline" ? <PdfOutline items={outline} onJump={item => void jumpToChapter(item)} /> : (
          <>
            {editor ? <form className="pdfNoteEditor" onSubmit={event => {
              event.preventDefault();
              if (!cannotSave) void writeMark(editor.mark ? "PATCH" : "POST", editor);
            }}>
              <label htmlFor="pdf-note">{editor.location ? `${pageLabel(editor.location.page)} · ` : ""}{zh ? "批注内容" : "Note"}</label>
              <textarea id="pdf-note" ref={editorInput} disabled={busy} value={editor.note} maxLength={4000}
                onChange={event => setEditor({ ...editor, note: event.target.value })} rows={4} />
              <div>
                <button type="submit" disabled={busy || cannotSave}>{zh ? "保存" : "Save"}</button>
                <button type="button" disabled={busy} onClick={() => { setEditor(null); setError(""); }}>{zh ? "取消" : "Cancel"}</button>
                {editor.mark ? <button type="button" disabled={busy} onClick={() => void writeMark("DELETE", editor)}>{zh ? "删除" : "Delete"}</button> : null}
              </div>
            </form> : null}
            {marks.length ? <ol className="pdfNotes">{[...marks].sort((a, b) =>
              (a.location?.page ?? Number.MAX_SAFE_INTEGER) - (b.location?.page ?? Number.MAX_SAFE_INTEGER) ||
              markTop(a) - markTop(b)
            ).map(mark => (
              <li key={mark.id}><button type="button" disabled={busy} onClick={() => editMark(mark)}>
                <small>{mark.location ? `${pageLabel(mark.location.page)} · ` : ""}
                  {mark.location?.type === "pdf-note" ? noteLabel : (zh ? "划线" : "Underline")}</small>
                {mark.quote ? <span>{mark.quote}</span> : null}
                {mark.note ? <span>{mark.note}</span> : null}
              </button></li>
            ))}</ol> : !editor ? <p>{zh ? "还没有划线或批注。" : "No underlines or notes yet."}</p> : null}
          </>
        )}
      </aside> : null}
    </div>
  </section>;
}
