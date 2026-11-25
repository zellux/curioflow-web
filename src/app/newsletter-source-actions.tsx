"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function SourceRenameHeading({ locale, name, sourceId }: {
  locale: SystemLanguage;
  name: string;
  sourceId: string;
}) {
  const copy = getUiCopy(locale).newsletters;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [nextName, setNextName] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editing]);

  function startEditing() {
    setNextName(name);
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setNextName(name);
    setError(null);
  }

  async function saveName() {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    if (trimmed === name.trim()) {
      setEditing(false);
      setError(null);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/sources/${encodeURIComponent(sourceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed })
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
      <form
        className="sourceHeadingEditor"
        onSubmit={(event) => {
          event.preventDefault();
          void saveName();
        }}
      >
        <input
          aria-label={copy.rename}
          disabled={pending}
          maxLength={120}
          onChange={(event) => setNextName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEditing();
            }
          }}
          ref={inputRef}
          value={nextName}
        />
        <div className="sourceHeadingEditorActions">
          <button className="sourceHeadingSaveButton" disabled={pending || !nextName.trim()} type="submit">
            {copy.saveName}
          </button>
          <button className="sourceHeadingCancelButton" disabled={pending} onClick={cancelEditing} type="button">
            {copy.cancel}
          </button>
        </div>
        {error ? <small role="alert">{error}</small> : null}
      </form>
    );
  }

  return (
    <div className="sourceHeadingRename">
      <h1>{name}</h1>
      <button
        aria-label={copy.rename}
        className="sourceHeadingRenameButton"
        disabled={pending}
        onClick={startEditing}
        title={copy.rename}
        type="button"
      >
        <PencilIcon />
      </button>
    </div>
  );
}
