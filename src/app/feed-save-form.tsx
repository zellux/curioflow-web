"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toggleItemSavedAction } from "@/app/actions";
import type { SystemLanguage } from "@/app/i18n";

const COPY = {
  en: {
    save: "Save",
    saving: "Saving...",
    saveToLibrary: "Save to library"
  },
  "zh-Hans": {
    save: "保存",
    saving: "保存中...",
    saveToLibrary: "保存到资料库"
  }
} as const;

function BookmarkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M6 4h12v17l-6-4-6 4Z" />
    </svg>
  );
}

function SaveSubmitButton({ isSaving, locale }: { isSaving: boolean; locale: SystemLanguage }) {
  const { pending } = useFormStatus();
  const copy = COPY[locale];
  const busy = pending || isSaving;

  return (
    <button
      aria-busy={busy}
      className="feedItemActionButton feedItemSaveButton"
      disabled={busy}
      type="submit"
      title={busy ? copy.saving : copy.saveToLibrary}
      aria-label={copy.saveToLibrary}
    >
      <BookmarkIcon />
      {busy ? copy.saving : copy.save}
    </button>
  );
}

export function FeedSaveForm({ itemId, locale }: { itemId: string; locale: SystemLanguage }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      action={toggleItemSavedAction}
      className="feedItemSaveForm"
      ref={formRef}
      onSubmit={() => {
        setIsSaving(true);
        formRef.current?.closest(".feedItem")?.classList.add("isSavingToLibrary");
      }}
    >
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="savedToLibrary" value="true" />
      <SaveSubmitButton isSaving={isSaving} locale={locale} />
    </form>
  );
}
