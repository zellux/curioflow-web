"use client";

import { useActionState, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { useModalFocus } from "@/app/use-modal-focus";
import { changePasswordAction, logoutAction, updateLlmSettingsAction } from "@/app/actions";
import { LlmSettingsFields } from "@/app/llm-settings-fields";
import { NewsletterAddressPanel } from "@/app/newsletter-address-panel";
import { ReadwiseImportForm } from "@/app/readwise-import-form";
import { OpmlImportForm } from "@/app/opml-import-form";
import { ReadingStyleSettings, type ReadingStyleInitialState } from "@/app/reading-style-settings";
import { SettingsTabs, type SettingsTab } from "@/app/settings-tabs";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { isSettingsOverlayHref, OPEN_SETTINGS_EVENT, settingsOverlayHref } from "@/app/settings-overlay-state";
import { parseSettingsScrollSnapshot, restoredSettingsScrollTop } from "@/app/settings-scroll-state";

const SETTINGS_SAVE_SCROLL_KEY = "curioflow:settings-save-scroll";
const SAVE_NOTICE_DURATION_MS = 3_000;

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
  closeHref: string;
  initialOpen: boolean;
  initialTab?: SettingsTab;
  importOpmlAction: (formData: FormData) => Promise<void>;
  llmSettings: LlmSettings;
  llmError?: string;
  locale: SystemLanguage;
  opmlError: string | null;
  passwordStatus?: string;
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
  closeHref,
  initialTab = "style",
  importOpmlAction,
  locale,
  llmSettings,
  llmError,
  opmlError,
  passwordStatus,
  readingStyle,
  initialOpen,
  returnTo,
  saved,
  userName
}: SettingsDialogProps) {
  const copy = getUiCopy(locale);
  const resolvedInitialTab: SettingsTab = passwordStatus ? "account" : llmError ? "model" : initialTab;
  const panelRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const saveNoticeTimeoutRef = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [activeTab, setActiveTab] = useState<SettingsTab>(resolvedInitialTab);
  const [saveNoticeVisible, setSaveNoticeVisible] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardRef = useRef<HTMLDivElement>(null);
  const keepEditing = useCallback(() => setConfirmDiscard(false), []);
  useModalFocus(discardRef, confirmDiscard, keepEditing);
  const [saveError, saveAction, isSaving] = useActionState(async (_previous: string | null, formData: FormData) => {
    try { await updateLlmSettingsAction(formData); return null; }
    catch (error) {
      unstable_rethrow(error);
      return locale === "zh-Hans" ? "保存失败，修改已保留，请重试。" : "Could not save. Your changes are kept; please retry.";
    }
  }, null);
  const [summaryRegenerationCounts, setSummaryRegenerationCounts] = useState({ all: 0, missing: 0 });
  const hideSaveNotice = useCallback(() => {
    if (saveNoticeTimeoutRef.current !== null) {
      window.clearTimeout(saveNoticeTimeoutRef.current);
      saveNoticeTimeoutRef.current = null;
    }
    setSaveNoticeVisible(false);
  }, []);
  const showSaveNotice = useCallback(() => {
    if (saveNoticeTimeoutRef.current !== null) window.clearTimeout(saveNoticeTimeoutRef.current);
    setSaveNoticeVisible(true);
    saveNoticeTimeoutRef.current = window.setTimeout(() => {
      setSaveNoticeVisible(false);
      saveNoticeTimeoutRef.current = null;
    }, SAVE_NOTICE_DURATION_MS);
  }, []);
  const finishClose = useCallback(() => {
    setConfirmDiscard(false);
    setDraftVersion(value => value + 1);
    setIsDirty(false);
    setIsOpen(false);
    const state = window.history.state as { curioflowSettingsOverlay?: unknown } | null;
    if (state?.curioflowSettingsOverlay) {
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, "", closeHref);
  }, [closeHref]);
  const close = useCallback(() => {
    if (isSaving) return;
    if (isDirty) { setConfirmDiscard(true); return; }
    finishClose();
  }, [finishClose, isDirty, isSaving]);
  useModalFocus(dialogRef, isOpen, close, '.settingsTabButton[aria-pressed="true"]');
  useEffect(() => {
    if (!isDirty || isSaving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, isSaving]);

  useEffect(() => {
    setIsOpen(initialOpen);
  }, [initialOpen]);

  useEffect(() => {
    setActiveTab(resolvedInitialTab);
  }, [resolvedInitialTab]);

  useEffect(() => {
    if (saved === "llm") showSaveNotice();
  }, [llmSettings.updatedAt, saved, showSaveNotice]);

  useEffect(() => () => {
    if (saveNoticeTimeoutRef.current !== null) window.clearTimeout(saveNoticeTimeoutRef.current);
  }, []);

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
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<{ tab?: string; target?: string }>).detail;
      if (detail?.tab === "import") setActiveTab("import");
      if (detail?.target) requestAnimationFrame(() => requestAnimationFrame(() => { document.getElementById(`import-${detail.target}`)?.scrollIntoView({ block: "start" }); }));
      setIsOpen(true);
      if (isSettingsOverlayHref(window.location.href)) return;
      window.history.pushState(
        { ...window.history.state, curioflowSettingsOverlay: true },
        "",
        settingsOverlayHref(window.location.href)
      );
    }

    function handlePopState() {
      const open = isSettingsOverlayHref(window.location.href);
      if (!open && isDirty && !isSaving) {
        window.history.pushState({ ...window.history.state, curioflowSettingsOverlay: true }, "", settingsOverlayHref(window.location.href));
        setConfirmDiscard(true);
        return;
      }
      setIsOpen(open);
    }

    window.addEventListener(OPEN_SETTINGS_EVENT, handleOpen);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, handleOpen);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isDirty, isSaving]);

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
    hideSaveNotice();
  }, [hideSaveNotice]);

  return (
    <div className={`settingsDialog ${isOpen ? "open" : ""}`} ref={dialogRef} role="dialog" aria-labelledby="settings-title" aria-modal={isOpen ? "true" : undefined}>
      <button className="settingsDialogBackdrop" tabIndex={-1} onClick={close} type="button" aria-label={copy.settings.close} />
      <section className="settingsDialogPanel" ref={panelRef}>
        <header>
          <div className="settingsTitleGroup">
            <h1 id="settings-title">{copy.settings.title}</h1>
            <span className="selfHostedBadge">Self Hosted</span>
          </div>
          <button className="dialogCloseButton" onClick={close} type="button" aria-label={copy.settings.close}><CloseIcon /></button>
        </header>
        <SettingsTabs activeTab={activeTab} labels={{
          account: copy.settings.account,
          importFeeds: copy.settings.importFeeds,
          language: copy.settings.language,
          languageModel: copy.settings.languageModel,
          readingStyle: copy.settings.readingStyle,
          title: copy.settings.title
        }} onTabChange={changeTab}>
          <section className="settingsSection settingsPanelPane settingsPanelPane--style">
            <h2 className="settingsPaneTitle">{copy.settings.readingStyle}</h2>
            <p className="settingsIntro">{copy.settings.readingStyleIntro}</p>
            <ReadingStyleSettings initialStyle={readingStyle} locale={locale} onChange={hideSaveNotice} />
          </section>
          <form action={saveAction} className="settingsForm settingsTabbedForm" id="settingsForm" onSubmit={rememberSettingsScroll} aria-busy={isSaving}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="settingsTab" value={activeTab} />
            <fieldset className="settingsDraftFields" disabled={isSaving}>
            <LlmSettingsFields
              key={`${llmSettings.updatedAt}:${draftVersion}`}
              onDirtyChange={setIsDirty}
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
            </fieldset>
            {saveError ? <p role="alert" className="settingsPasswordNotice settingsPasswordNotice--error">{saveError}</p> : null}
          </form>
          <section className="settingsSection settingsPanelPane settingsPanelPane--import">
            <h2 className="settingsPaneTitle">{copy.settings.importFeeds}</h2>
            <p className="settingsIntro">{copy.settings.importFeedsIntro}</p>
            <div className="settingsImportGroup" id="import-readwise">
              <h3 className="settingsSubsectionTitle">Readwise Reader</h3>
              <ReadwiseImportForm locale={locale} />
            </div>
            <div className="settingsImportGroup" id="import-opml">
              <h3 className="settingsSubsectionTitle">{copy.settings.importOpml}</h3>
              <p>{copy.settings.importOpmlIntro}</p>
              <OpmlImportForm importAction={importOpmlAction} initialError={opmlError} locale={locale} />
            </div>
            <div className="settingsImportGroup" id="import-newsletter">
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
          {activeTab !== "style" ? (
            <button className="settingsCancelAction" disabled={isSaving} onClick={isDirty ? finishClose : close} type="button">{isDirty ? (locale === "zh-Hans" ? "放弃修改" : "Discard changes") : (locale === "zh-Hans" ? "关闭" : "Close")}</button>
          ) : null}
          <span className={`settingsStatusSlot ${saveNoticeVisible && !isDirty ? "hasSaveNotice" : ""}`}>
            <span className="settingsUpdatedAt" role="status" hidden={activeTab !== "model" && activeTab !== "language" && activeTab !== "style"}>
              {activeTab === "style" ? (locale === "zh-Hans" ? "自动保存到此设备" : "Saved automatically on this device") : isDirty ? (locale === "zh-Hans" ? "有未保存的修改" : "Unsaved changes") : llmSettings.updatedAt
              ? `${copy.common.updated} ${formatSettingsDate(llmSettings.updatedAt, locale, copy.common.noDate)}`
              : copy.settings.updatedDefault}
            </span>
            <span aria-hidden={!saveNoticeVisible || isDirty} className="settingsSaveNotice" role="status">
              {copy.settings.configurationSaved}
            </span>
          </span>
          {activeTab === "style" ? (
            <button onClick={close} disabled={isSaving} type="button">{locale === "zh-Hans" ? "完成" : "Done"}</button>
          ) : activeTab === "language" || activeTab === "model" ? (
            <button form="settingsForm" disabled={!isDirty || isSaving} aria-busy={isSaving} type="submit">{isSaving ? (locale === "zh-Hans" ? "保存中…" : "Saving…") : copy.settings.save}</button>
          ) : null}
        </div>
      </section>
      {confirmDiscard ? <div className="settingsConfirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-settings-title" ref={discardRef}>
        <button className="settingsConfirmBackdrop" tabIndex={-1} aria-label={locale === "zh-Hans" ? "继续编辑" : "Keep editing"} onClick={keepEditing} type="button" />
        <section className="settingsConfirmPanel">
          <h2 id="discard-settings-title">{locale === "zh-Hans" ? "放弃未保存的修改？" : "Discard unsaved changes?"}</h2>
          <p>{locale === "zh-Hans" ? "模型和语言配置尚未保存。" : "Your model and language changes have not been saved."}</p>
          <div><button onClick={keepEditing} type="button">{locale === "zh-Hans" ? "继续编辑" : "Keep editing"}</button><button onClick={finishClose} type="button">{locale === "zh-Hans" ? "放弃修改" : "Discard changes"}</button></div>
        </section>
      </div> : null}
    </div>
  );
}
