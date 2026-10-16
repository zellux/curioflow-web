"use client";

import { useSearchParams } from "next/navigation";
import type { MouseEvent } from "react";
import { BackgroundTaskSettings } from "@/app/background-task-settings";
import { ConnectionSettingsPanel } from "@/app/connection-settings";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import type { ConnectionSettings } from "@/server/connections";

export function DebugView({ connections, locale }: {
  connections: ConnectionSettings; locale: SystemLanguage;
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
  const activeTab = searchParams.get("tab") === "connections" ? "connections" : "tasks";

  function changeTab(event: MouseEvent<HTMLAnchorElement>, nextTab: "tasks" | "connections") {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (nextTab === activeTab) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function tabHref(nextTab: "tasks" | "connections") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    return `/debug?${params}`;
  }
  return (
    <div className="debugView">
      <h1>Debug</h1>
      <p className="settingsIntro">{locale === "zh-Hans" ? "检查后台任务、处理失败和服务连接。" : "Inspect background tasks, processing failures, and service connections."}</p>
      <nav className="debugNavigation" aria-label="Debug">
        <a href={tabHref("tasks")} aria-current={activeTab === "tasks" ? "page" : undefined} aria-controls="debug-tasks-panel" onClick={event => changeTab(event, "tasks")}>{locale === "zh-Hans" ? "后台任务" : "Background tasks"}</a>
        <a href={tabHref("connections")} aria-current={activeTab === "connections" ? "page" : undefined} aria-controls="debug-connections-panel" onClick={event => changeTab(event, "connections")}>{copy.settings.connections}</a>
      </nav>
      <div className="debugTabPanel" id="debug-tasks-panel" hidden={activeTab !== "tasks"}>
        <BackgroundTaskSettings active={activeTab === "tasks"} locale={locale} />
      </div>
      <div className="debugTabPanel" id="debug-connections-panel" hidden={activeTab !== "connections"}>
        <ConnectionSettingsPanel connections={connections} copy={connectionCopy} />
      </div>
    </div>
  );
}
