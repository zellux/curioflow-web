import Link from "next/link";
import { BackgroundStatusDisclosure } from "@/app/background-status-disclosure";
import type { SystemLanguage } from "@/app/i18n";
import { isActiveJobStatus, isFailedJobStatus } from "@/server/job-state";

type JobStatus = {
  createdAt: Date | string;
  error: string | null;
  id: string;
  progressJson: string;
  status: string;
  type: string;
};

type SourceStatus = {
  id: string;
  name: string;
  status: string;
  type: string;
};

type SourceJobRollup = {
  active: number;
  failed: number;
  sourceId: string;
  total: number;
};

type JobStatusCounts = {
  actionable: number;
  active: number;
  failed: number;
};

const COPY = {
  en: {
    active: (count: number) => `${count} background job${count === 1 ? "" : "s"} running`,
    activeDetail: "Curioflow will refresh this view as work finishes.",
    activeProgress: (type: string, detail: string) => `${type}: ${detail}`,
    details: "Details",
    dismiss: "Hide for 24 hours",
    failed: (count: number) => `${count} article${count === 1 ? "" : "s"} with processing issues`,
    failedFallback: "Open Debug to review the affected articles.",
    failedDetail: (type: string, error: string | null) => `${type}: ${error ?? "Retry the failed article summary."}`,
    label: "Background work status",
    moreJobs: (count: number) => `+ ${count} more job${count === 1 ? "" : "s"} tracked`,
    moreSources: (count: number) => `+ ${count} more source${count === 1 ? "" : "s"} with issues`,
    recentJobs: "Recent jobs",
    retry: "Retry summaries",
    sourceActive: (count: number) => `${count} active`,
    sourceFailed: (count: number) => `${count} failed`,
    sourceIssue: (count: number) => `${count} source${count === 1 ? "" : "s"} need attention`,
    sourceIssueDetail: (name: string) => `${name} could not refresh recently.`,
    sourceIssues: "Source health",
    sourceWork: "Source work",
    sourceWorkDetail: (name: string, detail: string) => `${name}: ${detail}`,
    sourceWorkMore: (count: number) => `+ ${count} more source${count === 1 ? "" : "s"} with background work`,
    statuses: {
      failed: "failed",
      queued: "queued",
      running: "running"
    },
    reviewArticles: "Review articles"
  },
  "zh-Hans": {
    active: (count: number) => `${count} 个后台任务正在运行`,
    activeDetail: "任务完成后 Curioflow 会刷新当前视图。",
    activeProgress: (type: string, detail: string) => `${type}：${detail}`,
    details: "详情",
    dismiss: "24 小时内不再显示",
    failed: (count: number) => `${count} 篇文章处理失败`,
    failedFallback: "打开 Debug 查看有问题的文章。",
    failedDetail: (type: string, error: string | null) => `${type}：${error ?? "重试失败的文章摘要。"}`,
    label: "后台任务状态",
    moreJobs: (count: number) => `还有 ${count} 个任务`,
    moreSources: (count: number) => `还有 ${count} 个来源异常`,
    recentJobs: "最近任务",
    retry: "重试摘要",
    sourceActive: (count: number) => `${count} 个进行中`,
    sourceFailed: (count: number) => `${count} 个失败`,
    sourceIssue: (count: number) => `${count} 个来源需要处理`,
    sourceIssueDetail: (name: string) => `${name} 最近无法刷新。`,
    sourceIssues: "来源健康",
    sourceWork: "来源任务",
    sourceWorkDetail: (name: string, detail: string) => `${name}：${detail}`,
    sourceWorkMore: (count: number) => `还有 ${count} 个来源有后台任务`,
    statuses: {
      failed: "失败",
      queued: "排队",
      running: "运行"
    },
    reviewArticles: "查看问题文章"
  },
  "zh-Hant": {
    active: (count: number) => `${count} 個背景工作執行中`,
    activeDetail: "工作完成後 Curioflow 會自動重新整理目前檢視。",
    activeProgress: (type: string, detail: string) => `${type}：${detail}`,
    details: "詳情",
    dismiss: "24 小時內不再顯示",
    failed: (count: number) => `${count} 篇文章處理失敗`,
    failedFallback: "開啟 Debug 檢視受影響的文章。",
    failedDetail: (type: string, error: string | null) => `${type}：${error ?? "請重試失敗的文章摘要。"}`,
    label: "背景工作狀態",
    moreJobs: (count: number) => `還有 ${count} 個工作`,
    moreSources: (count: number) => `還有 ${count} 個來源異常`,
    recentJobs: "最近工作",
    retry: "重試摘要",
    sourceActive: (count: number) => `${count} 個進行中`,
    sourceFailed: (count: number) => `${count} 個失敗`,
    sourceIssue: (count: number) => `${count} 個來源需要處理`,
    sourceIssueDetail: (name: string) => `${name} 最近無法重新整理。`,
    sourceIssues: "來源健康狀態",
    sourceWork: "來源工作",
    sourceWorkDetail: (name: string, detail: string) => `${name}：${detail}`,
    sourceWorkMore: (count: number) => `還有 ${count} 個來源有背景工作`,
    statuses: {
      failed: "失敗",
      queued: "排隊",
      running: "執行中"
    },
    reviewArticles: "檢視問題文章"
  },
  ja: {
    active: (count: number) => `${count} 件のバックグラウンド処理を実行中`,
    activeDetail: "処理が完了すると画面が自動更新されます。",
    activeProgress: (type: string, detail: string) => `${type}: ${detail}`,
    details: "詳細",
    dismiss: "24 時間非表示にする",
    failed: (count: number) => `${count} 件の記事で処理エラーが発生`,
    failedFallback: "Debug を開いて対象の記事を確認してください。",
    failedDetail: (type: string, error: string | null) => `${type}: ${error ?? "失敗した要約を再試行してください。"}`,
    label: "バックグラウンド処理の状況",
    moreJobs: (count: number) => `他 ${count} 件のジョブ`,
    moreSources: (count: number) => `他 ${count} 件のエラーソース`,
    recentJobs: "最近のジョブ",
    retry: "要約を再試行",
    sourceActive: (count: number) => `${count} 件実行中`,
    sourceFailed: (count: number) => `${count} 件失敗`,
    sourceIssue: (count: number) => `${count} 件のソースに確認が必要`,
    sourceIssueDetail: (name: string) => `${name} を最近更新できませんでした。`,
    sourceIssues: "ソースの状態",
    sourceWork: "ソース処理",
    sourceWorkDetail: (name: string, detail: string) => `${name}: ${detail}`,
    sourceWorkMore: (count: number) => `他 ${count} 件のソースで処理中`,
    statuses: {
      failed: "失敗",
      queued: "待機中",
      running: "実行中"
    },
    reviewArticles: "対象の記事を確認"
  },
  ko: {
    active: (count: number) => `백그라운드 작업 ${count}개 실행 중`,
    activeDetail: "작업이 끝나면 화면이 자동으로 새로고침됩니다.",
    activeProgress: (type: string, detail: string) => `${type}: ${detail}`,
    details: "세부 정보",
    dismiss: "24시간 동안 숨기기",
    failed: (count: number) => `글 ${count}개 처리 오류`,
    failedFallback: "Debug에서 문제가 발생한 글을 확인하세요.",
    failedDetail: (type: string, error: string | null) => `${type}: ${error ?? "실패한 요약을 다시 시도하세요."}`,
    label: "백그라운드 작업 상태",
    moreJobs: (count: number) => `외 작업 ${count}개`,
    moreSources: (count: number) => `외 문제 소스 ${count}개`,
    recentJobs: "최근 작업",
    retry: "요약 재시도",
    sourceActive: (count: number) => `${count}개 진행 중`,
    sourceFailed: (count: number) => `${count}개 실패`,
    sourceIssue: (count: number) => `소스 ${count}개 확인 필요`,
    sourceIssueDetail: (name: string) => `${name}을(를) 최근 새로고침하지 못했습니다.`,
    sourceIssues: "소스 상태",
    sourceWork: "소스 작업",
    sourceWorkDetail: (name: string, detail: string) => `${name}: ${detail}`,
    sourceWorkMore: (count: number) => `외 백그라운드 작업 소스 ${count}개`,
    statuses: {
      failed: "실패",
      queued: "대기 중",
      running: "실행 중"
    },
    reviewArticles: "문제 글 확인"
  }
};

