"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useActionState, useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import type { SystemLanguage } from "@/app/i18n";
import { askLibraryAction } from "@/app/actions";

function AskSubmitButton({ pendingLabel, sendLabel, pending }: { pendingLabel: string; sendLabel: string; pending: boolean }) {
  return <button disabled={pending} type="submit">{pending ? pendingLabel : sendLabel}</button>;
}

function AskPendingFeedback({ label, locale, pending }: { label: string; locale: SystemLanguage; pending: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!pending) { setElapsed(0); return; }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);
  if (!pending) return null;

  return (
    <div className="askPendingSteps">
      <span className="askAvatar" aria-hidden="true"><i /></span>
      <span role="status">{label}</span>
      <span className="askElapsed" aria-live="off">{locale === "zh-Hans" ? `已等待 ${elapsed} 秒` : `${elapsed}s elapsed`}</span>
    </div>
  );
}

export function AskComposer({
  pendingLabel,
  placeholder,
  locale,
  latestMessageId,
  sendLabel,
  threadId,
  itemId,
  suggestions = [],
  scopeLabel,
  returnView = "ask"
}: {
  pendingLabel: string;
  placeholder: string;
  locale: SystemLanguage;
  latestMessageId: string | null;
  sendLabel: string;
  threadId?: string;
  itemId?: string;
  suggestions?: readonly string[];
  scopeLabel?: string;
  returnView?: "ask" | "brief";
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, submitAction, pending] = useActionState(async (_previous: null, formData: FormData) => {
    setQuestion(String(formData.get("question") ?? ""));
    setError(null);
    try { await askLibraryAction(formData); }
    catch (cause) {
      unstable_rethrow(cause);
      setError(locale === "zh-Hans" ? "暂时无法获取回答。问题已保留，请重试。" : "Could not get an answer. Your question is kept; please retry.");
    }
    return null;
  }, null);
  useEffect(() => {
    if (!pending && !error) {
      setQuestion("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  }, [latestMessageId, pending, error]);

  function resize(event: FormEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;
    setQuestion(textarea.value);
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (pending) return;
    if (event.currentTarget.value.trim()) formRef.current?.requestSubmit();
  }

  return (
    <>
    {suggestions.length > 0 ? <div className="askSuggestions">
      {suggestions.map(suggestion => <form action={submitAction} key={suggestion}>
        <input type="hidden" name="question" value={suggestion} />
        <input type="hidden" name="returnView" value={returnView} />
        {itemId ? <input type="hidden" name="itemId" value={itemId} /> : null}
        {threadId ? <input type="hidden" name="threadId" value={threadId} /> : null}
        <button disabled={pending} onClick={() => setQuestion(suggestion)} type="submit">{suggestion}</button>
      </form>)}
    </div> : null}
    {scopeLabel ? <p className="askScope">{scopeLabel}</p> : null}
    <form action={submitAction} className="askForm askChatForm" ref={formRef} aria-busy={pending}>
      <AskPendingFeedback label={pendingLabel} locale={locale} pending={pending} />
      {error && !pending ? <p className="askSubmitError" role="alert">{error}</p> : null}
      <input type="hidden" name="returnView" value={returnView} />
      {itemId ? <input type="hidden" name="itemId" value={itemId} /> : null}
      {threadId ? <input type="hidden" name="threadId" value={threadId} /> : null}
      <textarea
        aria-keyshortcuts="Enter"
        name="question"
        aria-label={placeholder}
        value={question}
        readOnly={pending}
        onChange={event => setQuestion(event.target.value)}
        onInput={resize}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        required
        rows={1}
      />
      <AskSubmitButton pending={pending} pendingLabel={pendingLabel} sendLabel={error ? (locale === "zh-Hans" ? "重试" : "Retry") : sendLabel} />
    </form>
    </>
  );
}
