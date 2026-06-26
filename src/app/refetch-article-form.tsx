"use client";

import { useFormStatus } from "react-dom";

type RefetchArticleFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  itemId: string;
  returnTo: string;
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

function RefetchButton() {
  const { pending } = useFormStatus();

  return (
    <button
      aria-label={pending ? "Refetching and parsing article content" : "Refetch and parse article content"}
      className={`refreshButton ${pending ? "isPending" : ""}`}
      disabled={pending}
      title={pending ? "Refetching and parsing..." : "Refetch and parse article content"}
      type="submit"
    >
      <RefreshIcon />
    </button>
  );
}

export function RefetchArticleForm({ action, itemId, returnTo }: RefetchArticleFormProps) {
  return (
    <form action={action}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <RefetchButton />
    </form>
  );
}