function statusCopy(locale: SystemLanguage) {
  return COPY[locale] ?? COPY.en;
}

type JobProgress = {
  current?: unknown;
  failureCategory?: unknown;
  latestTitle?: unknown;
  message?: unknown;
  percent?: unknown;
  stage?: unknown;
  total?: unknown;
};

const JOB_TYPE_LABELS: Record<SystemLanguage, Record<string, string>> = {
  en: {
    fetch_source: "Source import",
    translate_article: "Translation", generate_summary: "Summary",
    ingest_url: "Article ingest",
    parse_pdf: "PDF parse",
    refetch_article: "Article refetch"
  },
  "zh-Hans": {
    fetch_source: "来源导入",
    translate_article: "翻译", generate_summary: "摘要",
    ingest_url: "文章抓取",
    parse_pdf: "PDF 解析",
    refetch_article: "文章重抓取"
  },
  "zh-Hant": {
    fetch_source: "來源匯入",
    translate_article: "翻譯", generate_summary: "摘要",
    ingest_url: "文章擷取",
    parse_pdf: "PDF 解析",
    refetch_article: "文章重擷取"
  },
  ja: {
    fetch_source: "ソース取込",
    translate_article: "翻訳", generate_summary: "要約",
    ingest_url: "記事取得",
    parse_pdf: "PDF 解析",
    refetch_article: "記事再取得"
  },
  ko: {
    fetch_source: "소스 가져오기",
    translate_article: "번역", generate_summary: "요약",
    ingest_url: "글 수집",
    parse_pdf: "PDF 분석",
    refetch_article: "글 다시 가져오기"
  }
};

