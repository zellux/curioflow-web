"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { changePasswordAction, logoutAction, updateLlmSettingsAction } from "@/app/actions";
import { ConnectionSettingsPanel, type ConnectionSettingsCopy } from "@/app/connection-settings";
import { LlmSettingsFields } from "@/app/llm-settings-fields";
import { NewsletterAddressPanel } from "@/app/newsletter-address-panel";
import { OpmlImportForm } from "@/app/opml-import-form";
import { ReadingStyleSettings, type ReadingStyleInitialState } from "@/app/reading-style-settings";
import { SettingsTabs, type SettingsTab } from "@/app/settings-tabs";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { isSettingsOverlayHref, OPEN_SETTINGS_EVENT, settingsOverlayHref } from "@/app/settings-overlay-state";
import { parseSettingsScrollSnapshot, restoredSettingsScrollTop } from "@/app/settings-scroll-state";
import type { ConnectionSettings } from "@/server/connections";

const SETTINGS_SAVE_SCROLL_KEY = "curioflow:settings-save-scroll";

type LlmSettings = {
  baseUrl: string;
  enabled: boolean;
  hasApiKey: boolean;
  model: string;
  askModel: string;
  modelContextWindow: number | null;
  askModelContextWindow: number | null;
  provider: string;
  summaryConcurrency: number;
  summaryLanguage: string;
  systemLanguage: string;
  updatedAt: Date | string | null;
};

type SettingsDialogProps = {
  addPodcastAction: (formData: FormData) => Promise<void>;
  closeHref: string;
  connections: ConnectionSettings;
  initialOpen: boolean;
  initialTab?: SettingsTab;
  importOpmlAction: (formData: FormData) => Promise<void>;
  llmSettings: LlmSettings;
  llmError?: string;
  locale: SystemLanguage;
  opmlError: string | null;
  passwordStatus?: string;
  podcastError: string | null;
  podcastUrl?: string;
  readingStyle: ReadingStyleInitialState;
  returnTo: string;
  saved?: string;
  userName: string;
};

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function formatSettingsDate(date: Date | string | null, locale: SystemLanguage, noDate: string) {
  if (!date) return noDate;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric"
  }).format(new Date(date));
}

