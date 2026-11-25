"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { pickLocale, type SystemLanguage } from "@/app/i18n";
import { pdfLocation, type PdfLocation } from "@/app/pdf-location";
import { PdfPage, type LocatedPdfMark, type PdfMark, type PdfTool, type PdfZoom } from "@/app/pdf-page";
import { savedPdfPage, usePdfReadingProgress } from "@/app/pdf-reading-progress";
import { openPdfSource, PDF_RANGE_SIZE } from "@/app/pdf-source";

type PdfCopy = {
  loading: string;
  pageLabel: (number: number) => string;
  passwordRequired: string;
  openFailed: string;
  jumpChapterFailed: string;
  undoFailed: string;
  saveFailed: string;
  undoLabel: string;
  noteLabel: string;
  contents: string;
  readerAria: string;
  previousPage: string;
  pageNumber: string;
  nextPage: string;
  zoom: string;
  fitPage: string;
  fitWidth: string;
  underline: string;
  addNote: string;
  readingProgress: string;
  retrySavingProgress: string;
  markRead: string;
  underlineHint: string;
  noteHint: string;
  underlineSelection: string;
  renderError: string;
  openOriginal: string;
  close: string;
  noteField: string;
  save: string;
  cancel: string;
  delete: string;
  emptyNotes: string;
};

