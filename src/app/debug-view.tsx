import Link from "next/link";
import { BackgroundTaskSettings } from "@/app/background-task-settings";
import { ConnectionSettingsPanel } from "@/app/connection-settings";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import type { ConnectionSettings } from "@/server/connections";

export function DebugView({ connections, locale, tab, status }: {
  connections: ConnectionSettings; locale: SystemLanguage; tab?: string; status?: string;
}) {
  const copy = getUiCopy(locale);
  const connectionCopy = {
    connectionConfigured: copy.settings.connectionConfigured,
    connectionDetails: copy.settings.connectionDetails,
    connectionNeedsAttention: copy.settings.connectionNeedsAttention,
    connectionNotConfigured: copy.settings.connectionNotConfigured,
    connections: copy.settings.connections,
    connectionsIntro: copy.settings.connectionsIntro,
    connectionTest: copy.settings.connectionTest,
    connectionTestFailed: copy.settings.connectionTestFailed,
    connectionTesting: copy.settings.connectionTesting,
    connectionTestSucceeded: copy.settings.connectionTestSucceeded,
  };
  const activeTab = tab === "connections" ? "connections" : "tasks";
  const filter = status === "failed" || status === "queued" || status === "running" || status === "succeeded" ? status : "all";
  return (
    <div className="debugView">
      <h1>Debug</h1>
      <p className="settingsIntro">{locale === "zh-Hans" ? "检查后台任务、处理失败和服务连接。" : "Inspect background tasks, processing failures, and service connections."}</p>
      <nav className="debugNavigation" aria-label="Debug">
        <Link href="/debug?tab=tasks" aria-current={activeTab === "tasks" ? "page" : undefined}>{locale === "zh-Hans" ? "后台任务" : "Background tasks"}</Link>
        <Link href="/debug?tab=connections" aria-current={activeTab === "connections" ? "page" : undefined}>{copy.settings.connections}</Link>
      </nav>
      {activeTab === "connections" ? <ConnectionSettingsPanel connections={connections} copy={connectionCopy} />
        : <BackgroundTaskSettings key={filter} active locale={locale} initialFilter={filter} />}
    </div>
  );
}