const JOB_STAGE_LABELS: Record<SystemLanguage, Record<string, string>> = {
  en: {
    extracting_article: "extracting article",
    failed: "failed",
    fetching_feed: "refreshing feed",
    generating_summary: "generating summary",
    importing_episodes: "importing episodes",
    locating_item: "locating item",
    parsing_pdf: "parsing PDF",
    persisting_document: "saving document",
    queued: "queued",
    queueing_articles: "queueing articles",
    retry_queued: "queued for retry",
    running: "running",
    succeeded: "complete"
  },
  "zh-Hans": {
    extracting_article: "正在抓取正文",
    failed: "失败",
    fetching_feed: "正在刷新来源",
    generating_summary: "正在生成摘要",
    importing_episodes: "正在导入单集",
    locating_item: "正在定位条目",
    parsing_pdf: "正在解析 PDF",
    persisting_document: "正在保存正文",
    queued: "排队中",
    queueing_articles: "正在加入文章",
    retry_queued: "已排队重试",
    running: "运行中",
    succeeded: "完成"
  },
  "zh-Hant": {
    extracting_article: "正在擷取正文",
    failed: "失敗",
    fetching_feed: "正在重新整理來源",
    generating_summary: "正在產生摘要",
    importing_episodes: "正在匯入單集",
    locating_item: "正在定位項目",
    parsing_pdf: "正在解析 PDF",
    persisting_document: "正在儲存文件",
    queued: "排隊中",
    queueing_articles: "正在加入文章",
    retry_queued: "已排隊重試",
    running: "執行中",
    succeeded: "完成"
  },
  ja: {
    extracting_article: "本文を抽出中",
    failed: "失敗",
    fetching_feed: "フィードを更新中",
    generating_summary: "要約を生成中",
    importing_episodes: "エピソードを取込中",
    locating_item: "アイテムを検索中",
    parsing_pdf: "PDF を解析中",
    persisting_document: "ドキュメントを保存中",
    queued: "待機中",
    queueing_articles: "記事をキューに追加中",
    retry_queued: "再試行待機中",
    running: "実行中",
    succeeded: "完了"
  },
  ko: {
    extracting_article: "본문 추출 중",
    failed: "실패",
    fetching_feed: "피드 새로고침 중",
    generating_summary: "요약 생성 중",
    importing_episodes: "에피소드 가져오는 중",
    locating_item: "항목 찾는 중",
    parsing_pdf: "PDF 분석 중",
    persisting_document: "문서 저장 중",
    queued: "대기 중",
    queueing_articles: "글 대기열 추가 중",
    retry_queued: "재시도 대기 중",
    running: "실행 중",
    succeeded: "완료"
  }
};

const JOB_FAILURE_CATEGORY_LABELS: Record<SystemLanguage, Record<string, string>> = {
  en: {
    entitlement: "entitlement",
    network: "network",
    parser: "parser",
    provider: "provider",
    retry: "retry limit",
    timeout: "timeout",
    unknown: "unknown"
  },
  "zh-Hans": {
    entitlement: "权限/额度",
    network: "网络",
    parser: "解析",
    provider: "服务商",
    retry: "重试上限",
    timeout: "超时",
    unknown: "未知"
  },
  "zh-Hant": {
    entitlement: "權限/額度",
    network: "網路",
    parser: "解析",
    provider: "供應商",
    retry: "重試上限",
    timeout: "逾時",
    unknown: "未知"
  },
  ja: {
    entitlement: "権限/クォータ",
    network: "ネットワーク",
    parser: "パーサー",
    provider: "プロバイダー",
    retry: "リトライ上限",
    timeout: "タイムアウト",
    unknown: "不明"
  },
  ko: {
    entitlement: "권한/할당량",
    network: "네트워크",
    parser: "파서",
    provider: "제공자",
    retry: "재시도 한도",
    timeout: "시간 초과",
    unknown: "알 수 없음"
  }
};