export function SettingsDialog({
  addPodcastAction,
  closeHref,
  connections,
  initialTab = "style",
  importOpmlAction,
  locale,
  llmSettings,
  llmError,
  opmlError,
  passwordStatus,
  podcastError,
  podcastUrl,
  readingStyle,
  initialOpen,
  returnTo,
  saved,
  userName
}: SettingsDialogProps) {
  const copy = getUiCopy(locale);
  const resolvedInitialTab: SettingsTab = passwordStatus ? "account" : llmError ? "model" : initialTab;
  const panelRef = useRef<HTMLElement>(null);
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [activeTab, setActiveTab] = useState<SettingsTab>(resolvedInitialTab);
  const [styleSaved, setStyleSaved] = useState(false);
  const [summaryRegenerationCounts, setSummaryRegenerationCounts] = useState({ all: 0, missing: 0 });
  const close = useCallback(() => {
    setIsOpen(false);
    const state = window.history.state as { curioflowSettingsOverlay?: unknown } | null;
    if (state?.curioflowSettingsOverlay) {
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, "", closeHref);
  }, [closeHref]);

  useEffect(() => {
    setIsOpen(initialOpen);
  }, [initialOpen]);

  useEffect(() => {
    setActiveTab(resolvedInitialTab);
  }, [resolvedInitialTab]);

  useLayoutEffect(() => {
    if (!isOpen || saved !== "llm") return;
    const snapshot = parseSettingsScrollSnapshot(window.sessionStorage.getItem(SETTINGS_SAVE_SCROLL_KEY));
    window.sessionStorage.removeItem(SETTINGS_SAVE_SCROLL_KEY);
    if (!snapshot || snapshot.pathname !== window.location.pathname) return;

    const content = panelRef.current?.querySelector<HTMLElement>(".settingsTabContent");
    if (content) {
      content.scrollTop = restoredSettingsScrollTop(snapshot, {
        clientHeight: content.clientHeight,
        scrollHeight: content.scrollHeight
      });
    }
    window.scrollTo({ behavior: "auto", left: 0, top: snapshot.windowTop });
  }, [isOpen, saved]);

  useEffect(() => {
    function handleOpen() {
      setIsOpen(true);
      if (isSettingsOverlayHref(window.location.href)) return;
      window.history.pushState(
        { ...window.history.state, curioflowSettingsOverlay: true },
        "",
        settingsOverlayHref(window.location.href)
      );
    }

    function handlePopState() {
      setIsOpen(isSettingsOverlayHref(window.location.href));
    }

    window.addEventListener(OPEN_SETTINGS_EVENT, handleOpen);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, handleOpen);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !llmSettings.enabled) return;
    const controller = new AbortController();

    void fetch("/api/settings/llm/regenerate-summaries", {
      method: "GET",
      signal: controller.signal
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { all?: unknown; missing?: unknown } | null;
        if (!response.ok) return;
        setSummaryRegenerationCounts({
          all: typeof body?.all === "number" ? body.all : 0,
          missing: typeof body?.missing === "number" ? body.missing : 0
        });
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [isOpen, llmSettings.enabled]);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [close, isOpen]);

  const connectionCopy: ConnectionSettingsCopy = {
    connectionConfigured: copy.settings.connectionConfigured,
    connectionNeedsAttention: copy.settings.connectionNeedsAttention,
    connections: copy.settings.connections,
    connectionsIntro: copy.settings.connectionsIntro,
    connectionTest: copy.settings.connectionTest,
    connectionTestFailed: copy.settings.connectionTestFailed,
    connectionTesting: copy.settings.connectionTesting,
    connectionTestSucceeded: copy.settings.connectionTestSucceeded
  };

  const rememberSettingsScroll = useCallback(() => {
    const content = panelRef.current?.querySelector<HTMLElement>(".settingsTabContent");
    if (!content) return;
    window.sessionStorage.setItem(SETTINGS_SAVE_SCROLL_KEY, JSON.stringify({
      contentHeight: content.scrollHeight,
      contentTop: content.scrollTop,
      pathname: window.location.pathname,
      windowTop: window.scrollY
    }));
  }, []);

  const changeTab = useCallback((tab: SettingsTab) => {
    setActiveTab(tab);
    setStyleSaved(false);
  }, []);

  return (
    <div className={`settingsDialog ${isOpen ? "open" : ""}`} role="dialog" aria-labelledby="settings-title" aria-modal={isOpen ? "true" : undefined}>
      <button className="settingsDialogBackdrop" onClick={close} type="button" aria-label={copy.settings.close} />
      <section className="settingsDialogPanel" ref={panelRef}>
        <header>
          <div className="settingsTitleGroup">
            <h1 id="settings-title">{copy.settings.title}</h1>
            <span className="selfHostedBadge">Self Hosted</span>
          </div>
          <button className="dialogCloseButton" onClick={close} type="button" aria-label={copy.settings.close}><CloseIcon /></button>
        </header>
        <SettingsTabs activeTab={activeTab} connectionNeedsAttention={!connections.twitter.configured || !connections.influx.configured} labels={{
          account: copy.settings.account,
          connections: copy.settings.connections,
          importFeeds: copy.settings.importFeeds,
          language: copy.settings.language,
          languageModel: copy.settings.languageModel,
          readingStyle: copy.settings.readingStyle,
          title: copy.settings.title
        }} onTabChange={changeTab}>
          <section className="settingsSection settingsPanelPane settingsPanelPane--style">
            <h2 className="settingsPaneTitle">{copy.settings.readingStyle}</h2>
            <p className="settingsIntro">{copy.settings.readingStyleIntro}</p>
            <ReadingStyleSettings initialStyle={readingStyle} locale={locale} onChange={() => setStyleSaved(false)} />
          </section>
          <form action={updateLlmSettingsAction} className="settingsForm settingsTabbedForm" id="settingsForm" onSubmit={rememberSettingsScroll}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="settingsTab" value={activeTab} />
            <LlmSettingsFields
              hasApiKey={llmSettings.hasApiKey}
              initialEnabled={llmSettings.enabled}
              initialBaseUrl={llmSettings.baseUrl}
              initialModel={llmSettings.model}
              initialModelContextWindow={llmSettings.modelContextWindow}
              initialAskModel={llmSettings.askModel}
              initialAskModelContextWindow={llmSettings.askModelContextWindow}
              initialProvider={llmSettings.provider}
              contextWindowError={llmError}
              locale={locale}
              settingsSaved={saved === "llm"}
              summaryRegenerationCounts={summaryRegenerationCounts}
              initialSummaryConcurrency={llmSettings.summaryConcurrency}
              initialSummaryLanguage={llmSettings.summaryLanguage}
              initialSystemLanguage={llmSettings.systemLanguage}
            />
          </form>
          <ConnectionSettingsPanel connections={connections} copy={connectionCopy} />
          <section className="settingsSection settingsPanelPane settingsPanelPane--import">
            <h2 className="settingsPaneTitle">{copy.settings.importFeeds}</h2>
            <p className="settingsIntro">{copy.settings.importFeedsIntro}</p>
            <div className="settingsImportGroup">
              <h3 className="settingsSubsectionTitle">{copy.settings.importOpml}</h3>
              <p>{copy.settings.importOpmlIntro}</p>
              <OpmlImportForm importAction={importOpmlAction} initialError={opmlError} locale={locale} />
            </div>
            <div className="settingsImportGroup">
              <h3 className="settingsSubsectionTitle">{copy.settings.podcastSubscriptions}</h3>
              <p>{copy.settings.podcastSubscriptionsIntro}</p>
              <form action={addPodcastAction} className="sourceForm podcastSourceForm">
                <label htmlFor="settings-podcast-url">{copy.addSource.podcastRssUrl}</label>
                <input id="settings-podcast-url" name="url" type="text" inputMode="url" placeholder={copy.addSource.podcastPlaceholder} defaultValue={podcastUrl ?? ""} required />
                <div className="sourcePreview">
                  <div>
                    <span>{copy.addSource.podcastEpisodes}</span>
                    <strong>{copy.addSource.podcastReady}</strong>
                    <small>{copy.addSource.podcastHelp}</small>
                  </div>
                </div>
                {podcastError ? <div className="sourceError">{podcastError}</div> : null}
                <button type="submit">{copy.addSource.subscribePodcast}</button>
              </form>
            </div>
            <div className="settingsImportGroup">
              <NewsletterAddressPanel locale={locale} />
            </div>
          </section>
          <section className="settingsSection settingsPanelPane settingsPanelPane--account">
            <h2 className="settingsPaneTitle">{copy.settings.account}</h2>
            <p className="settingsIntro">{copy.settings.accountIntro}</p>
            <div className="settingsAccountIdentity">
              <span>{userName.slice(0, 1).toUpperCase()}</span>
              <strong>{userName}</strong>
            </div>
            <div className="settingsAccountDivider" />
            <h3 className="settingsSubsectionTitle">{copy.settings.changePassword}</h3>
            <p className="settingsAccountPasswordHint">{copy.settings.changePasswordHint}</p>
            {passwordStatus === "success" ? <p className="settingsPasswordNotice settingsPasswordNotice--success" role="status">{copy.settings.passwordChanged}</p> : null}
            {passwordStatus && passwordStatus !== "success" ? (
              <p className="settingsPasswordNotice settingsPasswordNotice--error" role="alert">
                {passwordStatus === "mismatch"
                  ? copy.settings.passwordMismatch
                  : passwordStatus === "weak-password"
                    ? copy.settings.passwordTooShort
                    : passwordStatus === "unchanged-password"
                      ? copy.settings.passwordUnchanged
                      : copy.settings.currentPasswordIncorrect}
              </p>
            ) : null}
            <form action={changePasswordAction} className="settingsPasswordForm">
              <input type="hidden" name="returnTo" value={returnTo} />
              <label className="settingsField">
                <span>{copy.settings.currentPassword}</span>
                <input name="currentPassword" type="password" autoComplete="current-password" required />
              </label>
              <label className="settingsField">
                <span>{copy.settings.newPassword}</span>
                <input name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
              </label>
              <label className="settingsField">
                <span>{copy.settings.confirmNewPassword}</span>
                <input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required />
              </label>
              <button className="settingsPasswordAction" type="submit">{copy.settings.updatePassword}</button>
            </form>
            <div className="settingsAccountDivider" />
            <form action={logoutAction}>
              <button className="settingsSignOutAction" type="submit">{copy.settings.signOut}</button>
            </form>
          </section>
        </SettingsTabs>
        <div className="settingsMeta">
          <button className="settingsCancelAction" onClick={close} type="button">{copy.settings.cancel}</button>
          <span className={`settingsUpdatedAt ${styleSaved || saved === "llm" ? "settingsUpdatedAt--saved" : ""}`} role={styleSaved || saved === "llm" ? "status" : undefined}>
            {styleSaved || saved === "llm"
              ? copy.settings.configurationSaved
              : llmSettings.updatedAt
              ? `${copy.common.updated} ${formatSettingsDate(llmSettings.updatedAt, locale, copy.common.noDate)}`
              : copy.settings.updatedDefault}
          </span>
          {activeTab === "style" ? (
            <button onClick={() => setStyleSaved(true)} type="button">{copy.settings.save}</button>
          ) : activeTab === "language" || activeTab === "model" ? (
            <button form="settingsForm" type="submit">{copy.settings.save}</button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
