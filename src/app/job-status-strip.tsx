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

const COPY = {
  en: {
    active: (count: number) => `${count} background job${count === 1 ? "" : "s"} running`,
    activeDetail: "Curioflow will refresh this view as work finishes.",
    activeProgress: (type: string, detail: string) => `${type}: ${detail}`,
    failed: (count: number) => `${count} background job${count === 1 ? "" : "s"} failed`,
    failedDetail: (type: string, error: string | null) => `${type}: ${error ?? "Open the failed view and retry the item."}`,
    label: "Background work status",
    retry: "Retry",
    sourceIssue: (count: number) => `${count} source${count === 1 ? "" : "s"} need attention`,
    sourceIssueDetail: (name: string) => `${name} could not refresh recently.`
  },
  "zh-Hans": {
    active: (count: number) => `${count} 个后台任务正在运行`,
    activeDetail: "任务完成后 Curioflow 会刷新当前视图。",
    activeProgress: (type: string, detail: string) => `${type}：${detail}`,
    failed: (count: number) => `${count} 个后台任务失败`,
    failedDetail: (type: string, error: string | null) => `${type}：${error ?? "打开失败视图并重试该条内容。"}`,
    label: "后台任务状态",
    retry: "重试",
    sourceIssue: (count: number) => `${count} 个来源需要处理`,
    sourceIssueDetail: (name: string) => `${name} 最近无法刷新。`
  }
};

function statusCopy(locale: SystemLanguage) {
  return COPY[locale] ?? COPY.en;
}

type JobProgress = {
  current?: unknown;
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
  return statusCopy(locale).failedDetail(
    jobTypeLabel(job.type, locale),
    textValue(progress?.message) ?? job.error
  );
}

export function JobStatusStrip({
  jobs,
  locale,
  sources
}: {
  jobs: JobStatus[];
  locale: SystemLanguage;
  sources: SourceStatus[];
}) {
  const copy = statusCopy(locale);
  const activeJobs = jobs.filter((job) => isActiveJobStatus(job.status));
  const failedJobs = jobs.filter((job) => isFailedJobStatus(job.status));
  const erroredSources = sources.filter((source) => source.status === "error");
  const firstActiveJob = activeJobs[0];
  const firstFailedJob = failedJobs[0];
  const firstErroredSource = erroredSources[0];

  if (activeJobs.length === 0 && failedJobs.length === 0 && erroredSources.length === 0) return null;

  const hasIssue = failedJobs.length > 0 || erroredSources.length > 0;
  const title = failedJobs.length > 0
    ? copy.failed(failedJobs.length)
    : erroredSources.length > 0
      ? copy.sourceIssue(erroredSources.length)
      : copy.active(activeJobs.length);
  const detail = firstFailedJob
    ? failedJobDetail(firstFailedJob, locale)
    : firstErroredSource
      ? copy.sourceIssueDetail(firstErroredSource.name)
      : firstActiveJob
        ? jobProgressDetail(firstActiveJob, locale)
        : copy.activeDetail;

  return (
    <section className={`jobStatusStrip ${hasIssue ? "hasIssue" : "isActive"}`} aria-label={copy.label}>
      <span className="jobStatusDot" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <small title={detail}>{detail}</small>
      </div>
      {failedJobs.length > 0 ? (
        <form action={retryFailedBackgroundJobsAction}>
          <button className="jobStatusAction" type="submit">{copy.retry}</button>
        </form>
      ) : null}
    </section>
  );
}
