"use client";

import { useEffect, useState } from "react";
import { copyText } from "@/app/copy-text";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";

type InboxState = {
  address: string | null;
  enabled: boolean;
};

export function NewsletterAddressPanel({ locale }: { locale: SystemLanguage }) {
  const copy = getUiCopy(locale).newsletters;
  const [state, setState] = useState<InboxState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/newsletters/address")
      .then(async (response) => {
        const body = await response.json() as InboxState & { error?: string };
        if (!response.ok) throw new Error(body.error ?? copy.loadError);
        if (active) setState(body);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : copy.loadError);
      });
    return () => { active = false; };
  }, [copy.loadError]);

  async function createAddress() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/newsletters/address", { method: "POST" });
      const body = await response.json() as InboxState & { error?: string };
      if (!response.ok) throw new Error(body.error ?? copy.createError);
      setState(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.createError);
    } finally {
      setPending(false);
    }
  }

  async function copyAddress() {
    if (!state?.address) return;
    try {
      await copyText(state.address);
      setError(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(copy.copyError);
    }
  }

  if (!state && !error) return <div className="newsletterAddressPanel"><p>{copy.loading}</p></div>;
  if (state && !state.enabled) {
    return <div className="newsletterAddressPanel"><strong>{copy.unavailableTitle}</strong><p>{copy.unavailableBody}</p></div>;
  }

  return (
    <div className="newsletterAddressPanel">
      <strong>{copy.title}</strong>
      <p>{copy.description}</p>
      {state?.address ? (
        <div className="newsletterAddressValue">
          <code>{state.address}</code>
          <button onClick={copyAddress} type="button">{copied ? copy.copied : copy.copy}</button>
        </div>
      ) : (
        <button className="newsletterCreateButton" disabled={pending} onClick={createAddress} type="button">
          {pending ? copy.creating : copy.create}
        </button>
      )}
      {error ? <div className="sourceError">{error}</div> : null}
    </div>
  );
}
