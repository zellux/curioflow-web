"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteItemAction, unsubscribeSourceAction } from "@/app/actions";
import type { SystemLanguage } from "@/app/i18n";

const COPY = {
  en: {
    cancel: "Cancel",
    cancelDelete: "Cancel delete",
    cancelUnsubscribe: "Cancel unsubscribe",
    delete: "Delete",
    deleteArticle: "Delete article",
    deleteHint: "To keep it but hide it from your library, archive it instead.",
    deletePending: "Deleting...",
    deleteTitle: "Delete this article?",
    deleteMessage: (title: string) =>
      `"${title}" will be permanently removed from your library, along with its highlights and reading progress. This can't be undone.`,
    keepSaved: "Keep already-saved articles",
    keepSavedHelp: (count: number) => `Leave the ${count} saved article${count === 1 ? "" : "s"} in your library, just stop the feed.`,
    unsubscribe: "Unsubscribe",
    unsubscribeFrom: (name: string) => `Unsubscribe from ${name}`,
    unsubscribePending: "Unsubscribing...",
    unsubscribeTitle: (name: string) => `Unsubscribe from ${name}?`,
    unsubscribeMessage: (count: number) =>
      `Curioflow will stop fetching new posts from this feed. You currently have ${count} saved article${count === 1 ? "" : "s"} from it in your library.`
  },
  "zh-Hans": {
    cancel: "取消",
    cancelDelete: "取消删除",
    cancelUnsubscribe: "取消退订",
    delete: "删除",
    deleteArticle: "删除文章",
    deleteHint: "如果只是想从资料库中隐藏它，可以改为归档。",
    deletePending: "正在删除...",
    deleteTitle: "删除这篇文章？",
    deleteMessage: (title: string) => `“${title}” 将从资料库中永久移除，包括高亮和阅读进度。此操作无法撤销。`,
    keepSaved: "保留已经保存的文章",
    keepSavedHelp: (count: number) => `保留资料库中的 ${count} 篇已保存文章，只停止继续抓取这个订阅源。`,
    unsubscribe: "取消订阅",
    unsubscribeFrom: (name: string) => `取消订阅 ${name}`,
    unsubscribePending: "正在取消订阅...",
    unsubscribeTitle: (name: string) => `取消订阅 ${name}？`,
    unsubscribeMessage: (count: number) => `Curioflow 将停止从这个订阅源抓取新文章。当前资料库中有来自它的 ${count} 篇已保存文章。`
  }
} as const;

function PendingSubmitButton({
  children,
  pendingLabel
}: {
  children: ReactNode;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button disabled={pending} type="submit">
      {pending ? pendingLabel : children}
    </button>
  );
}

export function UnsubscribeSourceButton({
  children,
  className,
  itemCount,
  locale = "en",
  sourceId,
  sourceName
}: {
  children: ReactNode;
  className: string;
  itemCount: number;
  locale?: SystemLanguage;
  sourceId: string;
  sourceName: string;
}) {
  const copy = COPY[locale];
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        aria-label={copy.unsubscribeFrom(sourceName)}
        className={className}
        onClick={() => setIsOpen(true)}
        title={copy.unsubscribeFrom(sourceName)}
        type="button"
      >
        {children}
      </button>

      {isOpen ? (
        <div className="confirmDialog open" role="dialog" aria-labelledby="unsubscribe-title" aria-modal="true">
          <button className="addDialogBackdrop" onClick={() => setIsOpen(false)} type="button" aria-label={copy.cancelUnsubscribe} />
          <section className="confirmDialogPanel">
            <h2 id="unsubscribe-title">{copy.unsubscribeTitle(sourceName)}</h2>
            <p>{copy.unsubscribeMessage(itemCount)}</p>
            <form action={unsubscribeSourceAction} className="unsubscribeForm">
              <input type="hidden" name="sourceId" value={sourceId} />
              <label className="keepChoice">
                <input type="checkbox" name="keepItems" defaultChecked />
                <span aria-hidden="true">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <strong>
                  {copy.keepSaved}
                  <small>{copy.keepSavedHelp(itemCount)}</small>
                </strong>
              </label>
              <div>
                <button className="dialogCancelButton" onClick={() => setIsOpen(false)} type="button">{copy.cancel}</button>
                <PendingSubmitButton pendingLabel={copy.unsubscribePending}>{copy.unsubscribe}</PendingSubmitButton>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function DeleteItemButton({
  children,
  className,
  itemId,
  itemTitle,
  locale = "en",
  returnTo,
  title
}: {
  children: ReactNode;
  className: string;
  itemId: string;
  itemTitle: string;
  locale?: SystemLanguage;
  returnTo: string;
  title?: string;
}) {
  const copy = COPY[locale];
  const buttonTitle = title ?? copy.deleteArticle;
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        aria-label={buttonTitle}
        className={className}
        onClick={() => setIsOpen(true)}
        title={buttonTitle}
        type="button"
      >
        {children}
      </button>

      {isOpen ? (
        <div className="confirmDialog open" role="dialog" aria-labelledby="delete-item-title" aria-modal="true">
          <button className="addDialogBackdrop" onClick={() => setIsOpen(false)} type="button" aria-label={copy.cancelDelete} />
          <section className="confirmDialogPanel deleteDialogPanel">
            <h2 id="delete-item-title">{copy.deleteTitle}</h2>
            <p>{copy.deleteMessage(itemTitle)}</p>
            <p className="deleteDialogHint">{copy.deleteHint}</p>
            <form action={deleteItemAction} className="deleteItemForm">
              <input type="hidden" name="itemId" value={itemId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div>
                <button className="dialogCancelButton" onClick={() => setIsOpen(false)} type="button">{copy.cancel}</button>
                <PendingSubmitButton pendingLabel={copy.deletePending}>{copy.delete}</PendingSubmitButton>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
