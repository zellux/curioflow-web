"use client";

import Link from "next/link";

import { useEffect, useState } from "react";
import type { SystemLanguage } from "@/app/i18n";
import type { TaskFilter, TaskMonitorSnapshot } from "@/server/task-monitor";
import { TASK_FAILURE_TYPES, type TaskFailureFilter, type TaskFailureType } from "@/server/task-monitor-state";

const copy = {
  "zh-Hans": {
    title: "后台任务", intro: "查看订阅抓取、邮件接收和内容处理的近期状况。",
    scheduler: "任务调度", newsletter: "邮件接收", online: "正常运行", offline: "心跳中断", degraded: "检查异常", unknown: "尚未收到心跳", disabled: "未配置",
    cancelled: "已取消", all: "全部", queued: "等待中", running: "运行中", succeeded: "已完成", failed: "失败",
    refresh: "刷新", retry: "重试", retrying: "提交中…", retryQueued: "已加入队列，将由后台继续处理。",
    loadError: "暂时无法更新任务状况，请稍后刷新。", retryError: "无法重试。任务可能已被处理，或该来源已有任务正在运行。",
    loading: "正在加载任务…", empty: "这段时间没有符合条件的任务。", emptyFailures: "此类别暂无失败记录。",
    recent: "近期任务", scope: "近期任务显示最近 24 小时及更早的待处理任务。失败分类包含全部当前问题，文章按当前状态去重，每组最多显示 100 条。批量重试覆盖该类全部可重试记录。每 10 秒更新。",
    failureTypes: { summary: "摘要失败", article_fetch: "文章抓取失败", other: "其他失败" }, allFailures: "全部失败", articleIssues: "有问题的文章", retryCategory: "重试此类全部失败", retryable: "待重试记录", retrySkipped: "已跳过已在处理、无法重试或状态已变化的记录。",
    bulkQueued: (queued: number, skipped: number) => `已加入队列 ${queued} 条，跳过 ${skipped} 条。`,
    live: "当前", day: "24 小时", updated: "更新于", checked: "最近成功检查", never: "暂无记录",
    created: "创建", started: "开始", finished: "结束", nextRetry: "下次重试", attempts: "尝试次数", recovering: "等待恢复",
    overdue: "个订阅逾期超过 5 分钟", oldest: "最早排队时间", source: "来源", task: "任务",
    workerHelp: "部分后台检查尚未成功。请查看连接设置，或稍后刷新。",
    failures: {
      entitlement: "权限或配额限制", network: "网络或来源请求失败", parser: "内容解析失败",
      provider: "内容处理服务异常", retry: "已达到重试次数上限", timeout: "处理超时", unknown: "处理失败，请重试或检查服务端日志"
    },
    types: { fetch_source: "订阅抓取", ingest_newsletter: "邮件解析", ingest_url: "文章导入", refetch_article: "全文更新", generate_summary: "摘要生成", parse_pdf: "PDF 解析", export_account: "资料导出" },
    outcomes: { source_inactive: "订阅已停止，跳过抓取", blocked: "来源已屏蔽", duplicate: "重复邮件，已跳过", ingested: "邮件已入库", quarantined: "邮件已隔离", rejected: "邮件已拒收" }
  },
  en: {
    title: "Background tasks", intro: "Recent activity for subscriptions, incoming email, and content processing.",
    scheduler: "Task scheduler", newsletter: "Incoming email", online: "Healthy", offline: "Heartbeat lost", degraded: "Check failing", unknown: "No heartbeat yet", disabled: "Not configured",
    cancelled: "Cancelled", all: "All", queued: "Queued", running: "Running", succeeded: "Completed", failed: "Failed",
    refresh: "Refresh", retry: "Retry", retrying: "Queuing…", retryQueued: "Queued for background processing.",
    loadError: "Unable to update task activity. Please refresh shortly.", retryError: "Unable to retry. The task may have changed or this source already has an active task.",
    loading: "Loading tasks…", empty: "No matching tasks in this period.", emptyFailures: "No matching failures in this category.",
    recent: "Recent tasks", scope: "Recent activity covers the last 24 hours plus older pending tasks. Failure categories include all current issues, with each affected article shown once and up to 100 rows per group. Bulk retry covers every retryable record in the category. Updates every 10 seconds.",
    failureTypes: { summary: "Summary fail", article_fetch: "Article fetch fail", other: "Other fail" }, allFailures: "All failures", articleIssues: "Articles with issues", retryCategory: "Retry all in this category", retryable: "retry candidates", retrySkipped: "Skipped records are already processing, cannot be retried, or have changed state.",
    bulkQueued: (queued: number, skipped: number) => `Queued ${queued}; skipped ${skipped}.`,
    live: "Now", day: "24 hours", updated: "Updated", checked: "Last successful check", never: "No record",
    created: "Created", started: "Started", finished: "Finished", nextRetry: "Next retry", attempts: "Attempts", recovering: "Awaiting recovery",
    overdue: "subscriptions overdue by more than 5 minutes", oldest: "Oldest queued", source: "Source", task: "Task",
    workerHelp: "Some background checks have not succeeded. Review your connections or refresh shortly.",
    failures: {
      entitlement: "Permission or quota limit", network: "Network or source request failed", parser: "Content parsing failed",
      provider: "Processing service failed", retry: "Retry limit reached", timeout: "Processing timed out", unknown: "Processing failed. Retry or check server logs"
    },
    types: { fetch_source: "Fetch subscription", ingest_newsletter: "Parse email", ingest_url: "Import article", refetch_article: "Refresh article", generate_summary: "Generate summary", parse_pdf: "Parse PDF", export_account: "Export library" },
    outcomes: { source_inactive: "Inactive subscription skipped", blocked: "Source blocked", duplicate: "Duplicate email skipped", ingested: "Email imported", quarantined: "Email quarantined", rejected: "Email rejected" }
  }
};

