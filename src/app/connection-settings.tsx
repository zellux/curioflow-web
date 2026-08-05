"use client";

import { useState } from "react";
import type { ConnectionKey, ConnectionServiceSettings, ConnectionSettings } from "@/server/connections";

export type ConnectionSettingsCopy = {
  connectionConfigured: string;
  connectionNeedsAttention: string;
  connectionNotConfigured: string;
  connections: string;
  connectionsIntro: string;
  connectionTest: string;
  connectionTestFailed: string;
  connectionTesting: string;
  connectionTestSucceeded: string;
};

type TestState =
  | { status: "idle"; message: string | null }
  | { status: "testing"; message: string | null }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 9v4M12 17h.01M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 4h16v12H9l-5 4V4Z" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  );
}

function InfluxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <ellipse cx="12" cy="5.5" rx="8" ry="2.7" />
      <path d="M4 5.5v6.2c0 1.5 3.58 2.7 8 2.7s8-1.2 8-2.7V5.5" />
      <path d="M4 11.7v6.2c0 1.5 3.58 2.7 8 2.7s8-1.2 8-2.7v-6.2" />
    </svg>
  );
}

function NewsletterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M3 6h18v12H3z" />
      <path d="m3 7 9 7 9-7" />
    </svg>
  );
}

function ConnectionCard({
  copy,
  service,
  state,
  test
}: {
  copy: ConnectionSettingsCopy;
  service: ConnectionServiceSettings;
  state: TestState;
  test: (key: ConnectionKey) => void;
}) {
  const isTesting = state.status === "testing";
  const isOk = state.status === "success";
  const isError = state.status === "error";
  const badgeClass = service.configured ? "isConfigured" : service.enabled ? "needsAttention" : "notConfigured";
  const badgeLabel = service.configured
    ? copy.connectionConfigured
    : service.enabled
      ? copy.connectionNeedsAttention
      : copy.connectionNotConfigured;

  return (
    <div className="connectionCard">
      <div className="connectionCardHeader">
        <div className="connectionIcon">
          {service.key === "twitter" ? <TwitterIcon /> : service.key === "newsletter" ? <NewsletterIcon /> : <InfluxIcon />}
        </div>
        <div>
          <h3>{service.title}</h3>
          <p>{service.description}</p>
        </div>
        <span className={`connectionBadge ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>

      <div className="connectionVars">
        {service.rows.map((row) => (
          <div className="connectionVar" key={row.name}>
            <i className={row.configured ? "isConfigured" : service.enabled ? "needsAttention" : "notConfigured"} />
            <span>{row.name}</span>
            <code className={row.configured ? "" : service.enabled ? "needsAttention" : "notConfigured"}>{row.value}</code>
          </div>
        ))}
      </div>

      <div className={`connectionTest ${isOk ? "isSuccess" : isError ? "isError" : ""}`}>
        <button disabled={isTesting} onClick={() => test(service.key)} type="button">
          {isTesting ? <span className="connectionSpinner" /> : <RefreshIcon />}
          {isTesting ? copy.connectionTesting : copy.connectionTest}
        </button>
        {state.message ? (
          <p>
            {isOk ? <CheckIcon /> : isError ? <WarningIcon /> : null}
            <span>{state.message}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ConnectionSettingsPanel({ connections, copy }: { connections: ConnectionSettings; copy: ConnectionSettingsCopy }) {
  const [states, setStates] = useState<Record<ConnectionKey, TestState>>({
    twitter: { status: "idle", message: null },
    influx: { status: "idle", message: null },
    newsletter: { status: "idle", message: null }
  });

  async function test(key: ConnectionKey) {
    setStates((current) => ({ ...current, [key]: { status: "testing", message: null } }));

    try {
      const response = await fetch("/api/settings/connections/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key })
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;

      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || body?.error || copy.connectionTestFailed);
      }

      setStates((current) => ({
        ...current,
        [key]: { status: "success", message: body.message || copy.connectionTestSucceeded }
      }));
    } catch (error) {
      setStates((current) => ({
        ...current,
        [key]: {
          status: "error",
          message: error instanceof Error ? error.message : copy.connectionTestFailed
        }
      }));
    }
  }

  return (
    <section className="settingsSection settingsPanelPane settingsPanelPane--connections">
      <h2 className="settingsPaneTitle">{copy.connections}</h2>
      <p className="settingsIntro">{copy.connectionsIntro}</p>
      <div className="connectionStack">
        <ConnectionCard copy={copy} service={connections.newsletter} state={states.newsletter} test={test} />
        <ConnectionCard copy={copy} service={connections.twitter} state={states.twitter} test={test} />
        <ConnectionCard copy={copy} service={connections.influx} state={states.influx} test={test} />
      </div>
    </section>
  );
}
