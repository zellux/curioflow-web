"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { pickLocale, type SystemLanguage } from "@/app/i18n";
import { useNavigationState } from "@/app/navigation-state";

export const ITEM_NOTICE_EVENT = "curioflow:item-notice";
export type ItemNotice = { message: string; undo?: () => Promise<void>; locale: SystemLanguage };

function ActionButton({
  children,
  pendingChildren,
  label,
  className,
  pressed,
  navigating
}: {
  children: ReactNode;
  pendingChildren?: ReactNode;
  label: string;
  className: string;
  pressed?: boolean;
  navigating: boolean;
}) {
  const { pending } = useFormStatus();
  const isBusy = pending || navigating;
  return (
    <button
      className={className}
      data-pending={isBusy ? "true" : undefined}
      disabled={isBusy}
      aria-busy={isBusy}
      aria-label={label}
      aria-pressed={pressed}
      role={className.includes("readerMoreItem") ? "menuitem" : undefined}
      title={label}
      type="submit"
    >
      {isBusy && pendingChildren ? pendingChildren : children}
    </button>
  );
}

export function ItemActionForm({
  action,
  undoAction,
  values,
  undoValues,
  message,
  label,
  locale,
  children,
  pendingChildren,
  className,
  nextHref,
  pressed
}: {
  action: (data: FormData) => Promise<void>;
  undoAction?: (data: FormData) => Promise<void>;
  values: Record<string, string>;
  undoValues?: Record<string, string>;
  message: string;
  label: string;
  locale: SystemLanguage;
  children: ReactNode;
  pendingChildren?: ReactNode;
  className: string;
  nextHref?: string;
  pressed?: boolean;
}) {
  const router = useRouter();
  const { navigate, pending: navPending } = useNavigationState();
  const [error, setError] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const observedNavPendingRef = useRef(false);

  useEffect(() => {
    if (!navigating) {
      observedNavPendingRef.current = false;
      return;
    }
    if (navPending) {
      observedNavPendingRef.current = true;
      return;
    }
    if (observedNavPendingRef.current) {
      setNavigating(false);
      observedNavPendingRef.current = false;
    }
  }, [navigating, navPending]);

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
      if (nextHref) {
        setNavigating(true);
        navigate(nextHref);
      }
    } catch {
      setNavigating(false);
      setError(true);
    }
  }}>
    <ActionButton className={className} label={label} navigating={navigating} pendingChildren={pendingChildren} pressed={pressed}>{children}</ActionButton>
    {error ? <span role="alert">{pickLocale(locale, {
      en: "Could not update. Try again.",
      "zh-Hans": "操作失败，请重试",
      "zh-Hant": "操作失敗，請重試",
      ja: "更新できませんでした。もう一度お試しください。",
      ko: "업데이트할 수 없습니다. 다시 시도해 주세요."
    })}</span> : null}
  </form>;
}
