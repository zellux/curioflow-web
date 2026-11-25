"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { deleteChatThreadAction, deleteItemAction, markSourceStreamReadAction, removeItemFromLibraryAction, unsubscribeSourceAction } from "@/app/actions";
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
  unsubscribe: string;
  unsubscribeFrom: (name: string) => string;
  unsubscribePending: string;
  unsubscribeTitle: (name: string) => string;
  unsubscribeMessage: string;
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
    unsubscribe: "Unsubscribe",
    unsubscribeFrom: (name: string) => `Unsubscribe from ${name}`,
    unsubscribePending: "Unsubscribing...",
    unsubscribeTitle: (name: string) => `Unsubscribe from ${name}?`,
    unsubscribeMessage: "Curioflow will stop fetching new posts from this source. Saved and archived articles will stay in your Library and Archive."
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
    unsubscribe: "取消订阅",
    unsubscribeFrom: (name: string) => `取消订阅 ${name}`,
    unsubscribePending: "正在取消订阅...",
    unsubscribeTitle: (name: string) => `取消订阅 ${name}？`,
    unsubscribeMessage: "Curioflow 会停止抓取新文章，已保存和已归档的文章会保留。"
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
    unsubscribe: "取消訂閱",
    unsubscribeFrom: (name: string) => `取消訂閱 ${name}`,
    unsubscribePending: "正在取消訂閱...",
    unsubscribeTitle: (name: string) => `取消訂閱 ${name}？`,
    unsubscribeMessage: "Curioflow 會停止擷取新文章，已儲存及已封存的文章會保留。"
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
    unsubscribe: "購読解除",
    unsubscribeFrom: (name: string) => `${name} の購読を解除`,
    unsubscribePending: "購読解除中...",
    unsubscribeTitle: (name: string) => `${name} の購読を解除しますか？`,
    unsubscribeMessage: "新着記事の取得を停止します。保存済みとアーカイブ済みの記事は残ります。"
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
    unsubscribe: "구독 취소",
    unsubscribeFrom: (name: string) => `${name} 구독 취소`,
    unsubscribePending: "구독 취소 중...",
    unsubscribeTitle: (name: string) => `${name} 구독을 취소할까요?`,
    unsubscribeMessage: "새 글 가져오기를 중단합니다. 저장하거나 보관한 글은 그대로 남습니다."
  }
};

