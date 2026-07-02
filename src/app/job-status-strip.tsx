import type { SystemLanguage } from "@/app/i18n";
import { isActiveJobStatus, isFailedJobStatus } from "@/server/job-state";

type JobStatus = {
  createdAt: Date | string;
  error: string | null;
  id: string;
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
    failed: (count: number) => `${count} background job${count === 1 ? "" : "s"} failed`,
    failedDetail: (type: string, error: string | null) => `${type}: ${error ?? "Open the failed view and retry the item."}`,
    label: "Background work status",
    sourceIssue: (count: number) => `${count} source${count === 1 ? "" : "s"} need attention`,
    sourceIssueDetail: (name: string) => `${name} could not refresh recently.`
  },
  "zh-Hans": {
    active: (count: number) => `${count} 个后台任务正在运行`,
    activeDetail: "任务完成后 Curioflow 会刷新当前视图。",
    failed: (count: number) => `${count} 个后台任务失败`,
    failedDetail: (type: string, error: string | null) => `${type}：${error ?? "打开失败视图并重试该条内容。"}`,
    label: "后台任务状态",
    sourceIssue: (count: number) => `${count} 个来源需要处理`,
    sourceIssueDetail: (name: string) => `${name} 最近无法刷新。`
  }
};

function statusCopy(locale: SystemLanguage) {
  return COPY[locale] ?? COPY.en;
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
    ? copy.failedDetail(firstFailedJob.type, firstFailedJob.error)
    : firstErroredSource
      ? copy.sourceIssueDetail(firstErroredSource.name)
      : copy.activeDetail;

  return (
    <section className={`jobStatusStrip ${hasIssue ? "hasIssue" : "isActive"}`} aria-label={copy.label}>
      <span className="jobStatusDot" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </section>
  );
}
