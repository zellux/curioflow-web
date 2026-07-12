"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { askLibraryAction } from "@/app/actions";

function AskSubmitButton({ pendingLabel, sendLabel }: { pendingLabel: string; sendLabel: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} type="submit">{pending ? pendingLabel : sendLabel}</button>;
}

function AskPendingSteps({ steps }: { steps: [string, string, string] }) {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <div aria-live="polite" className="askPendingSteps">
      <span className="askAvatar"><i /></span>
      <ol>
        {steps.map((step, index) => (
          <li className={index === 0 ? "active" : "pending"} key={step}>
            <i />
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AskComposer({
  pendingLabel,
  placeholder,
  progressLabels,
  sendLabel,
  threadId
}: {
  pendingLabel: string;
  placeholder: string;
  progressLabels: [string, string, string];
  sendLabel: string;
  threadId?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize(event: FormEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (event.currentTarget.value.trim()) formRef.current?.requestSubmit();
  }

  return (
    <form action={askLibraryAction} className="askForm askChatForm" ref={formRef}>
      <AskPendingSteps steps={progressLabels} />
      <input type="hidden" name="returnView" value="ask" />
      {threadId ? <input type="hidden" name="threadId" value={threadId} /> : null}
      <textarea
        aria-keyshortcuts="Enter"
        name="question"
        onInput={resize}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        required
        rows={1}
      />
      <AskSubmitButton pendingLabel={pendingLabel} sendLabel={sendLabel} />
    </form>
  );
}
