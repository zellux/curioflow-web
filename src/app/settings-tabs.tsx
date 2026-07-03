"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { UiCopy } from "@/app/i18n";

type SettingsTab = "style" | "language" | "model";

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

export function SettingsTabs({ children, copy }: { children: ReactNode; copy: UiCopy }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("style");
  const tabs: Array<{ icon: React.ReactNode; key: SettingsTab; label: string }> = [
    { icon: <span className="settingsTabAa" aria-hidden="true">Aa</span>, key: "style", label: copy.settings.readingStyle },
    { icon: <GlobeIcon />, key: "language", label: copy.settings.language },
    { icon: <ChipIcon />, key: "model", label: copy.settings.languageModel }
  ];

  return (
    <div className="settingsTabsShell" data-active-tab={activeTab}>
      <div className="settingsTabsMain">
        <nav className="settingsTabRail" aria-label={copy.settings.title}>
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
