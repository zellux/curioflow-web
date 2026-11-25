import { SummaryDisclosure } from "@/app/summary-disclosure";
import { regenerateArticleSummaryAction } from "@/app/actions";
import { RegenerateSummaryForm } from "@/app/regenerate-summary-form";
import { pickLocale, type SystemLanguage, type UiCopy } from "@/app/i18n";

export type ArticleSummary = {
  overview: string;
  points: string[];
  source: "metadata" | "llm" | "full-text" | "placeholder" | "pending" | "failed";
};

export function ReaderSummaryCard({
  copy,
  itemId,
  locale,
  returnTo,
  summary
}: {
  copy: UiCopy;
  itemId: string;
  locale: SystemLanguage;
  returnTo: string;
  summary: ArticleSummary;
}) {
  const sourceLabel =
    summary.source === "placeholder"
      ? copy.item.summaryPending
      : summary.source === "pending"
        ? copy.item.summaryGeneratingMeta
        : summary.source === "failed"
          ? copy.item.summaryFailedMeta
          : null;
  const statusClass =
    summary.source === "placeholder" || summary.source === "pending"
      ? "isPending"
      : summary.source === "failed"
        ? "isError"
        : "";
  const summaryCardId = `reader-summary-${itemId}`;

  return (
    <section className={`readerSummaryCard ${statusClass}`} id={summaryCardId} aria-label={copy.item.summary}>
      <header>
        <span className="readerSummaryMeta">
          <strong>{copy.item.summary}</strong>
          {sourceLabel ? <em>{sourceLabel}</em> : null}
        </span>
        <a className="summarySkip" href={`#reader-body-${itemId}`}>{pickLocale(locale, { en: "Skip to article ↓", "zh-Hans": "跳到正文 ↓", "zh-Hant": "跳至內文 ↓", ja: "本文へスキップ ↓", ko: "본문으로 건너뛰기 ↓" })}</a>
      </header>
      <p>{summary.overview}</p>
      {summary.points.length > 0 ? (
        <SummaryDisclosure label={pickLocale(locale, { en: "Key points", "zh-Hans": "关键要点", "zh-Hant": "關鍵要點", ja: "主なポイント", ko: "핵심 요약" })}>
          <ul>
            {summary.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          <RegenerateSummaryForm action={regenerateArticleSummaryAction} itemId={itemId} locale={locale} returnTo={returnTo} />
        </SummaryDisclosure>
      ) : summary.source !== "placeholder" && summary.source !== "pending" ? (
        <RegenerateSummaryForm action={regenerateArticleSummaryAction} itemId={itemId} locale={locale} returnTo={returnTo} />
      ) : null}
    </section>
  );
}