const PDF_COPY: Record<SystemLanguage, PdfCopy> = {
  en: {
    loading: "Loading PDF…",
    pageLabel: (number) => `Page ${number}`,
    passwordRequired: "This PDF requires a password. Open the original in your system PDF viewer.",
    openFailed: "Could not open this PDF. Reload the reader or open the original.",
    jumpChapterFailed: "Could not jump to this chapter.",
    undoFailed: "Could not undo the annotation. Try again.",
    saveFailed: "Could not save the annotation. Try again.",
    undoLabel: "Undo last underline or note",
    noteLabel: "Notes",
    contents: "Contents",
    readerAria: "PDF reader",
    previousPage: "Previous page",
    pageNumber: "Page number",
    nextPage: "Next page",
    zoom: "Zoom",
    fitPage: "Fit page",
    fitWidth: "Fit width",
    underline: "Underline",
    addNote: "Add note",
    readingProgress: "Reading progress",
    retrySavingProgress: "Retry saving progress",
    markRead: "Mark read",
    underlineHint: "Select text, or drag from a blank area to underline",
    noteHint: "Tap the page or press Enter to add a note",
    underlineSelection: "Underline selection",
    renderError: "Could not render this page.",
    openOriginal: "Open original",
    close: "Close",
    noteField: "Note",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    emptyNotes: "No underlines or notes yet."
  },
  "zh-Hans": {
    loading: "正在加载 PDF…",
    pageLabel: (number) => `第 ${number} 页`,
    passwordRequired: "这份 PDF 需要密码。可用系统 PDF 阅读器打开原文件。",
    openFailed: "无法打开 PDF。请重新加载，或尝试打开原文件。",
    jumpChapterFailed: "无法跳到该章节。",
    undoFailed: "未能撤销，请重试。",
    saveFailed: "未能保存批注，请重试。",
    undoLabel: "撤销最近一次划线或批注",
    noteLabel: "批注",
    contents: "目录",
    readerAria: "PDF 阅读器",
    previousPage: "上一页",
    pageNumber: "页码",
    nextPage: "下一页",
    zoom: "缩放",
    fitPage: "适合页面",
    fitWidth: "适合宽度",
    underline: "划线",
    addNote: "添加批注",
    readingProgress: "阅读进度",
    retrySavingProgress: "重试保存进度",
    markRead: "标记已读",
    underlineHint: "选择文字，或在空白处拖动划线",
    noteHint: "点击页面或按 Enter 添加批注",
    underlineSelection: "划线",
    renderError: "无法渲染此页。",
    openOriginal: "打开原文件",
    close: "关闭",
    noteField: "批注内容",
    save: "保存",
    cancel: "取消",
    delete: "删除",
    emptyNotes: "还没有划线或批注。"
  },
  "zh-Hant": {
    loading: "正在載入 PDF…",
    pageLabel: (number) => `第 ${number} 頁`,
    passwordRequired: "這份 PDF 需要密碼。可用系統 PDF 閱讀器開啟原檔案。",
    openFailed: "無法開啟 PDF。請重新載入，或嘗試開啟原檔案。",
    jumpChapterFailed: "無法跳至該章節。",
    undoFailed: "無法復原，請重試。",
    saveFailed: "無法儲存批註，請重試。",
    undoLabel: "復原最近一次畫線或批註",
    noteLabel: "批註",
    contents: "目錄",
    readerAria: "PDF 閱讀器",
    previousPage: "上一頁",
    pageNumber: "頁碼",
    nextPage: "下一頁",
    zoom: "縮放",
    fitPage: "符合頁面",
    fitWidth: "符合寬度",
    underline: "畫線",
    addNote: "新增批註",
    readingProgress: "閱讀進度",
    retrySavingProgress: "重試儲存進度",
    markRead: "標記為已讀",
    underlineHint: "選取文字，或在空白處拖曳畫線",
    noteHint: "點擊頁面或按 Enter 新增批註",
    underlineSelection: "畫線",
    renderError: "無法算繪此頁。",
    openOriginal: "開啟原檔案",
    close: "關閉",
    noteField: "批註內容",
    save: "儲存",
    cancel: "取消",
    delete: "刪除",
    emptyNotes: "還沒有畫線或批註。"
  },
  ja: {
    loading: "PDF を読み込み中…",
    pageLabel: (number) => `${number} ページ`,
    passwordRequired: "この PDF にはパスワードが必要です。システムの PDF ビューアで元のファイルを開いてください。",
    openFailed: "この PDF を開けませんでした。リーダーを再読み込みするか、元のファイルを開いてください。",
    jumpChapterFailed: "この章に移動できませんでした。",
    undoFailed: "注釈を元に戻せませんでした。もう一度お試しください。",
    saveFailed: "注釈を保存できませんでした。もう一度お試しください。",
    undoLabel: "直前の下線またはメモを元に戻す",
    noteLabel: "メモ",
    contents: "目次",
    readerAria: "PDF リーダー",
    previousPage: "前のページ",
    pageNumber: "ページ番号",
    nextPage: "次のページ",
    zoom: "ズーム",
    fitPage: "ページに合わせる",
    fitWidth: "幅に合わせる",
    underline: "下線",
    addNote: "メモを追加",
    readingProgress: "読書進捗",
    retrySavingProgress: "進捗の保存を再試行",
    markRead: "既読にする",
    underlineHint: "テキストを選択するか、余白からドラッグして下線を引きます",
    noteHint: "ページをクリックするか Enter キーでメモを追加します",
    underlineSelection: "選択範囲に下線",
    renderError: "このページを表示できませんでした。",
    openOriginal: "元のファイルを開く",
    close: "閉じる",
    noteField: "メモ内容",
    save: "保存",
    cancel: "キャンセル",
    delete: "削除",
    emptyNotes: "下線やメモはまだありません。"
  },
  ko: {
    loading: "PDF 불러오는 중…",
    pageLabel: (number) => `${number}페이지`,
    passwordRequired: "이 PDF에는 비밀번호가 필요합니다. 시스템 PDF 뷰어에서 원본 파일을 열어 주세요.",
    openFailed: "이 PDF를 열 수 없습니다. 리더를 새로고침하거나 원본 파일을 열어 보세요.",
    jumpChapterFailed: "이 장으로 이동할 수 없습니다.",
    undoFailed: "주석을 실행 취소할 수 없습니다. 다시 시도해 주세요.",
    saveFailed: "주석을 저장할 수 없습니다. 다시 시도해 주세요.",
    undoLabel: "마지막 밑줄 또는 메모 실행 취소",
    noteLabel: "메모",
    contents: "목차",
    readerAria: "PDF 리더",
    previousPage: "이전 페이지",
    pageNumber: "페이지 번호",
    nextPage: "다음 페이지",
    zoom: "확대/축소",
    fitPage: "페이지에 맞춤",
    fitWidth: "너비에 맞춤",
    underline: "밑줄",
    addNote: "메모 추가",
    readingProgress: "읽기 진행률",
    retrySavingProgress: "진행률 저장 재시도",
    markRead: "읽음으로 표시",
    underlineHint: "텍스트를 선택하거나 빈 영역에서 드래그하여 밑줄을 긋습니다",
    noteHint: "페이지를 클릭하거나 Enter 키를 눌러 메모를 추가하세요",
    underlineSelection: "선택 영역에 밑줄",
    renderError: "이 페이지를 표시할 수 없습니다.",
    openOriginal: "원본 파일 열기",
    close: "닫기",
    noteField: "메모 내용",
    save: "저장",
    cancel: "취소",
    delete: "삭제",
    emptyNotes: "아직 밑줄이나 메모가 없습니다."
  }
};

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
  const copy = pickLocale(locale, PDF_COPY);
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
  const loading = copy.loading;
  const pageLabel = copy.pageLabel;

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    const controller = new AbortController();
    const fail = (error?: unknown) => {
      if (!active) return;
      const locked = error instanceof Error && error.name === "PasswordException";
      setPdf(undefined);
      setLoadError(locked ? copy.passwordRequired : copy.openFailed);
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
  }, [copy, pdfUrl]);

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
      setError(copy.jumpChapterFailed);
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
        setError(copy.undoFailed);
      } else {
        setError(copy.saveFailed);
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
  const undoLabel = copy.undoLabel;
  const noteLabel = copy.noteLabel;
  const panelLabel = panel === "outline" ? copy.contents : noteLabel;
  const cannotSave = !editor || (editor.location?.type === "pdf-note" && !editor.note.trim());

  return <section className="pdfReader" ref={canvasRoot} aria-label={copy.readerAria}>
    <div className="pdfControls">
      <form className="pdfPagination" onSubmit={setPageFromInput}>
        <button type="button" disabled={!pageCount || current <= 1} onClick={() => go(current - 1)} aria-label={copy.previousPage} title={copy.previousPage}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label={copy.pageNumber} disabled={!pageCount}
          value={pageInput ?? (pageCount ? current : "")} onChange={event => setPageInput(event.target.value)}
          onFocus={event => event.currentTarget.select()} onBlur={() => setPageInput(null)} />
        <span>/ {pageCount || "…"}</span>
        <button type="button" disabled={!pageCount || current >= pageCount} onClick={() => go(current + 1)} aria-label={copy.nextPage} title={copy.nextPage}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </form>
      <select value={zoom} aria-label={copy.zoom} onChange={event => {
        const value = event.target.value;
        setZoom(value === "width" || value === "page" ? value : Number(value));
      }}>
        <option value="page">{copy.fitPage}</option>
        <option value="width">{copy.fitWidth}</option>
        <option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option>
      </select>
      <div className="pdfTools">
        <button type="button" disabled={!pageCount || busy} aria-pressed={tool === "underline"} onClick={() => chooseTool("underline")} aria-label={copy.underline} title={copy.underline}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v6a5 5 0 0 0 10 0V4M5 21h14" /></svg>
        </button>
        <button type="button" disabled={!pageCount || busy} aria-pressed={tool === "note"} onClick={() => chooseTool("note")} aria-label={copy.addNote} title={copy.addNote}>
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
        }} aria-label={copy.contents} title={copy.contents}>
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
      <span className="pdfProgress" title={copy.readingProgress}>
        {saveFailed ? <button type="button" onClick={() => save(current, pageCount)}>{copy.retrySavingProgress}</button> : pageCount === 1 && progress < 1 ? <button type="button" onClick={() => save(1, 1)}>{copy.markRead}</button> : `${Math.round(progress * 100)}%`}
      </span>
    </div>
    <div className="pdfStage">
      {!panel && error ? <div className="pdfPageMessage pdfUndoError" role="alert">{error}</div> : null}
      {tool !== "read" ? <button className="pdfToolHint" type="button" onClick={() => setTool("read")}>
        {tool === "underline" ? copy.underlineHint : copy.noteHint} <span aria-hidden="true">×</span>
      </button> : null}
      {pdf ? <PdfPage key={current} pdf={pdf} number={current} zoom={zoom} tool={tool} marks={pageMarks}
        draft={editor?.location?.page === current && !editor.mark ? editor.location : undefined}
        onMark={createMark} onSelect={editMark} busy={busy || Boolean(editor)} loadingLabel={loading}
        selectionLabel={copy.underlineSelection}
        errorLabel={copy.renderError} pageLabel={pageLabel(current)} />
        : <div className="pdfPageMessage" role={loadError ? "alert" : "status"}>
          {loadError || loading}
          {loadError ? <a href={pdfUrl} target="_blank" rel="noreferrer">{copy.openOriginal}</a> : null}
        </div>}
      {panel ? <aside className="pdfPanel" aria-label={panelLabel}>
        <header><strong>{panelLabel}</strong><button type="button" disabled={busy} onClick={closePanel} aria-label={copy.close}>×</button></header>
        {error ? <p className="pdfError" role="alert">{error}</p> : null}
        {panel === "outline" ? <PdfOutline items={outline} onJump={item => void jumpToChapter(item)} /> : (
          <>
            {editor ? <form className="pdfNoteEditor" onSubmit={event => {
              event.preventDefault();
              if (!cannotSave) void writeMark(editor.mark ? "PATCH" : "POST", editor);
            }}>
              <label htmlFor="pdf-note">{editor.location ? `${pageLabel(editor.location.page)} · ` : ""}{copy.noteField}</label>
              <textarea id="pdf-note" ref={editorInput} disabled={busy} value={editor.note} maxLength={4000}
                onChange={event => setEditor({ ...editor, note: event.target.value })} rows={4} />
              <div>
                <button type="submit" disabled={busy || cannotSave}>{copy.save}</button>
                <button type="button" disabled={busy} onClick={() => { setEditor(null); setError(""); }}>{copy.cancel}</button>
                {editor.mark ? <button type="button" disabled={busy} onClick={() => void writeMark("DELETE", editor)}>{copy.delete}</button> : null}
              </div>
            </form> : null}
            {marks.length ? <ol className="pdfNotes">{[...marks].sort((a, b) =>
              (a.location?.page ?? Number.MAX_SAFE_INTEGER) - (b.location?.page ?? Number.MAX_SAFE_INTEGER) ||
              markTop(a) - markTop(b)
            ).map(mark => (
              <li key={mark.id}><button type="button" disabled={busy} onClick={() => editMark(mark)}>
                <small>{mark.location ? `${pageLabel(mark.location.page)} · ` : ""}
                  {mark.location?.type === "pdf-note" ? noteLabel : copy.underline}</small>
                {mark.quote ? <span>{mark.quote}</span> : null}
                {mark.note ? <span>{mark.note}</span> : null}
              </button></li>
            ))}</ol> : !editor ? <p>{copy.emptyNotes}</p> : null}
          </>
        )}
      </aside> : null}
    </div>
  </section>;
}