export function BackgroundTaskSettings({ active, locale, initialFilter = "all" }: { active: boolean; locale: SystemLanguage; initialFilter?: TaskFilter }) {
  const text = copy[locale === "zh-Hans" ? "zh-Hans" : "en"];
  const [filter, setFilter] = useState<TaskFilter>(initialFilter);
  const [failureFilter, setFailureFilter] = useState<TaskFailureFilter>("all");
  const [data, setData] = useState<TaskMonitorSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        if (document.visibilityState === "hidden") return;
        const response = await fetch(`/api/settings/tasks?status=${filter}&failureType=${filter === "failed" ? failureFilter : "all"}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
        });
        if (!response.ok) throw new Error("Task monitor unavailable");
        const snapshot = await response.json() as TaskMonitorSnapshot;
        if (!controller.signal.aborted) { setData(snapshot); setError(false); }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 10_000);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, filter, failureFilter, refresh]);

  const date = (value: string | null) => value ? new Intl.DateTimeFormat(locale, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(new Date(value)) : text.never;

  async function retry(jobId: string) {
    setRetrying(jobId); setNotice(null);
    try {
      const response = await fetch("/api/settings/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }), signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error("Retry rejected");
      setNotice({ error: false, message: text.retryQueued }); setRefresh(value => value + 1);
    } catch { setNotice({ error: true, message: text.retryError }); }
    finally { setRetrying(null); }
  }

  function changeFilter(value: TaskFilter) {
    setFilter(value); setFailureFilter("all"); setData(null);
  }

  function changeFailureFilter(value: TaskFailureFilter) {
    setFilter("failed"); setFailureFilter(value); setData(null);
  }

  async function retryCategory(failureType: TaskFailureType) {
    setRetrying(`category:${failureType}`); setNotice(null);
    try {
      const response = await fetch("/api/settings/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ failureType }), signal: AbortSignal.timeout(60_000)
      });
      if (!response.ok) throw new Error("Retry rejected");
      const result = await response.json() as { queued: number; skipped: number };
      setNotice({ error: false, message: `${text.bulkQueued(result.queued, result.skipped)}${result.skipped ? ` ${text.retrySkipped}` : ""}` });
      setRefresh(value => value + 1);
    } catch { setNotice({ error: true, message: text.retryError }); }
    finally { setRetrying(null); }
  }

  return (
    <section className="settingsSection settingsPanelPane settingsPanelPane--tasks">
      <div className="taskMonitorHeading">
        <h2 className="settingsPaneTitle">{text.title}</h2>
        <button type="button" className="taskMonitorButton" onClick={() => setRefresh(value => value + 1)}>{text.refresh}</button>
      </div>
      <p className="settingsIntro">{text.intro}</p>
      {error ? <p role="alert" className="taskMonitorNotice taskMonitorNotice--error">{text.loadError}</p> : null}
      {notice ? <p role={notice.error ? "alert" : "status"} className={`taskMonitorNotice ${notice.error ? "taskMonitorNotice--error" : ""}`}>{notice.message}</p> : null}
      {!data ? <p role="status" className="taskMonitorEmpty">{error ? text.never : text.loading}</p> : <>
        <div className="taskMonitorWorkers">
          {data.workers.map(worker => <div className="taskMonitorWorker" key={worker.id}>
            <div><strong>{text[worker.id]}</strong><span className={`taskMonitorBadge taskMonitorBadge--${worker.status}`}><i aria-hidden="true" />{text[worker.status as keyof Pick<typeof text, "online" | "offline" | "degraded" | "unknown" | "disabled">]}</span></div>
            <small>{text.checked} · {date(worker.lastSuccessAt)}</small>
          </div>)}
        </div>
        {data.workers.some(worker => ["offline", "unknown", "degraded"].includes(worker.status)) ? <p className="taskMonitorHint">{text.workerHelp}</p> : null}
        <div className="taskMonitorCounts">
          {(["queued", "running", "succeeded", "failed"] as const).map(status => <button type="button" aria-pressed={filter === status} key={status} onClick={() => { if (filter !== status) changeFilter(status); }}>
            <span>{text[status]}<small>{status === "succeeded" ? text.day : text.live}</small></span>
            <strong>{data.counts[status]}</strong>
          </button>)}
        </div>
        {data.overdueSources > 0 || data.oldestQueuedAt ? <div className="taskMonitorHint">
          {data.overdueSources > 0 ? <p>{data.overdueSources} {text.overdue}</p> : null}
          {data.oldestQueuedAt ? <p>{text.oldest} · {date(data.oldestQueuedAt)}</p> : null}
        </div> : null}
      </>}
      <div className="taskMonitorToolbar">
        <h3 className="settingsSubsectionTitle">{text.recent}</h3>
        <select aria-label={text.recent} value={filter} onChange={event => changeFilter(event.target.value as TaskFilter)}>
          {(["all", "queued", "running", "failed", "succeeded"] as const).map(value => <option value={value} key={value}>{text[value]}</option>)}
        </select>
      </div>
      <p className="taskMonitorHint">{text.scope}</p>
      {(filter === "all" || filter === "failed") && data ? <section className="taskMonitorFailures" aria-label={text.allFailures}>
        <div className="taskMonitorFailureFilters" role="group" aria-label={text.allFailures}>
          <button type="button" aria-pressed={failureFilter === "all"} onClick={() => changeFailureFilter("all")}>{text.allFailures}<strong>{data.counts.failed}</strong></button>
          {TASK_FAILURE_TYPES.map(type => <button type="button" key={type} aria-pressed={failureFilter === type} onClick={() => changeFailureFilter(type)}>
            {text.failureTypes[type]}<strong>{data.failureCounts[type]}</strong>
          </button>)}
        </div>
        {failureFilter !== "all" ? <div className="taskMonitorBulkRetry">
          <span>{data.retryableFailureCounts[failureFilter]} {text.retryable}</span>
          <button type="button" className="taskMonitorButton" disabled={retrying !== null || data.retryableFailureCounts[failureFilter] === 0} onClick={() => void retryCategory(failureFilter)}>
            {retrying === `category:${failureFilter}` ? text.retrying : `${text.retryCategory} · ${text.failureTypes[failureFilter]}`}
          </button>
        </div> : null}
      </section> : null}
      {data?.jobs.length === 0 && (!(filter === "all" || filter === "failed") || data.articleIssues.length === 0) ? <p className="taskMonitorEmpty">{filter === "failed" ? text.emptyFailures : text.empty}</p> : null}
      {(filter === "all" || filter === "failed") && data && data.articleIssues.length > 0 ? <section aria-label={text.failed}>
        <h3 className="settingsSubsectionTitle">{failureFilter === "all" ? text.articleIssues : text.failureTypes[failureFilter]} · {failureFilter === "all" ? data.failureCounts.summary + data.failureCounts.article_fetch : data.failureCounts[failureFilter]}</h3>
        <ol className="taskMonitorList">
          {data.articleIssues.map(issue => <li key={issue.id} className="taskMonitorRow">
            <div className="taskMonitorRowHeader">
              <Link href={`/item/${issue.id}`}>{issue.title}</Link>
              <span className="taskMonitorBadge taskMonitorBadge--failed">{text.failureTypes[issue.kind === "summary" ? "summary" : "article_fetch"]}</span>
            </div>
            {issue.jobId ? <button type="button" className="taskMonitorButton" disabled={retrying !== null} onClick={() => void retry(issue.jobId!)}>{retrying === issue.jobId ? text.retrying : text.retry}</button> : null}
          </li>)}
        </ol>
      </section> : null}
      {filter === "failed" && data && data.jobs.length > 0 ? <h3 className="settingsSubsectionTitle">{text.failureTypes.other} · {data.failureCounts.other}</h3> : null}
      <ol className="taskMonitorList">
        {data?.jobs.map(job => <li key={job.id} className="taskMonitorRow">
          <div className="taskMonitorRowHeader">
            <div>
              <strong>{job.sourceName ?? text.types[job.type as keyof typeof text.types] ?? text.task}</strong>
              <span className="taskMonitorType">{text.types[job.type as keyof typeof text.types] ?? text.task} · {job.id.slice(-8)}</span>
            </div>
            <span className={`taskMonitorBadge taskMonitorBadge--${job.status}`}>{job.recovering ? text.recovering : (job.status === "failed" ? (locale === "zh-Hans" ? "任务失败" : "Task failed") : text[job.status as TaskFilter | "cancelled"] ?? job.status)}{job.status === "running" && job.percent !== null ? ` · ${job.percent}%` : ""}</span>
          </div>
          <div className="taskMonitorTimes">
            <span>{text.created} · {date(job.createdAt)}</span>
            {job.startedAt ? <span>{text.started} · {date(job.startedAt)}</span> : null}
            {job.finishedAt ? <span>{text.finished} · {date(job.finishedAt)}</span> : null}
            <span>{text.attempts} · {job.attempts}/{job.maxAttempts}</span>
            {job.nextRunAt ? <span>{text.nextRetry} · {date(job.nextRunAt)}</span> : null}
          </div>
          {job.status === "failed" || job.nextRunAt ? <p className="taskMonitorFailure">{text.failures[job.failureCategory as keyof typeof text.failures] ?? text.failures.unknown}</p> : null}
          {job.outcome ? <p className="taskMonitorHint">{text.outcomes[job.outcome as keyof typeof text.outcomes]}</p> : null}
          {job.canRetry ? <button type="button" className="taskMonitorButton" disabled={retrying !== null} onClick={() => void retry(job.id)}>{retrying === job.id ? text.retrying : text.retry}</button> : null}
        </li>)}
      </ol>
      {data ? <p className="taskMonitorHint">{text.updated} · {date(data.updatedAt)}</p> : null}
    </section>
  );
}
