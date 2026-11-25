import { pickLocale, type SystemLanguage } from "@/app/i18n";

export function ContentSkeleton({ locale, reader = false }: { locale: SystemLanguage; reader?: boolean }) {
  const label = reader
    ? pickLocale(locale, { en: "Loading article…", "zh-Hans": "正在加载文章…", "zh-Hant": "正在載入文章…", ja: "記事を読み込み中…", ko: "글 불러오는 중…" })
    : pickLocale(locale, { en: "Loading content…", "zh-Hans": "正在加载内容…", "zh-Hant": "正在載入內容…", ja: "コンテンツを読み込み中…", ko: "콘텐츠 불러오는 중…" });
  return <div className={`contentSkeleton ${reader ? "readerView" : "libraryView"}`} role="status" aria-label={label}>
    <span className="navigationStatusLabel">{label}</span>
    <div aria-hidden="true">
      <div className="skeletonLine skeletonEyebrow" />
      <div className="skeletonLine skeletonHeading" />
      {reader ? <>
        <div className="skeletonLine skeletonMeta" />
        <div className="skeletonSummary" />
        {Array.from({ length: 9 }, (_, index) => <div className="skeletonLine skeletonParagraph" key={index} />)}
      </> : <SkeletonRows />}
    </div>
  </div>;
}

function SkeletonRows() {
  return <>{Array.from({ length: 5 }, (_, index) => <div className="skeletonListItem" key={index}>
    <div className="skeletonLine skeletonMeta" />
    <div className="skeletonLine skeletonTitle" />
    <div className="skeletonLine skeletonParagraph" />
  </div>)}</>;
}

export function FeedListSkeleton({ locale }: { locale: SystemLanguage }) {
  const label = pickLocale(locale, {
    en: "Loading articles…",
    "zh-Hans": "正在加载文章列表…",
    "zh-Hant": "正在載入文章列表…",
    ja: "記事一覧を読み込み中…",
    ko: "글 목록 불러오는 중…"
  });
  return <div className="feedListSkeleton" role="status" aria-label={label}>
    <span className="navigationStatusLabel">{label}</span>
    <div aria-hidden="true"><SkeletonRows /></div>
  </div>;
}
