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
import { ensureAllReadingFontStylesheets } from "@/app/reading-fonts";
import { SettingsTabs, type SettingsTab } from "@/app/settings-tabs";
import { getUiCopy, pickLocale, type SystemLanguage } from "@/app/i18n";
import { isNewsletterSettingsHref, isSettingsOverlayHref, OPEN_SETTINGS_EVENT, settingsOverlayHref } from "@/app/settings-overlay-state";
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
  contextWindowLimit: number | null;
  askContextWindowLimit: number | null;
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
  const dialogCopy = pickLocale(locale, {
    en: {
      close: "Close",
      discard: "Discard changes",
      discardBody: "Your model and language changes have not been saved.",
      discardTitle: "Discard unsaved changes?",
      done: "Done",
      keepEditing: "Keep editing",
      saveFailed: "Could not save. Your changes are kept; please retry.",
      savedOnDevice: "Saved automatically on this device",
      saving: "Saving…",
      unsavedChanges: "Unsaved changes"
    },
    "zh-Hans": {
      close: "关闭",
      discard: "放弃修改",
      discardBody: "模型和语言配置尚未保存。",
      discardTitle: "放弃未保存的修改？",
      done: "完成",
      keepEditing: "继续编辑",
      saveFailed: "保存失败，修改已保留，请重试。",
      savedOnDevice: "自动保存到此设备",
      saving: "保存中…",
      unsavedChanges: "有未保存的修改"
    },
    "zh-Hant": {
      close: "關閉",
      discard: "捨棄變更",
      discardBody: "模型與語言設定尚未儲存。",
      discardTitle: "捨棄未儲存的變更？",
      done: "完成",
      keepEditing: "繼續編輯",
      saveFailed: "儲存失敗，你的變更已保留，請重試。",
      savedOnDevice: "自動儲存於此裝置",
      saving: "儲存中…",
      unsavedChanges: "有未儲存的變更"
    },
    ja: {
      close: "閉じる",
      discard: "変更を破棄",
      discardBody: "モデルと言語の設定がまだ保存されていません。",
      discardTitle: "未保存の変更を破棄しますか？",
      done: "完了",
      keepEditing: "編集を続ける",
      saveFailed: "保存できませんでした。変更内容は保持されています。もう一度お試しください。",
      savedOnDevice: "このデバイスに自動保存されます",
      saving: "保存中…",
      unsavedChanges: "未保存の変更があります"
    },
    ko: {
      close: "닫기",
      discard: "변경 사항 버리기",
      discardBody: "모델 및 언어 설정이 아직 저장되지 않았습니다.",
      discardTitle: "저장하지 않은 변경 사항을 버릴까요?",
      done: "완료",
      keepEditing: "계속 편집",
      saveFailed: "저장하지 못했습니다. 변경 사항은 유지되니 다시 시도하세요.",
      savedOnDevice: "이 기기에 자동 저장됩니다",
      saving: "저장 중…",
      unsavedChanges: "저장되지 않은 변경 사항"
    }
  });
  const [saveError, saveAction, isSaving] = useActionState(async (_previous: string | null, formData: FormData) => {
    try { await updateLlmSettingsAction(formData); return null; }
    catch (error) {
      unstable_rethrow(error);
      return dialogCopy.saveFailed;
    }
  }, null);
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
    setActiveTab(resolvedInitialTab === "import" && isNewsletterSettingsHref(window.location.href)
      ? "newsletter"
      : resolvedInitialTab);
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
      const detail = (event as CustomEvent<{ tab?: "import" | "newsletter"; target?: string }>).detail;
      if (detail?.tab) setActiveTab(detail.tab);
      if (detail?.target) requestAnimationFrame(() => requestAnimationFrame(() => { document.getElementById(`import-${detail.target}`)?.scrollIntoView({ block: "start" }); }));
      setIsOpen(true);
      if (isSettingsOverlayHref(window.location.href)) return;
      window.history.pushState(
        { ...window.history.state, curioflowSettingsOverlay: true },
        "",
        settingsOverlayHref(window.location.href, detail?.tab === "newsletter" ? detail.tab : undefined)
      );
    }

    function handlePopState() {
      const open = isSettingsOverlayHref(window.location.href);
      if (!open && isDirty && !isSaving) {
        window.history.pushState({ ...window.history.state, curioflowSettingsOverlay: true }, "", settingsOverlayHref(window.location.href));
        setConfirmDiscard(true);
        return;
      }
      if (open && isNewsletterSettingsHref(window.location.href)) setActiveTab("newsletter");
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
    if (isOpen && activeTab === "style") {
      ensureAllReadingFontStylesheets();
    }
  }, [activeTab, isOpen]);

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
          newsletter: copy.settings.newsletter,
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
              initialContextWindowLimit={llmSettings.contextWindowLimit}
              initialAskContextWindowLimit={llmSettings.askContextWindowLimit}
              initialAskModel={llmSettings.askModel}
              initialAskModelContextWindow={llmSettings.askModelContextWindow}
              initialProvider={llmSettings.provider}
              contextWindowError={llmError}
              locale={locale}
              settingsSaved={saved === "llm"}
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
          </section>
          <section className="settingsSection settingsPanelPane settingsPanelPane--newsletter">
            <h2 className="settingsPaneTitle">{copy.settings.newsletter}</h2>
            <NewsletterAddressPanel locale={locale} />
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
            <button className="settingsCancelAction" disabled={isSaving} onClick={isDirty ? finishClose : close} type="button">{isDirty ? dialogCopy.discard : dialogCopy.close}</button>
          ) : null}
          <span className={`settingsStatusSlot ${saveNoticeVisible && !isDirty ? "hasSaveNotice" : ""}`}>
            <span className="settingsUpdatedAt" role="status" hidden={activeTab !== "model" && activeTab !== "language" && activeTab !== "style"}>
              {activeTab === "style" ? dialogCopy.savedOnDevice : isDirty ? dialogCopy.unsavedChanges : llmSettings.updatedAt
              ? `${copy.common.updated} ${formatSettingsDate(llmSettings.updatedAt, locale, copy.common.noDate)}`
              : copy.settings.updatedDefault}
            </span>
            <span aria-hidden={!saveNoticeVisible || isDirty} className="settingsSaveNotice" role="status">
              {copy.settings.configurationSaved}
            </span>
          </span>
          {activeTab === "style" ? (
            <button onClick={close} disabled={isSaving} type="button">{dialogCopy.done}</button>
          ) : activeTab === "language" || activeTab === "model" ? (
            <button form="settingsForm" disabled={!isDirty || isSaving} aria-busy={isSaving} type="submit">{isSaving ? dialogCopy.saving : copy.settings.save}</button>
          ) : null}
        </div>
      </section>
      {confirmDiscard ? <div className="settingsConfirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-settings-title" ref={discardRef}>
        <button className="settingsConfirmBackdrop" tabIndex={-1} aria-label={dialogCopy.keepEditing} onClick={keepEditing} type="button" />
        <section className="settingsConfirmPanel">
          <h2 id="discard-settings-title">{dialogCopy.discardTitle}</h2>
          <p>{dialogCopy.discardBody}</p>
          <div><button onClick={keepEditing} type="button">{dialogCopy.keepEditing}</button><button onClick={finishClose} type="button">{dialogCopy.discard}</button></div>
        </section>
      </div> : null}
    </div>
  );
}
