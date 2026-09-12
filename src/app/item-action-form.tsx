"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { SystemLanguage } from "@/app/i18n";

export const ITEM_NOTICE_EVENT = "curioflow:item-notice";
export type ItemNotice = { message: string; undo?: () => Promise<void>; locale: SystemLanguage };

function ActionButton({ children, label, className }: { children: ReactNode; label: string; className: string }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending} aria-busy={pending} aria-label={label} title={label} type="submit">{children}</button>;
}

export function ItemActionForm({ action, undoAction, values, undoValues, message, label, locale, children, className, nextHref }: {
  action: (data: FormData) => Promise<void>;
  undoAction?: (data: FormData) => Promise<void>;
  values: Record<string, string>;
  undoValues?: Record<string, string>;
  message: string;
  label: string;
  locale: SystemLanguage;
  children: ReactNode;
  className: string;
  nextHref?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState(false);
  const formData = (data: Record<string, string>) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(data)) form.set(key, value);
    return form;
  };
  return <form action={async () => {
    setError(false);
    try {
      await action(formData(values));
      window.dispatchEvent(new CustomEvent<ItemNotice>(ITEM_NOTICE_EVENT, { detail: {
        message, locale,
        undo: undoAction ? async () => { await undoAction(formData(undoValues ?? values)); router.refresh(); } : undefined
      } }));
      if (nextHref) router.push(nextHref as Route);
    } catch { setError(true); }
  }}>
    <ActionButton className={className} label={label}>{children}</ActionButton>
    {error ? <span role="alert">{locale === "zh-Hans" ? "操作失败，请重试" : "Could not update. Try again."}</span> : null}
  </form>;
}
