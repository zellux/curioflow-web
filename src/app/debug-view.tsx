"use client";

import { useSearchParams } from "next/navigation";
import type { MouseEvent } from "react";
import { BackgroundTaskSettings } from "@/app/background-task-settings";
import { ConnectionSettingsPanel } from "@/app/connection-settings";
import { SummaryRegenerationPanel } from "@/app/summary-regeneration-panel";
import { getUiCopy, pickLocale, type SystemLanguage } from "@/app/i18n";
import type { ConnectionSettings } from "@/server/connections";

type DebugTab = "tasks" | "connections" | "summaries";

export function DebugView({ connections, llmEnabled, locale }: {
  connections: ConnectionSettings; llmEnabled: boolean; locale: SystemLanguage;
}) {
  const searchParams = useSearchParams();
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
  const tabParam = searchParams.get("tab");
  const activeTab: DebugTab = tabParam === "connections" || tabParam === "summaries" ? tabParam : "tasks";

  function changeTab(event: MouseEvent<HTMLAnchorElement>, nextTab: DebugTab) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (nextTab === activeTab) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function tabHref(nextTab: DebugTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    return `/debug?${params}`;
  }
  return (
    <div className="debugView">
      <h1>Debug</h1>
      <p className="settingsIntro">
        {pickLocale(locale, {
          en: "Inspect background tasks, processing failures, service connections, and summary regeneration.",
          "zh-Hans": "检查后台任务、处理失败、服务连接和摘要重新生成。",
          "zh-Hant": "檢查背景任務、處理失敗、服務連線與摘要重新產生。",
          ja: "バックグラウンドタスク、処理エラー、サービス接続、要約の再生成を確認します。",
          ko: "백그라운드 작업, 처리 실패, 서비스 연결 및 요약 재생성을 확인합니다."
        })}
      </p>
      <nav className="debugNavigation" aria-label="Debug">
        <a href={tabHref("tasks")} aria-current={activeTab === "tasks" ? "page" : undefined} aria-controls="debug-tasks-panel" onClick={event => changeTab(event, "tasks")}>
          {pickLocale(locale, {
            en: "Background tasks",
            "zh-Hans": "后台任务",
            "zh-Hant": "背景任務",
            ja: "バックグラウンドタスク",
            ko: "백그라운드 작업"
          })}
        </a>
        <a href={tabHref("connections")} aria-current={activeTab === "connections" ? "page" : undefined} aria-controls="debug-connections-panel" onClick={event => changeTab(event, "connections")}>{copy.settings.connections}</a>
        <a href={tabHref("summaries")} aria-current={activeTab === "summaries" ? "page" : undefined} aria-controls="debug-summaries-panel" onClick={event => changeTab(event, "summaries")}>{copy.settings.regenerateSummariesTitle}</a>
      </nav>
      <div className="debugTabPanel" id="debug-tasks-panel" hidden={activeTab !== "tasks"}>
        <BackgroundTaskSettings active={activeTab === "tasks"} locale={locale} />
      </div>
      <div className="debugTabPanel" id="debug-connections-panel" hidden={activeTab !== "connections"}>
        <ConnectionSettingsPanel connections={connections} copy={connectionCopy} />
      </div>
      <div className="debugTabPanel" id="debug-summaries-panel" hidden={activeTab !== "summaries"}>
        <SummaryRegenerationPanel active={activeTab === "summaries"} llmEnabled={llmEnabled} locale={locale} />
      </div>
    </div>
  );
}
