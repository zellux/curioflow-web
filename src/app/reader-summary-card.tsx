import { SummaryDisclosure } from "@/app/summary-disclosure";
import { regenerateArticleSummaryAction } from "@/app/actions";
import { RegenerateSummaryForm } from "@/app/regenerate-summary-form";
import { SummaryScrollRestorer } from "@/app/summary-scroll-restorer";
import type { SystemLanguage, UiCopy } from "@/app/i18n";

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
      <SummaryScrollRestorer itemId={itemId} pending={summary.source === "pending"} ready={summary.source === "llm"} targetId={summaryCardId} />
      <SummaryDisclosure label={<span className="readerSummaryMeta">
        <span className="summaryMark"><span /></span>
        <strong>{copy.item.summary}</strong>
        {sourceLabel ? <em>{sourceLabel}</em> : null}
      </span>}>
      <p>{summary.overview}</p>
      {summary.points.length > 0 ? (
        <ul>
          {summary.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
        {summary.source !== "placeholder" && summary.source !== "pending" ? (
          <RegenerateSummaryForm action={regenerateArticleSummaryAction} itemId={itemId} locale={locale} returnTo={returnTo} />
        ) : null}
      </SummaryDisclosure>
      <a className="summarySkip" href={`#reader-body-${itemId}`}>{locale === "zh-Hans" ? "直接读正文" : "Skip to article"}</a>
    </section>
  );
}
