"use client";

import { type DragEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { useModalFocus } from "@/app/use-modal-focus";
import { getUiCopy, pickLocale, type SystemLanguage } from "@/app/i18n";
import { AddLinkForm } from "@/app/add-link-form";
import { PdfUploadForm } from "@/app/pdf-upload-form";
import { OPEN_SETTINGS_EVENT } from "@/app/settings-overlay-state";
import { RssSubscribeForm } from "@/app/rss-subscribe-form";

type AddSourceTab = "url" | "pdf" | "rss";
type ServerAction = (formData: FormData) => Promise<void>;

type AddSourceDialogProps = {
  initialOpen: boolean;
  initialTab: AddSourceTab;
  locale: SystemLanguage;
  pdfError: string | null;
  rssPreviewError: string | null;
  rssPreviewUrl?: string;
  saveUrlAction: ServerAction;
  subscribeRssAction: ServerAction;
};

const OPEN_ADD_SOURCE_EVENT = "curioflow:open-add-source";

function iconPath(tab: AddSourceTab) {
  if (tab === "url") return "M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1";
  if (tab === "pdf") return "M14 3v5h5M14 3H6v18h12V8z";
  return null;
}

function SourceTabIcon({ tab }: { tab: AddSourceTab }) {
  const path = iconPath(tab);

  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {path ? (
        <path d={path} />
      ) : (
        <>
          <circle cx="5" cy="19" r="1.6" />
          <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
        </>
      )}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function AddSourceButton({ label, tab = "url", className = "globalAddAction addSourceButton" }: {
  label: string;
  tab?: "url" | "rss";
  className?: string;
}) {
  function openAddSource(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    window.dispatchEvent(new CustomEvent(OPEN_ADD_SOURCE_EVENT, { detail: { tab } }));
  }

  return (
    // Keep the href as a pre-hydration fallback; hydrated clicks open the dialog immediately.
    <a
      className={className}
      data-navigation-feedback="false"
      aria-haspopup="dialog"
      href={`/add/${tab}`}
      onClick={openAddSource}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span className="globalAddActionLabel">{label}</span>
    </a>
  );
}

export function AddSourceDialog({
  initialOpen,
  initialTab,
  locale,
  pdfError,
  rssPreviewError,
  rssPreviewUrl,
  saveUrlAction,
  subscribeRssAction
}: AddSourceDialogProps) {
  const copy = getUiCopy(locale);
  const [activeTab, setActiveTab] = useState<AddSourceTab>(initialTab);
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [droppedPdfFile, setDroppedPdfFile] = useState<File | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [detectedFeedUrl, setDetectedFeedUrl] = useState<string | undefined>(rssPreviewUrl);
  const tabs: Array<{ label: string; value: AddSourceTab }> = [
    { label: pickLocale(locale, { en: "Save link", "zh-Hans": "保存链接", "zh-Hant": "儲存連結", ja: "リンクを保存", ko: "링크 저장" }), value: "url" },
    { label: pickLocale(locale, { en: "RSS feed", "zh-Hans": "订阅 RSS", "zh-Hant": "訂閱 RSS", ja: "RSS フィード", ko: "RSS 피드" }), value: "rss" },
    { label: "PDF", value: "pdf" }
  ];

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail as { tab?: AddSourceTab } : {};
      setActiveTab(detail.tab ?? "url");
      setIsOpen(true);
    }

    window.addEventListener(OPEN_ADD_SOURCE_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_ADD_SOURCE_EVENT, handleOpen);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    if (window.location.pathname.startsWith("/add/")) {
      window.history.pushState(null, "", "/");
    }
  }, []);
  useModalFocus(dialogRef, isOpen, close, "#page-url, #rss-url, #pdf-file");

  const consumeDroppedPdf = useCallback(() => {
    setDroppedPdfFile(null);
  }, []);

  function handleDialogDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    if (activeTab !== "pdf") {
      setActiveTab("pdf");
    }
  }

  function handleDialogDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
  }

  function handleDialogDrop(event: DragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    const pdfFile = files.find((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) ?? files[0];
    setActiveTab("pdf");
    setDroppedPdfFile(pdfFile ?? null);
  }

  return (
    <div
      className={`addDialog ${isOpen ? "open" : ""}`}
      ref={dialogRef}
      id="add-source"
      role="dialog"
      aria-labelledby="add-source-title"
      aria-modal={isOpen ? "true" : undefined}
      onDragEnter={handleDialogDragEnter}
      onDragOver={handleDialogDragOver}
      onDrop={handleDialogDrop}
    >
      <button className="addDialogBackdrop" tabIndex={-1} onClick={close} type="button" aria-label={copy.addSource.close} />
      <section className={`addDialogPanel ${activeTab === "pdf" ? "isPdfTab" : ""}`}>
        <header>
          <h2 id="add-source-title">{copy.addSource.title}</h2>
          <button className="dialogCloseButton" onClick={close} type="button" aria-label={copy.addSource.close}><CloseIcon /></button>
        </header>
        <p>{copy.addSource.description}</p>

        <div className="sourceTabs" aria-label="Source types">
          {tabs.map((tab) => (
            <button className={activeTab === tab.value ? "active" : ""} aria-pressed={activeTab === tab.value} aria-controls={`add-panel-${tab.value}`} key={tab.value} onClick={() => setActiveTab(tab.value)} type="button">
              <SourceTabIcon tab={tab.value} /> {tab.label}
            </button>
          ))}
        </div>

        <div className="sourcePanels">
          <div id="add-panel-rss" hidden={activeTab !== "rss"}>
            <RssSubscribeForm
              initialError={rssPreviewError}
              initialUrl={detectedFeedUrl}
              key={detectedFeedUrl}
              locale={locale}
              subscribeAction={subscribeRssAction}
            />
          </div>

          <div id="add-panel-url" hidden={activeTab !== "url"}><AddLinkForm action={saveUrlAction} locale={locale} onFeed={url => { setDetectedFeedUrl(url); setActiveTab("rss"); }} /></div>

          <div id="add-panel-pdf" hidden={activeTab !== "pdf"}>
            <PdfUploadForm
              externalFile={droppedPdfFile}
              initialError={pdfError}
              isActive={isOpen && activeTab === "pdf"}
              locale={locale}
              onExternalFileConsumed={consumeDroppedPdf}
            />
          </div>
        </div>
        <div className="addSourceAlternatives">
          <span>{pickLocale(locale, { en: "Article imports, OPML & newsletters", "zh-Hans": "文章导入、OPML 与 Newsletter", "zh-Hant": "文章匯入、OPML 與電子報", ja: "記事のインポート、OPML、ニュースレター", ko: "글 가져오기, OPML 및 뉴스레터" })}</span>
          <button type="button" onClick={() => {
            close();
            window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { tab: "import", target: "opml" } }));
          }}>{pickLocale(locale, { en: "Settings", "zh-Hans": "前往设置", "zh-Hant": "前往設定", ja: "設定を開く", ko: "설정으로 이동" })}<span aria-hidden="true"> →</span></button>
        </div>
      </section>
    </div>
  );
}
