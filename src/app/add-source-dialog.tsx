"use client";

import { type MouseEvent, useEffect, useState } from "react";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { AddLinkForm } from "@/app/add-link-form";
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
  uploadPdfAction: ServerAction;
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

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 16V4M8 8l4-4 4 4M20 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3" />
    </svg>
  );
}

export function AddSourceButton({ label }: { label: string }) {
  function openAddSource(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    window.dispatchEvent(new CustomEvent(OPEN_ADD_SOURCE_EVENT, { detail: { tab: "url" } }));
  }

  return (
    // Keep the href as a pre-hydration fallback; hydrated clicks open the dialog immediately.
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a
      className="globalAddAction addSourceButton"
      aria-haspopup="dialog"
      href="/add/url"
      onClick={openAddSource}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      {label}
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
  subscribeRssAction,
  uploadPdfAction
}: AddSourceDialogProps) {
  const copy = getUiCopy(locale);
  const [activeTab, setActiveTab] = useState<AddSourceTab>(initialTab);
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [detectedFeedUrl, setDetectedFeedUrl] = useState<string | undefined>(rssPreviewUrl);
  const tabs: Array<{ label: string; value: AddSourceTab }> = [
    { label: locale === "zh-Hans" ? "保存链接" : "Save link", value: "url" },
    { label: locale === "zh-Hans" ? "订阅 RSS" : "RSS feed", value: "rss" },
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

  function close() {
    setIsOpen(false);
    if (window.location.pathname.startsWith("/add/")) {
      window.history.pushState(null, "", "/");
    }
  }

  return (
    <div className={`addDialog ${isOpen ? "open" : ""}`} id="add-source" role="dialog" aria-labelledby="add-source-title" aria-modal={isOpen ? "true" : undefined}>
      <button className="addDialogBackdrop" onClick={close} type="button" aria-label={copy.addSource.close} />
      <section className="addDialogPanel">
        <header>
          <h2 id="add-source-title">{copy.addSource.title}</h2>
          <button className="dialogCloseButton" onClick={close} type="button" aria-label={copy.addSource.close}><CloseIcon /></button>
        </header>
        <p>{copy.addSource.description}</p>

        <div className="sourceTabs" aria-label="Source types">
          {tabs.map((tab) => (
            <button className={activeTab === tab.value ? "active" : ""} key={tab.value} onClick={() => setActiveTab(tab.value)} type="button">
              <SourceTabIcon tab={tab.value} /> {tab.label}
            </button>
          ))}
        </div>

        <div className="sourcePanels">
          {activeTab === "rss" ? (
            <RssSubscribeForm
              initialError={rssPreviewError}
              initialUrl={detectedFeedUrl}
              key={detectedFeedUrl}
              locale={locale}
              subscribeAction={subscribeRssAction}
            />
          ) : null}

          {activeTab === "url" ? <AddLinkForm action={saveUrlAction} locale={locale} onFeed={url => { setDetectedFeedUrl(url); setActiveTab("rss"); }} /> : null}

          {activeTab === "pdf" ? <form action={uploadPdfAction} className="sourceForm">
            <label htmlFor="pdf-file">{copy.addSource.pdf}</label>
            <div className="pdfDrop">
              <span><UploadIcon /></span>
              <strong>{copy.addSource.pdfChoose}</strong>
              <small>{copy.addSource.pdfHelp}</small>
              <input id="pdf-file" name="file" type="file" accept="application/pdf" required />
            </div>
            {pdfError ? <div className="sourceError">{pdfError}</div> : null}
            <button type="submit">{copy.addSource.uploadPdf}</button>
          </form> : null}
        </div>
        <div className="addSourceAlternatives">
          <span>{locale === "zh-Hans" ? "OPML、播客与 Newsletter 导入" : "For OPML, podcasts & newsletters"}</span>
          <button type="button" onClick={() => {
            close();
            window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { tab: "import", target: "opml" } }));
          }}>{locale === "zh-Hans" ? "前往设置" : "Settings"}<span aria-hidden="true"> →</span></button>
        </div>
      </section>
    </div>
  );
}
