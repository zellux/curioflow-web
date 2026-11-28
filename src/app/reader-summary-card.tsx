import { SummaryDisclosure } from "@/app/summary-disclosure";
import { regenerateArticleSummaryAction } from "@/app/actions";
import { RegenerateSummaryForm } from "@/app/regenerate-summary-form";
import { pickLocale, type SystemLanguage, type UiCopy } from "@/app/i18n";

export function ReaderSummaryCard({
  copy,
  itemId,
  locale,
  returnTo,
  overview,
  points
}: {
  copy: UiCopy;
  itemId: string;
  locale: SystemLanguage;
  returnTo: string;
  overview: string;
  points: string[];
}) {
  const summaryCardId = `reader-summary-${itemId}`;

  return (
    <section className="readerSummaryCard" id={summaryCardId} aria-label={copy.item.summary}>
      <header>
        <strong>{copy.item.summary}</strong>
        <a className="summarySkip" href={`#reader-body-${itemId}`}>{pickLocale(locale, { en: "Skip to article ↓", "zh-Hans": "跳到正文 ↓", "zh-Hant": "跳至內文 ↓", ja: "本文へスキップ ↓", ko: "본문으로 건너뛰기 ↓" })}</a>
      </header>
      <p>{overview}</p>
      {points.length > 0 ? (
        <SummaryDisclosure label={pickLocale(locale, { en: "Key points", "zh-Hans": "关键要点", "zh-Hant": "關鍵要點", ja: "主なポイント", ko: "핵심 요약" })}>
          <ul>
            {points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          <RegenerateSummaryForm action={regenerateArticleSummaryAction} itemId={itemId} locale={locale} returnTo={returnTo} />
        </SummaryDisclosure>
      ) : (
        <RegenerateSummaryForm action={regenerateArticleSummaryAction} itemId={itemId} locale={locale} returnTo={returnTo} />
      )}
    </section>
  );
}
