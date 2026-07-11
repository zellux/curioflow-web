import { updateLlmSettingsAction } from "@/app/actions";
import { ConnectionSettingsPanel, type ConnectionSettingsCopy } from "@/app/connection-settings";
import { LlmSettingsFields } from "@/app/llm-settings-fields";
import { ReadingStyleSettings, type ReadingStyleInitialState } from "@/app/reading-style-settings";
import { SettingsTabs } from "@/app/settings-tabs";
import type { SystemLanguage, UiCopy } from "@/app/i18n";
import type { ConnectionSettings } from "@/server/connections";

type LlmSettings = {
  baseUrl: string;
  hasApiKey: boolean;
  model: string;
  askModel: string;
  provider: string;
  summaryConcurrency: number;
  summaryLanguage: string;
  systemLanguage: string;
  updatedAt: Date | string | null;
};

type SettingsDialogProps = {
  closeHref: string;
  connections: ConnectionSettings;
  copy: UiCopy;
  isOpen: boolean;
  llmSettings: LlmSettings;
  locale: SystemLanguage;
  readingStyle: ReadingStyleInitialState;
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
  connections,
  copy,
  locale,
  llmSettings,
  readingStyle,
  isOpen,
  returnTo,
  saved,
  summaryRegenerationCount
}: SettingsDialogProps) {
  if (!isOpen) return null;
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

  return (
    <div className="settingsDialog open" role="dialog" aria-labelledby="settings-title" aria-modal="true">
      <a className="settingsDialogBackdrop" href={closeHref} aria-label={copy.settings.close} />
      <section className="settingsDialogPanel">
        <header>
          <h1 id="settings-title">{copy.settings.title}</h1>
          <a href={closeHref} aria-label={copy.settings.close}><CloseIcon /></a>
        </header>
        <SettingsTabs connectionNeedsAttention={!connections.twitter.configured || !connections.influx.configured} labels={{
          connections: copy.settings.connections,
          language: copy.settings.language,
          languageModel: copy.settings.languageModel,
          readingStyle: copy.settings.readingStyle,
          title: copy.settings.title
        }}>
          <section className="settingsSection settingsPanelPane settingsPanelPane--style">
            <h2 className="settingsPaneTitle">{copy.settings.readingStyle}</h2>
            <p className="settingsIntro">{copy.settings.readingStyleIntro}</p>
            <ReadingStyleSettings initialStyle={readingStyle} locale={locale} />
          </section>
          {saved === "llm" ? <p className="settingsSaved">{copy.settings.llmSaved}</p> : null}
          <form action={updateLlmSettingsAction} className="settingsForm settingsTabbedForm" id="settingsForm">
            <input type="hidden" name="returnTo" value={returnTo} />
            <LlmSettingsFields
              hasApiKey={llmSettings.hasApiKey}
              initialBaseUrl={llmSettings.baseUrl}
              initialModel={llmSettings.model}
              initialAskModel={llmSettings.askModel}
              initialProvider={llmSettings.provider}
              locale={locale}
              summaryRegenerationCount={summaryRegenerationCount}
              initialSummaryConcurrency={llmSettings.summaryConcurrency}
              initialSummaryLanguage={llmSettings.summaryLanguage}
              initialSystemLanguage={llmSettings.systemLanguage}
            />
          </form>
          <ConnectionSettingsPanel connections={connections} copy={connectionCopy} />
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