function parseJobProgress(progressJson: string | null | undefined): JobProgress | null {
  if (!progressJson) return null;
  try {
    const parsed = JSON.parse(progressJson) as unknown;
    return parsed && typeof parsed === "object" ? parsed as JobProgress : null;
  } catch {
    return null;
  }
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jobTypeLabel(type: string, locale: SystemLanguage) {
  return JOB_TYPE_LABELS[locale][type] ?? type.replace(/_/g, " ");
}

function jobStageLabel(stage: unknown, locale: SystemLanguage) {
  const value = textValue(stage);
  if (!value) return JOB_STAGE_LABELS[locale].running;
  return JOB_STAGE_LABELS[locale][value] ?? value.replace(/[_-]+/g, " ");
}

function jobFailureCategoryLabel(category: unknown, locale: SystemLanguage) {
  const value = textValue(category);
  if (!value) return null;
  return JOB_FAILURE_CATEGORY_LABELS[locale][value] ?? value.replace(/[_-]+/g, " ");
}

function jobProgressMetric(progress: JobProgress | null) {
  if (!progress) return null;

  const percent = finiteNumber(progress.percent);
  const current = finiteNumber(progress.current);
  const total = finiteNumber(progress.total);

  if (current !== null && total !== null) return `${current}/${total}`;
  if (percent !== null) return `${Math.round(percent)}%`;
  if (current !== null) return `${current}`;
  return null;
}

function jobProgressDetail(job: JobStatus, locale: SystemLanguage) {
  const progress = parseJobProgress(job.progressJson);
  const stage = jobStageLabel(progress?.stage, locale);
  const metric = jobProgressMetric(progress);
  const latestTitle = textValue(progress?.latestTitle);
  const parts = [stage, metric, latestTitle].filter((part): part is string => Boolean(part));
  return statusCopy(locale).activeProgress(jobTypeLabel(job.type, locale), parts.join(" · "));
}

function failedJobDetail(job: JobStatus, locale: SystemLanguage) {
  const progress = parseJobProgress(job.progressJson);
  const message = textValue(progress?.message) ?? job.error;
  const category = jobFailureCategoryLabel(progress?.failureCategory, locale);
  const detail = category && message ? `${category}: ${message}` : message;

  return statusCopy(locale).failedDetail(
    jobTypeLabel(job.type, locale),
    detail
  );
}

function jobStatusLabel(status: string, locale: SystemLanguage) {
  const copy = statusCopy(locale);
  if (status === "failed") return copy.statuses.failed;
  if (status === "queued") return copy.statuses.queued;
  if (status === "running") return copy.statuses.running;
  return status.replace(/[_-]+/g, " ");
}

function jobDetail(job: JobStatus, locale: SystemLanguage) {
  return isFailedJobStatus(job.status) ? failedJobDetail(job, locale) : jobProgressDetail(job, locale);
}

function sourceWorkDetail(sourceName: string, rollup: SourceJobRollup, locale: SystemLanguage) {
  const copy = statusCopy(locale);
  const parts = [
    rollup.active > 0 ? copy.sourceActive(rollup.active) : null,
    rollup.failed > 0 ? copy.sourceFailed(rollup.failed) : null
  ].filter((part): part is string => Boolean(part));

  return copy.sourceWorkDetail(sourceName, parts.join(", "));
}

export function JobStatusStrip({
  jobs,
  jobCounts,
  locale,
  sourceRollups = [],
  sources
}: {
  jobs: JobStatus[];
  jobCounts?: JobStatusCounts;
  locale: SystemLanguage;
  sourceRollups?: SourceJobRollup[];
  sources: SourceStatus[];
}) {
  const copy = statusCopy(locale);
  const activeJobs = jobs.filter((job) => isActiveJobStatus(job.status));
  const failedJobs = jobs.filter((job) => isFailedJobStatus(job.status));
  const erroredSources = sources.filter((source) => source.status === "error" && source.type !== "rss");
  const erroredSourceRows = erroredSources.slice(0, 3);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const sourceWorkRows = sourceRollups.filter((rollup) => rollup.total > 0).slice(0, 3);
  const activeJobCount = jobCounts?.active ?? activeJobs.length;
  const failedJobCount = jobCounts?.failed ?? failedJobs.length;
  const actionableJobCount = jobCounts?.actionable ?? activeJobCount + failedJobCount;
  const firstActiveJob = activeJobs[0];
  const firstFailedJob = failedJobs[0];
  const firstErroredSource = erroredSources[0];
  const undisplayedJobCount = Math.max(0, actionableJobCount - jobs.length);
  const undisplayedSourceCount = Math.max(0, erroredSources.length - erroredSourceRows.length);
  const undisplayedSourceWorkCount = Math.max(0, sourceRollups.length - sourceWorkRows.length);

  if (activeJobCount === 0 && failedJobCount === 0 && erroredSources.length === 0) return null;

  const hasIssue = failedJobCount > 0 || erroredSources.length > 0;
  const title = failedJobCount > 0
    ? copy.failed(failedJobCount)
    : erroredSources.length > 0
      ? copy.sourceIssue(erroredSources.length)
      : copy.active(activeJobCount);
  const detail = firstFailedJob
    ? failedJobDetail(firstFailedJob, locale)
    : failedJobCount > 0
      ? copy.failedFallback
    : firstErroredSource
      ? copy.sourceIssueDetail(firstErroredSource.name)
    : firstActiveJob
      ? jobProgressDetail(firstActiveJob, locale)
      : copy.activeDetail;
  const hasDetails = jobs.length > 0 || sourceWorkRows.length > 0 || erroredSources.length > 0;

  return (
    <BackgroundStatusDisclosure title={title} label={copy.details} dismissLabel={copy.dismiss} hasIssue={hasIssue}>
    <section className={`jobStatusStrip ${hasIssue ? "hasIssue" : "isActive"}`} aria-label={copy.label}>
      <span className="jobStatusDot" aria-hidden="true" />
      <div className="jobStatusContent">
        <div className="jobStatusPrimary">
          <strong><Link className="jobStatusDebugLink" href={failedJobCount > 0 ? "/debug?tab=tasks&status=failed" : "/debug?tab=tasks"}>{title}</Link></strong>
          <small title={detail}>{detail}</small>
        </div>
        {hasDetails ? (
          <details className="jobStatusDetails">
            <summary>{copy.details}</summary>
            {jobs.length > 0 ? (
              <div className="jobStatusDetailsGroup">
                <span>{copy.recentJobs}</span>
                <ul className="jobStatusList">
                  {jobs.map((job) => (
                    <li className={`jobStatusRow ${isFailedJobStatus(job.status) ? "hasIssue" : ""}`} key={job.id}>
                      <span className="jobStatusBadge">{jobStatusLabel(job.status, locale)}</span>
                      <span className="jobStatusRowText">{jobDetail(job, locale)}</span>
                    </li>
                  ))}
                  {undisplayedJobCount > 0 ? (
                    <li className="jobStatusMore">{copy.moreJobs(undisplayedJobCount)}</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            {sourceWorkRows.length > 0 ? (
              <div className="jobStatusDetailsGroup">
                <span>{copy.sourceWork}</span>
                <ul className="jobStatusList">
                  {sourceWorkRows.map((rollup) => {
                    const source = sourcesById.get(rollup.sourceId);
                    const sourceName = source?.name ?? rollup.sourceId;
                    return (
                      <li className={`jobStatusRow ${rollup.failed > 0 ? "hasIssue" : ""}`} key={rollup.sourceId}>
                        <span className="jobStatusBadge">{rollup.failed > 0 ? copy.statuses.failed : copy.statuses.running}</span>
                        <span className="jobStatusRowText">{sourceWorkDetail(sourceName, rollup, locale)}</span>
                      </li>
                    );
                  })}
                  {undisplayedSourceWorkCount > 0 ? (
                    <li className="jobStatusMore">{copy.sourceWorkMore(undisplayedSourceWorkCount)}</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            {erroredSourceRows.length > 0 ? (
              <div className="jobStatusDetailsGroup">
                <span>{copy.sourceIssues}</span>
                <ul className="jobStatusList">
                  {erroredSourceRows.map((source) => (
                    <li className="jobStatusRow hasIssue" key={source.id}>
                      <span className="jobStatusBadge">{source.type}</span>
                      <span className="jobStatusRowText">{copy.sourceIssueDetail(source.name)}</span>
                    </li>
                  ))}
                  {undisplayedSourceCount > 0 ? (
                    <li className="jobStatusMore">{copy.moreSources(undisplayedSourceCount)}</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </details>
        ) : null}
      </div>
      {failedJobCount > 0 ? (
        <Link className="jobStatusAction" href="/debug?tab=tasks&status=failed">{copy.reviewArticles}</Link>
      ) : null}
    </section>
    </BackgroundStatusDisclosure>
  );
}
