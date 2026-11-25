"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { deleteChatThreadAction, deleteItemAction, unsubscribeSourceAction } from "@/app/actions";
import { pickLocale, type SystemLanguage } from "@/app/i18n";

type ConfirmDialogCopy = {
  cancel: string;
  cancelDelete: string;
  cancelUnsubscribe: string;
  delete: string;
  deleteArticle: string;
  deleteChat: string;
  deleteChatMessage: (title: string) => string;
  deleteChatTitle: string;
  deleteHint: string;
  deletePending: string;
  deleteTitle: string;
  deleteMessage: (title: string) => string;
  keepSaved: string;
  keepSavedHelp: (count: number) => string;
  unsubscribe: string;
  unsubscribeFrom: (name: string) => string;
  unsubscribePending: string;
  unsubscribeTitle: (name: string) => string;
  unsubscribeMessage: (count: number) => string;
};

const COPY: Record<SystemLanguage, ConfirmDialogCopy> = {
  en: {
    cancel: "Cancel",
    cancelDelete: "Cancel delete",
    cancelUnsubscribe: "Cancel unsubscribe",
    delete: "Delete",
    deleteArticle: "Delete article",
    deleteChat: "Delete chat",
    deleteChatMessage: (title: string) => `“${title}” and its full conversation history will be permanently deleted. This can't be undone.`,
    deleteChatTitle: "Delete this chat?",
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
    deleteChat: "删除对话",
    deleteChatMessage: (title: string) => `“${title}” 及其全部对话记录将被永久删除。此操作无法撤销。`,
    deleteChatTitle: "删除这个对话？",
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
  },
  "zh-Hant": {
    cancel: "取消",
    cancelDelete: "取消刪除",
    cancelUnsubscribe: "取消退訂",
    delete: "刪除",
    deleteArticle: "刪除文章",
    deleteChat: "刪除對話",
    deleteChatMessage: (title: string) => `「${title}」及其全部對話紀錄將被永久刪除。此操作無法復原。`,
    deleteChatTitle: "刪除這個對話？",
    deleteHint: "如果只是想從資料庫中隱藏它，可以改為封存。",
    deletePending: "正在刪除...",
    deleteTitle: "刪除這篇文章？",
    deleteMessage: (title: string) => `「${title}」將從資料庫中永久移除，包括重點與閱讀進度。此操作無法復原。`,
    keepSaved: "保留已經儲存的文章",
    keepSavedHelp: (count: number) => `保留資料庫中的 ${count} 篇已儲存文章，只停止繼續抓取此訂閱來源。`,
    unsubscribe: "取消訂閱",
    unsubscribeFrom: (name: string) => `取消訂閱 ${name}`,
    unsubscribePending: "正在取消訂閱...",
    unsubscribeTitle: (name: string) => `取消訂閱 ${name}？`,
    unsubscribeMessage: (count: number) => `Curioflow 將停止從此訂閱來源抓取新文章。目前資料庫中有來自它的 ${count} 篇已儲存文章。`
  },
  ja: {
    cancel: "キャンセル",
    cancelDelete: "削除をキャンセル",
    cancelUnsubscribe: "購読解除をキャンセル",
    delete: "削除",
    deleteArticle: "記事を削除",
    deleteChat: "チャットを削除",
    deleteChatMessage: (title: string) => `「${title}」とその会話履歴は完全に削除されます。この操作は元に戻せません。`,
    deleteChatTitle: "このチャットを削除しますか？",
    deleteHint: "ライブラリから隠して残したい場合は、代わりにアーカイブしてください。",
    deletePending: "削除中...",
    deleteTitle: "この記事を削除しますか？",
    deleteMessage: (title: string) => `「${title}」はハイライトや読書進捗とともにライブラリから完全に削除されます。この操作は元に戻せません。`,
    keepSaved: "保存済みの記事を残す",
    keepSavedHelp: (count: number) => `ライブラリに保存済みの ${count} 件の記事を残し、このフィードの取得だけを停止します。`,
    unsubscribe: "購読解除",
    unsubscribeFrom: (name: string) => `${name} の購読を解除`,
    unsubscribePending: "購読解除中...",
    unsubscribeTitle: (name: string) => `${name} の購読を解除しますか？`,
    unsubscribeMessage: (count: number) => `このフィードからの新着記事の取得を停止します。現在ライブラリに ${count} 件の保存済み記事があります。`
  },
  ko: {
    cancel: "취소",
    cancelDelete: "삭제 취소",
    cancelUnsubscribe: "구독 취소 중단",
    delete: "삭제",
    deleteArticle: "글 삭제",
    deleteChat: "대화 삭제",
    deleteChatMessage: (title: string) => `“${title}” 및 전체 대화 기록이 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`,
    deleteChatTitle: "이 대화를 삭제할까요?",
    deleteHint: "라이브러리에서 숨기기만 하려면 삭제 대신 보관하세요.",
    deletePending: "삭제 중...",
    deleteTitle: "이 글을 삭제할까요?",
    deleteMessage: (title: string) => `“${title}”이(가) 하이라이트 및 읽기 진행률과 함께 라이브러리에서 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`,
    keepSaved: "이미 저장한 글 유지",
    keepSavedHelp: (count: number) => `라이브러리에 저장된 글 ${count}개를 그대로 두고 이 피드만 중단합니다.`,
    unsubscribe: "구독 취소",
    unsubscribeFrom: (name: string) => `${name} 구독 취소`,
    unsubscribePending: "구독 취소 중...",
    unsubscribeTitle: (name: string) => `${name} 구독을 취소할까요?`,
    unsubscribeMessage: (count: number) => `이 피드에서 새 글을 더 이상 가져오지 않습니다. 현재 라이브러리에 이 피드에서 저장한 글이 ${count}개 있습니다.`
  }
};

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
  returnFilter = "recent-posts",
  sourceId,
  sourceName
}: {
  children: ReactNode;
  className: string;
  itemCount: number;
  locale?: SystemLanguage;
  returnFilter?: "newsletters" | "recent-posts";
  sourceId: string;
  sourceName: string;
}) {
  const copy = pickLocale(locale, COPY);
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

      {isOpen ? createPortal(
        <div className="confirmDialog sourceConfirmDialog open" role="dialog" aria-labelledby="unsubscribe-title" aria-modal="true">
          <button className="addDialogBackdrop" onClick={() => setIsOpen(false)} type="button" aria-label={copy.cancelUnsubscribe} />
          <section className="confirmDialogPanel">
            <h2 id="unsubscribe-title">{copy.unsubscribeTitle(sourceName)}</h2>
            <p>{copy.unsubscribeMessage(itemCount)}</p>
            <form action={unsubscribeSourceAction} className="unsubscribeForm">
              <input type="hidden" name="sourceId" value={sourceId} />
              <input type="hidden" name="returnFilter" value={returnFilter} />
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
        </div>,
        document.body
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
  const copy = pickLocale(locale, COPY);
  const buttonTitle = title ?? copy.deleteArticle;
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        aria-label={buttonTitle}
        className={className}
        data-close-menu=""
        onClick={() => setIsOpen(true)}
        role={className.includes("readerMoreItem") ? "menuitem" : undefined}
        title={buttonTitle}
        type="button"
      >
        {children}
      </button>

      {isOpen ? createPortal(
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
        </div>,
        document.body
      ) : null}
    </>
  );
}

export function DeleteChatThreadButton({
  children,
  className,
  locale = "en",
  threadId,
  threadTitle
}: {
  children: ReactNode;
  className: string;
  locale?: SystemLanguage;
  threadId: string;
  threadTitle: string;
}) {
  const copy = pickLocale(locale, COPY);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        aria-label={copy.deleteChat}
        className={className}
        onClick={() => setIsOpen(true)}
        title={copy.deleteChat}
        type="button"
      >
        {children}
      </button>

      {isOpen ? (
        <div className="confirmDialog open" role="dialog" aria-labelledby="delete-chat-title" aria-modal="true">
          <button className="addDialogBackdrop" onClick={() => setIsOpen(false)} type="button" aria-label={copy.cancelDelete} />
          <section className="confirmDialogPanel deleteDialogPanel">
            <h2 id="delete-chat-title">{copy.deleteChatTitle}</h2>
            <p>{copy.deleteChatMessage(threadTitle)}</p>
            <form action={deleteChatThreadAction} className="deleteItemForm">
              <input type="hidden" name="threadId" value={threadId} />
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
