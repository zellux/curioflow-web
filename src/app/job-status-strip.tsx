import type { SystemLanguage } from "@/app/i18n";
import { retryFailedBackgroundJobsAction } from "@/app/actions";
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
    failed: (count: number) => `${count} background job${count === 1 ? "" : "s"} failed`,
    failedFallback: "Open details or retry all failed background work.",
    failedDetail: (type: string, error: string | null) => `${type}: ${error ?? "Retry all failed background work."}`,
    label: "Background work status",
    moreJobs: (count: number) => `+ ${count} more job${count === 1 ? "" : "s"} tracked`,
    moreSources: (count: number) => `+ ${count} more source${count === 1 ? "" : "s"} with issues`,
    recentJobs: "Recent jobs",
    retry: "Retry all",
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
    }
  },
  "zh-Hans": {
    active: (count: number) => `${count} 个后台任务正在运行`,
    activeDetail: "任务完成后 Curioflow 会刷新当前视图。",
    activeProgress: (type: string, detail: string) => `${type}：${detail}`,
    details: "详情",
    failed: (count: number) => `${count} 个后台任务失败`,
    failedFallback: "展开详情，或重试所有失败的后台任务。",
    failedDetail: (type: string, error: string | null) => `${type}：${error ?? "重试所有失败的后台任务。"}`,
    label: "后台任务状态",
    moreJobs: (count: number) => `还有 ${count} 个任务`,
    moreSources: (count: number) => `还有 ${count} 个来源异常`,
    recentJobs: "最近任务",
    retry: "全部重试",
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
    }
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
    generate_summary: "Summary",
    ingest_url: "Article ingest",
    parse_pdf: "PDF parse",
    refetch_article: "Article refetch",
    transcribe_podcast: "Podcast transcript"
  },
  "zh-Hans": {
    fetch_source: "来源导入",
    generate_summary: "摘要",
    ingest_url: "文章抓取",
    parse_pdf: "PDF 解析",
    refetch_article: "文章重抓取",
    transcribe_podcast: "播客转写"
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
  if (!value) return locale === "zh-Hans" ? "运行中" : "running";
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
    <section className={`jobStatusStrip ${hasIssue ? "hasIssue" : "isActive"}`} aria-label={copy.label}>
      <span className="jobStatusDot" aria-hidden="true" />
      <div className="jobStatusContent">
        <div className="jobStatusPrimary">
          <strong>{title}</strong>
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
        <form action={retryFailedBackgroundJobsAction} className="jobStatusRetryForm">
          <button className="jobStatusAction" type="submit">{copy.retry}</button>
        </form>
      ) : null}
    </section>
  );
}
