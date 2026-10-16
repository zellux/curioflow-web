import type { SystemLanguage } from "@/app/i18n";

export function ContentSkeleton({ locale, reader = false }: { locale: SystemLanguage; reader?: boolean }) {
  const label = locale === "zh-Hans" ? (reader ? "正在加载文章…" : "正在加载内容…") : (reader ? "Loading article…" : "Loading content…");
  return <div className={`contentSkeleton ${reader ? "readerView" : "libraryView"}`} role="status" aria-label={label}>
    <span className="navigationStatusLabel">{label}</span>
    <div aria-hidden="true">
      <div className="skeletonLine skeletonEyebrow" />
      <div className="skeletonLine skeletonHeading" />
      {reader ? <>
        <div className="skeletonLine skeletonMeta" />
        <div className="skeletonSummary" />
        {Array.from({ length: 9 }, (_, index) => <div className="skeletonLine skeletonParagraph" key={index} />)}
      </> : Array.from({ length: 5 }, (_, index) => <div className="skeletonListItem" key={index}>
        <div className="skeletonLine skeletonMeta" />
        <div className="skeletonLine skeletonTitle" />
        <div className="skeletonLine skeletonParagraph" />
      </div>)}
    </div>
  </div>;
}
