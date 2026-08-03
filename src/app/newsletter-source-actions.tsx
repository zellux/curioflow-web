"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";

export function NewsletterSourceActions({ locale, name, sourceId }: {
  locale: SystemLanguage;
  name: string;
  sourceId: string;
}) {
  const copy = getUiCopy(locale).newsletters;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nextName, setNextName] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(body: { name: string }) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/sources/${encodeURIComponent(sourceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? copy.updateError);
      setEditing(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.updateError);
    } finally {
      setPending(false);
    }
  }

  if (editing) {
    return (
      <div className="newsletterSourceEditor">
        <input aria-label={copy.rename} maxLength={120} onChange={(event) => setNextName(event.target.value)} value={nextName} />
        <button disabled={pending || !nextName.trim()} onClick={() => update({ name: nextName })} type="button">{copy.saveName}</button>
        <button disabled={pending} onClick={() => setEditing(false)} type="button">{copy.cancel}</button>
        {error ? <small>{error}</small> : null}
      </div>
    );
  }

  return (
    <div className="newsletterSourceActions">
      <button disabled={pending} onClick={() => setEditing(true)} type="button">{copy.rename}</button>
      {error ? <small>{error}</small> : null}
    </div>
  );
}
