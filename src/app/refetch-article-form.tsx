"use client";

import { useFormStatus } from "react-dom";

type RefetchArticleFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  itemId: string;
  returnTo: string;
  variant?: "icon" | "readerRetry" | "feedRetry";
};

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function RefetchButton({ variant = "icon" }: { variant?: RefetchArticleFormProps["variant"] }) {
  const { pending } = useFormStatus();
  const isTextButton = variant !== "icon";
  const label = pending
    ? variant === "feedRetry"
      ? "Fetching..."
      : "Fetching..."
    : variant === "feedRetry"
      ? "Retry"
      : variant === "readerRetry"
        ? "Retry fetch"
        : "";

  return (
    <button
      aria-label={pending ? "Refetching and parsing article content" : "Refetch and parse article content"}
      className={`refreshButton ${variant !== "icon" ? `refreshButton--${variant}` : ""} ${pending ? "isPending" : ""}`}
      disabled={pending}
      title={pending ? "Refetching and parsing..." : "Refetch and parse article content"}
      type="submit"
    >
      <RefreshIcon />
      {isTextButton ? <span>{label}</span> : null}
    </button>
  );
}

export function RefetchArticleForm({ action, itemId, returnTo, variant = "icon" }: RefetchArticleFormProps) {
  return (
    <form action={action} className={variant === "icon" ? undefined : "refetchForm"}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <RefetchButton variant={variant} />
    </form>
  );
}
