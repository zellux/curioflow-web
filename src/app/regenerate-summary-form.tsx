"use client";

import { useFormStatus } from "react-dom";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";

type RegenerateSummaryFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  itemId: string;
  locale?: SystemLanguage;
  returnTo: string;
};

function RegenerateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function RegenerateButton({ locale = "en" }: { locale?: SystemLanguage }) {
  const { pending } = useFormStatus();
  const copy = getUiCopy(locale);

  return (
    <button
      aria-label={pending ? copy.item.summaryRegenerating : copy.item.regenerateSummary}
      className={`summaryRegenerateButton ${pending ? "isPending" : ""}`}
      disabled={pending}
      type="submit"
    >
      <RegenerateIcon />
      <span>{pending ? copy.item.summaryRegenerating : copy.item.regenerate}</span>
    </button>
  );
}

export function RegenerateSummaryForm({ action, itemId, locale = "en", returnTo }: RegenerateSummaryFormProps) {
  return (
    <form action={action} className="summaryRegenerateForm">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <RegenerateButton locale={locale} />
    </form>
  );
}