const REMOVE_FROM_LIBRARY_COPY = {
  en: { label: "Remove from Library", title: "Remove this article from Library?", message: "The article will stay in its subscription. Removing it also clears its star.", pending: "Removing…" },
  "zh-Hans": { label: "移出资料库", title: "将这篇文章移出资料库？", message: "文章会留在订阅中，并清除星标。", pending: "正在移出…" },
  "zh-Hant": { label: "移出資料庫", title: "將這篇文章移出資料庫？", message: "文章會留在訂閱中，並清除星號。", pending: "正在移出…" },
  ja: { label: "ライブラリから外す", title: "記事をライブラリから外しますか？", message: "購読フィードには残り、スターは解除されます。", pending: "処理中…" },
  ko: { label: "라이브러리에서 제거", title: "이 글을 라이브러리에서 제거할까요?", message: "글은 구독에 남고 별표가 해제됩니다.", pending: "제거 중…" }
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
  locale = "en",
  returnFilter = "recent-posts",
  sourceId,
  sourceName
}: {
  children: ReactNode;
  className: string;
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
            <p>{copy.unsubscribeMessage}</p>
            <form action={unsubscribeSourceAction} className="unsubscribeForm">
              <input type="hidden" name="sourceId" value={sourceId} />
              <input type="hidden" name="returnFilter" value={returnFilter} />
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
  removeFromLibrary = false,
  title
}: {
  children: ReactNode;
  className: string;
  itemId: string;
  itemTitle: string;
  locale?: SystemLanguage;
  returnTo: string;
  removeFromLibrary?: boolean;
  title?: string;
}) {
  const copy = pickLocale(locale, COPY);
  const removeCopy = pickLocale(locale, REMOVE_FROM_LIBRARY_COPY);
  const buttonTitle = removeFromLibrary ? removeCopy.label : title ?? copy.deleteArticle;
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
        {removeFromLibrary ? <><span aria-hidden="true">−</span><span>{removeCopy.label}</span></> : children}
      </button>

      {isOpen ? createPortal(
        <div className="confirmDialog open" role="dialog" aria-labelledby="delete-item-title" aria-modal="true">
          <button className="addDialogBackdrop" onClick={() => setIsOpen(false)} type="button" aria-label={copy.cancelDelete} />
          <section className="confirmDialogPanel deleteDialogPanel">
            <h2 id="delete-item-title">{removeFromLibrary ? removeCopy.title : copy.deleteTitle}</h2>
            <p>{removeFromLibrary ? removeCopy.message : copy.deleteMessage(itemTitle)}</p>
            {removeFromLibrary ? null : <p className="deleteDialogHint">{copy.deleteHint}</p>}
            <form action={removeFromLibrary ? removeItemFromLibraryAction : deleteItemAction} className="deleteItemForm">
              <input type="hidden" name="itemId" value={itemId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div>
                <button className="dialogCancelButton" onClick={() => setIsOpen(false)} type="button">{copy.cancel}</button>
                <PendingSubmitButton pendingLabel={removeFromLibrary ? removeCopy.pending : copy.deletePending}>{removeFromLibrary ? removeCopy.label : copy.delete}</PendingSubmitButton>
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

const MARK_READ_COPY: Record<SystemLanguage, {
  label: string;
  title: string;
  message: (count: number, scope: string) => string;
  confirm: string;
  pending: string;
}> = {
  en: {
    label: "Mark all as read",
    title: "Mark all as read?",
    message: (count, scope) => `${count} unread article${count === 1 ? "" : "s"} in ${scope} will be marked as read. Reading progress on them is replaced.`,
    confirm: "Mark as read",
    pending: "Marking..."
  },
  "zh-Hans": {
    label: "全部标为已读",
    title: "全部标为已读？",
    message: (count, scope) => `「${scope}」中的 ${count} 篇未读文章将标为已读，原有阅读进度会被覆盖。`,
    confirm: "标为已读",
    pending: "正在标记…"
  },
  "zh-Hant": {
    label: "全部標為已讀",
    title: "全部標為已讀？",
    message: (count, scope) => `「${scope}」中的 ${count} 篇未讀文章將標為已讀，原有閱讀進度會被覆蓋。`,
    confirm: "標為已讀",
    pending: "正在標記…"
  },
  ja: {
    label: "すべて既読にする",
    title: "すべて既読にしますか？",
    message: (count, scope) => `「${scope}」の未読記事 ${count} 件を既読にします。読書の進み具合は上書きされます。`,
    confirm: "既読にする",
    pending: "処理中…"
  },
  ko: {
    label: "모두 읽음으로 표시",
    title: "모두 읽음으로 표시할까요?",
    message: (count, scope) => `「${scope}」의 읽지 않은 글 ${count}개를 읽음으로 표시합니다. 기존 읽기 진행률은 덮어씁니다.`,
    confirm: "읽음으로 표시",
    pending: "표시 중…"
  }
};

export function MarkStreamReadButton({
  className,
  locale = "en",
  scopeName,
  sourceId,
  sourceType,
  unreadCount
}: {
  className: string;
  locale?: SystemLanguage;
  scopeName: string;
  sourceId?: string;
  sourceType?: "rss" | "newsletter";
  unreadCount: number;
}) {
  const copy = pickLocale(locale, MARK_READ_COPY);
  const cancel = pickLocale(locale, COPY).cancel;
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button className={className} data-close-menu="" disabled={unreadCount === 0} onClick={() => setIsOpen(true)} role="menuitem" type="button">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m2 12 5 5L18 6M12 17l1 1 9-11" />
        </svg>
        <span>{copy.label}</span>
      </button>

      {isOpen ? createPortal(
        <div className="confirmDialog sourceConfirmDialog open" role="dialog" aria-labelledby="mark-read-title" aria-modal="true">
          <button className="addDialogBackdrop" onClick={() => setIsOpen(false)} type="button" aria-label={cancel} />
          <section className="confirmDialogPanel">
            <h2 id="mark-read-title">{copy.title}</h2>
            <p>{copy.message(unreadCount, scopeName)}</p>
            <form
              action={async (formData) => {
                await markSourceStreamReadAction(formData);
                setIsOpen(false);
              }}
              className="unsubscribeForm"
            >
              {sourceId ? <input type="hidden" name="sourceId" value={sourceId} /> : null}
              {sourceType ? <input type="hidden" name="sourceType" value={sourceType} /> : null}
              <div>
                <button className="dialogCancelButton" onClick={() => setIsOpen(false)} type="button">{cancel}</button>
                <PendingSubmitButton pendingLabel={copy.pending}>{copy.confirm}</PendingSubmitButton>
              </div>
            </form>
          </section>
        </div>,
        document.body
      ) : null}
    </>
  );
}
