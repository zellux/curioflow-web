import { updateLlmSettingsAction } from "@/app/actions";
import { LlmSettingsFields } from "@/app/llm-settings-fields";
import { ReadingStyleSettings } from "@/app/reading-style-settings";
import { SettingsTabs } from "@/app/settings-tabs";
import type { SystemLanguage, UiCopy } from "@/app/i18n";

type LlmSettings = {
  baseUrl: string;
  hasApiKey: boolean;
  model: string;
  provider: string;
  summaryLanguage: string;
  systemLanguage: string;
  updatedAt: Date | string | null;
};

type SettingsDialogProps = {
  closeHref: string;
  copy: UiCopy;
  isOpen: boolean;
  llmSettings: LlmSettings;
  locale: SystemLanguage;
  returnTo: string;
  saved?: string;
  summaryRegenerationCount: number;
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
  copy,
  locale,
  llmSettings,
  isOpen,
  returnTo,
  saved,
  summaryRegenerationCount
}: SettingsDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="settingsDialog open" role="dialog" aria-labelledby="settings-title" aria-modal="true">
      <a className="settingsDialogBackdrop" href={closeHref} aria-label={copy.settings.close} />
      <section className="settingsDialogPanel">
        <header>
          <h2 id="settings-title">{copy.settings.title}</h2>
          <a href={closeHref} aria-label={copy.settings.close}><CloseIcon /></a>
        </header>
        <SettingsTabs labels={{
          language: copy.settings.language,
          languageModel: copy.settings.languageModel,
          readingStyle: copy.settings.readingStyle,
          title: copy.settings.title
        }}>
          <section className="settingsSection settingsPanelPane settingsPanelPane--style">
            <h3 className="settingsPaneTitle">{copy.settings.readingStyle}</h3>
            <p className="settingsIntro">{copy.settings.readingStyleIntro}</p>
            <ReadingStyleSettings locale={locale} />
          </section>
          {saved === "llm" ? <p className="settingsSaved">{copy.settings.llmSaved}</p> : null}
          <form action={updateLlmSettingsAction} className="settingsForm settingsTabbedForm" id="settingsForm">
            <input type="hidden" name="returnTo" value={returnTo} />
            <LlmSettingsFields
              hasApiKey={llmSettings.hasApiKey}
              initialBaseUrl={llmSettings.baseUrl}
              initialModel={llmSettings.model}
              initialProvider={llmSettings.provider}
              locale={locale}
              summaryRegenerationCount={summaryRegenerationCount}
              initialSummaryLanguage={llmSettings.summaryLanguage}
              initialSystemLanguage={llmSettings.systemLanguage}
            />
          </form>
        </SettingsTabs>
        <div className="settingsMeta">
          <a href={closeHref}>{copy.settings.cancel}</a>
          <span>
            {llmSettings.updatedAt
              ? `${copy.common.updated} ${formatSettingsDate(llmSettings.updatedAt, locale, copy.common.noDate)}`
              : copy.settings.updatedDefault}
          </span>
          <button form="settingsForm" type="submit">{copy.settings.save}</button>
        </div>
      </section>
    </div>
  );
}
