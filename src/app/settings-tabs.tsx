"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export type SettingsTab = "style" | "language" | "model" | "connections" | "account";
type SettingsTabLabels = {
  account: string;
  connections: string;
  language: string;
  languageModel: string;
  readingStyle: string;
  title: string;
};

function GlobeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9" />
    </svg>
  );
}

function ChipIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M9 3v5M15 3v5M6 8h12l-1 4a5 5 0 0 1-10 0Z" />
      <path d="M12 16v3M9 21h6" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function SettingsTabs({
  children,
  connectionNeedsAttention,
  initialTab = "style",
  labels
}: {
  children: ReactNode;
  connectionNeedsAttention?: boolean;
  initialTab?: SettingsTab;
  labels: SettingsTabLabels;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const tabs: Array<{ icon: React.ReactNode; key: SettingsTab; label: string }> = [
    { icon: <span className="settingsTabAa" aria-hidden="true">Aa</span>, key: "style", label: labels.readingStyle },
    { icon: <GlobeIcon />, key: "language", label: labels.language },
    { icon: <ChipIcon />, key: "model", label: labels.languageModel },
    { icon: <PlugIcon />, key: "connections", label: labels.connections },
    { icon: <AccountIcon />, key: "account", label: labels.account }
  ];

  return (
    <div className="settingsTabsShell" data-active-tab={activeTab}>
      <div className="settingsTabsMain">
        <nav className="settingsTabRail" aria-label={labels.title}>
          {tabs.map((tab) => (
            <button
              aria-pressed={activeTab === tab.key}
              className="settingsTabButton"
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.key === "connections" && connectionNeedsAttention ? <i className="settingsTabDot" /> : null}
            </button>
          ))}
        </nav>
        <div className="settingsTabContent">
          {children}
        </div>
      </div>
    </div>
  );
}
