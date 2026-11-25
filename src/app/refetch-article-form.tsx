"use client";

import { useFormStatus } from "react-dom";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";

type RefetchArticleFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  itemId: string;
  locale?: SystemLanguage;
  returnTo: string;
  variant?: "icon" | "readerRetry" | "feedRetry" | "menu";
};

function RefreshIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function RefetchButton({ locale = "en", variant = "icon" }: { locale?: SystemLanguage; variant?: RefetchArticleFormProps["variant"] }) {
  const { pending } = useFormStatus();
  const copy = getUiCopy(locale);
  const isTextButton = variant !== "icon";
  const isMenu = variant === "menu";
  const label = pending
    ? copy.refetch.fetching
    : variant === "feedRetry"
      ? copy.common.retry
      : variant === "readerRetry"
        ? copy.common.retryFetch
        : isMenu ? copy.refetch.aria : "";

  return (
    <button
      aria-label={pending ? copy.refetch.pendingAria : copy.refetch.aria}
      className={isMenu
        ? `readerMoreItem${pending ? " isPending" : ""}`
        : `refreshButton ${variant !== "icon" ? `refreshButton--${variant}` : ""} ${pending ? "isPending" : ""}`}
      disabled={pending}
      role={isMenu ? "menuitem" : undefined}
      title={pending ? copy.refetch.pendingTitle : copy.refetch.title}
      type="submit"
    >
      <RefreshIcon size={isMenu ? 15 : 14} />
      {isTextButton ? <span>{label}</span> : null}
    </button>
  );
}

export function RefetchArticleForm({ action, itemId, locale = "en", returnTo, variant = "icon" }: RefetchArticleFormProps) {
  return (
    <form action={action} className={variant === "menu" ? "readerMoreForm" : variant === "icon" ? undefined : "refetchForm"}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <RefetchButton locale={locale} variant={variant} />
    </form>
  );
}
