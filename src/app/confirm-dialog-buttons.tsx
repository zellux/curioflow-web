"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteItemAction, unsubscribeSourceAction } from "@/app/actions";

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
  sourceId,
  sourceName
}: {
  children: ReactNode;
  className: string;
  itemCount: number;
  sourceId: string;
  sourceName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        aria-label={`Unsubscribe from ${sourceName}`}
        className={className}
        onClick={() => setIsOpen(true)}
        title={`Unsubscribe from ${sourceName}`}
        type="button"
      >
        {children}
      </button>

      {isOpen ? (
        <div className="confirmDialog open" role="dialog" aria-labelledby="unsubscribe-title" aria-modal="true">
          <button className="addDialogBackdrop" onClick={() => setIsOpen(false)} type="button" aria-label="Cancel unsubscribe" />
          <section className="confirmDialogPanel">
            <h2 id="unsubscribe-title">Unsubscribe from {sourceName}?</h2>
            <p>
              Curioflow will stop fetching new posts from this feed. You currently have {itemCount} saved article
              {itemCount === 1 ? "" : "s"} from it in your library.
            </p>
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
                  Keep already-saved articles
                  <small>Leave the {itemCount} saved article{itemCount === 1 ? "" : "s"} in your library, just stop the feed.</small>
                </strong>
              </label>
              <div>
                <button className="dialogCancelButton" onClick={() => setIsOpen(false)} type="button">Cancel</button>
                <PendingSubmitButton pendingLabel="Unsubscribing...">Unsubscribe</PendingSubmitButton>
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
  returnTo,
  title = "Delete article"
}: {
  children: ReactNode;
  className: string;
  itemId: string;
  itemTitle: string;
  returnTo: string;
  title?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        aria-label={title}
        className={className}
        onClick={() => setIsOpen(true)}
        title={title}
        type="button"
      >
        {children}
      </button>

      {isOpen ? (
        <div className="confirmDialog open" role="dialog" aria-labelledby="delete-item-title" aria-modal="true">
          <button className="addDialogBackdrop" onClick={() => setIsOpen(false)} type="button" aria-label="Cancel delete" />
          <section className="confirmDialogPanel deleteDialogPanel">
            <h2 id="delete-item-title">Delete this article?</h2>
            <p>
              &ldquo;{itemTitle}&rdquo; will be permanently removed from your library, along with its highlights and
              reading progress. This can&apos;t be undone.
            </p>
            <p className="deleteDialogHint">To keep it but hide it from your library, archive it instead.</p>
            <form action={deleteItemAction} className="deleteItemForm">
              <input type="hidden" name="itemId" value={itemId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div>
                <button className="dialogCancelButton" onClick={() => setIsOpen(false)} type="button">Cancel</button>
                <PendingSubmitButton pendingLabel="Deleting...">Delete</PendingSubmitButton>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
