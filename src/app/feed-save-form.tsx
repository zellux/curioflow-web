"use client";
import { toggleItemSavedAction } from "@/app/actions";
import { ItemActionForm } from "@/app/item-action-form";
import type { SystemLanguage } from "@/app/i18n";

export function FeedSaveForm({ itemId, locale }: { itemId: string; locale: SystemLanguage }) {
  const zh = locale === "zh-Hans";
  return <ItemActionForm action={toggleItemSavedAction} undoAction={toggleItemSavedAction}
    values={{ itemId, savedToLibrary: "true" }} undoValues={{ itemId, savedToLibrary: "false" }}
    locale={locale} message={zh ? "已保存到资料库" : "Saved to library"} label={zh ? "保存到资料库" : "Save to library"}
    className="feedItemActionButton feedItemSaveButton">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4Z" /></svg>
    {zh ? "保存" : "Save"}
  </ItemActionForm>;
}
