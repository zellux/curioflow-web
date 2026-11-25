"use client";
import { toggleItemSavedAction } from "@/app/actions";
import { ItemActionForm } from "@/app/item-action-form";
import { pickLocale, type SystemLanguage } from "@/app/i18n";

export function FeedSaveForm({ itemId, locale }: { itemId: string; locale: SystemLanguage }) {
  const copy = pickLocale(locale, {
    en: { message: "Saved to library", label: "Save to library", save: "Save" },
    "zh-Hans": { message: "已保存到资料库", label: "保存到资料库", save: "保存" },
    "zh-Hant": { message: "已儲存到資料庫", label: "儲存到資料庫", save: "儲存" },
    ja: { message: "ライブラリに保存しました", label: "ライブラリに保存", save: "保存" },
    ko: { message: "라이브러리에 저장됨", label: "라이브러리에 저장", save: "저장" }
  });
  return <ItemActionForm action={toggleItemSavedAction} undoAction={toggleItemSavedAction}
    values={{ itemId, savedToLibrary: "true" }} undoValues={{ itemId, savedToLibrary: "false" }}
    locale={locale} message={copy.message} label={copy.label}
    className="feedItemActionButton feedItemSaveButton">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4Z" /></svg>
    {copy.save}
  </ItemActionForm>;
}
