"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useEffect, useState } from "react";
import { pickLocale, type SystemLanguage } from "@/app/i18n";
import type { TaskFilter, TaskMonitorSnapshot } from "@/server/task-monitor";
import { TASK_FAILURE_TYPES, isTaskFailureType, type TaskFailureFilter, type TaskFailureType } from "@/server/task-monitor-state";

type BackgroundTaskCopy = {
  title: string;
  intro: string;
  scheduler: string;
  newsletter: string;
  online: string;
  offline: string;
  degraded: string;
  unknown: string;
  disabled: string;
  cancelled: string;
  all: string;
  queued: string;
  running: string;
  succeeded: string;
  failed: string;
  taskFailed: string;
  refresh: string;
  retry: string;
  retrying: string;
  retryQueued: string;
  loadError: string;
  retryError: string;
  loading: string;
  empty: string;
  emptyFailures: string;
  recent: string;
  scope: string;
  failureTypes: Record<TaskFailureType, string>;
  allFailures: string;
  articleIssues: string;
  retryCategory: string;
  retryable: string;
  retrySkipped: string;
  bulkQueued: (queued: number, skipped: number) => string;
  live: string;
  day: string;
  updated: string;
  checked: string;
  never: string;
  created: string;
  started: string;
  finished: string;
  nextRetry: string;
  attempts: string;
  recovering: string;
  overdue: string;
  oldest: string;
  source: string;
  task: string;
  workerHelp: string;
  failures: {
    entitlement: string;
    network: string;
    parser: string;
    provider: string;
    retry: string;
    timeout: string;
    unknown: string;
  };
  types: {
    fetch_source: string;
    ingest_newsletter: string;
    ingest_url: string;
    refetch_article: string;
    translate_article: string;
    generate_summary: string;
    parse_pdf: string;
    export_account: string;
  };
  outcomes: {
    source_inactive: string;
    blocked: string;
    duplicate: string;
    ingested: string;
    quarantined: string;
    rejected: string;
  };
};

const copy: Record<SystemLanguage, BackgroundTaskCopy> = {
  "zh-Hans": {
    title: "后台任务", intro: "查看订阅抓取、邮件接收和内容处理的近期状况。",
    scheduler: "任务调度", newsletter: "邮件接收", online: "正常运行", offline: "心跳中断", degraded: "检查异常", unknown: "尚未收到心跳", disabled: "未配置",
    cancelled: "已取消", all: "全部", queued: "等待中", running: "运行中", succeeded: "已完成", failed: "失败", taskFailed: "任务失败",
    refresh: "刷新", retry: "重试", retrying: "提交中…", retryQueued: "已加入队列，将由后台继续处理。",
    loadError: "暂时无法更新任务状况，请稍后刷新。", retryError: "无法重试。任务可能已被处理，或该来源已有任务正在运行。",
    loading: "正在加载任务…", empty: "这段时间没有符合条件的任务。", emptyFailures: "此类别暂无失败记录。",
    recent: "近期任务", scope: "近期任务显示最近 24 小时及更早的待处理任务。失败分类包含全部当前问题，文章按当前状态去重，每组最多显示 100 条。批量重试覆盖该类全部可重试记录。每 10 秒更新。",
    failureTypes: { summary: "摘要失败", article_fetch: "文章抓取失败", source_fetch: "订阅抓取失败", other: "其他失败" }, allFailures: "全部失败", articleIssues: "有问题的文章", retryCategory: "重试此类全部失败", retryable: "待重试记录", retrySkipped: "已跳过已在处理、无法重试或状态已变化的记录。",
    bulkQueued: (queued: number, skipped: number) => `已加入队列 ${queued} 条，跳过 ${skipped} 条。`,
    live: "当前", day: "24 小时", updated: "更新于", checked: "最近成功检查", never: "暂无记录",
    created: "创建", started: "开始", finished: "结束", nextRetry: "下次重试", attempts: "尝试次数", recovering: "等待恢复",
    overdue: "个订阅逾期超过 5 分钟", oldest: "最早排队时间", source: "来源", task: "任务",
    workerHelp: "部分后台检查尚未成功。请查看连接设置，或稍后刷新。",
    failures: {
      entitlement: "权限或配额限制", network: "网络或来源请求失败", parser: "内容解析失败",
      provider: "内容处理服务异常", retry: "已达到重试次数上限", timeout: "处理超时", unknown: "处理失败，请重试或检查服务端日志"
    },
    types: { fetch_source: "订阅抓取", ingest_newsletter: "邮件解析", ingest_url: "文章导入", refetch_article: "全文更新", translate_article: "文章翻译", generate_summary: "摘要生成", parse_pdf: "PDF 解析", export_account: "资料导出" },
    outcomes: { source_inactive: "订阅已停止，跳过抓取", blocked: "来源已屏蔽", duplicate: "重复邮件，已跳过", ingested: "邮件已入库", quarantined: "邮件已隔离", rejected: "邮件已拒收" }
  },
  "zh-Hant": {
    title: "背景任務", intro: "查看訂閱抓取、郵件接收與內容處理的近期狀況。",
    scheduler: "任務排程", newsletter: "郵件接收", online: "正常運作", offline: "心跳中斷", degraded: "檢查異常", unknown: "尚未收到心跳", disabled: "未設定",
    cancelled: "已取消", all: "全部", queued: "等待中", running: "執行中", succeeded: "已完成", failed: "失敗", taskFailed: "任務失敗",
    refresh: "重新整理", retry: "重試", retrying: "提交中…", retryQueued: "已加入佇列，將由背景繼續處理。",
    loadError: "暫時無法更新任務狀況，請稍後重新整理。", retryError: "無法重試。任務可能已被處理，或此來源已有任務正在執行。",
    loading: "正在載入任務…", empty: "這段時間沒有符合條件的任務。", emptyFailures: "此類別暫無失敗記錄。",
    recent: "近期任務", scope: "近期任務顯示最近 24 小時及更早的待處理任務。失敗分類包含全部目前問題，文章按目前狀態去重，每組最多顯示 100 筆。批次重試涵蓋該類全部可重試記錄。每 10 秒更新。",
    failureTypes: { summary: "摘要失敗", article_fetch: "文章抓取失敗", source_fetch: "訂閱抓取失敗", other: "其他失敗" }, allFailures: "全部失敗", articleIssues: "有問題的文章", retryCategory: "重試此類全部失敗", retryable: "待重試記錄", retrySkipped: "已略過已在處理、無法重試或狀態已變更的記錄。",
    bulkQueued: (queued: number, skipped: number) => `已加入佇列 ${queued} 筆，略過 ${skipped} 筆。`,
    live: "目前", day: "24 小時", updated: "更新於", checked: "最近成功檢查", never: "暫無記錄",
    created: "建立", started: "開始", finished: "結束", nextRetry: "下次重試", attempts: "嘗試次數", recovering: "等待恢復",
    overdue: "個訂閱逾期超過 5 分鐘", oldest: "最早排隊時間", source: "來源", task: "任務",
    workerHelp: "部分背景檢查尚未成功。請查看連線設定，或稍後重新整理。",
    failures: {
      entitlement: "權限或配額限制", network: "網路或來源請求失敗", parser: "內容解析失敗",
      provider: "內容處理服務異常", retry: "已達到重試次數上限", timeout: "處理逾時", unknown: "處理失敗，請重試或檢查伺服器日誌"
    },
    types: { fetch_source: "訂閱抓取", ingest_newsletter: "郵件解析", ingest_url: "文章匯入", refetch_article: "全文更新", translate_article: "文章翻譯", generate_summary: "摘要產生", parse_pdf: "PDF 解析", export_account: "資料匯出" },
    outcomes: { source_inactive: "訂閱已停止，略過抓取", blocked: "來源已封鎖", duplicate: "重複郵件，已略過", ingested: "郵件已匯入", quarantined: "郵件已隔離", rejected: "郵件已拒收" }
  },
  ja: {
    title: "バックグラウンドタスク", intro: "購読の取得、受信メール、コンテンツ処理の最近の状況を表示します。",
    scheduler: "タスクスケジューラ", newsletter: "受信メール", online: "正常", offline: "ハートビート途絶", degraded: "チェック異常", unknown: "ハートビート未受信", disabled: "未設定",
    cancelled: "キャンセル済み", all: "すべて", queued: "待機中", running: "実行中", succeeded: "完了", failed: "失敗", taskFailed: "タスク失敗",
    refresh: "更新", retry: "再試行", retrying: "追加中…", retryQueued: "バックグラウンド処理のキューに追加しました。",
    loadError: "タスク状況を更新できませんでした。しばらくしてから更新してください。", retryError: "再試行できません。タスクの状態が変わったか、このソースで別のタスクが実行中です。",
    loading: "タスクを読み込み中…", empty: "この期間に該当するタスクはありません。", emptyFailures: "このカテゴリに該当する失敗はありません。",
    recent: "最近のタスク", scope: "最近のアクティビティには過去 24 時間とそれ以前の未処理タスクが表示されます。失敗カテゴリには現在の問題すべてが含まれ、記事ごとに重複排除して各グループ最大 100 件を表示します。一括再試行は対象カテゴリ内の再試行可能な全レコードを実行します。10 秒ごとに更新されます。",
    failureTypes: { summary: "要約失敗", article_fetch: "記事取得失敗", source_fetch: "購読取得失敗", other: "その他の失敗" }, allFailures: "すべての失敗", articleIssues: "問題のある記事", retryCategory: "このカテゴリをすべて再試行", retryable: "件が再試行可能", retrySkipped: "処理中、再試行不可、または状態変更済みのレコードはスキップされました。",
    bulkQueued: (queued: number, skipped: number) => `${queued} 件をキューに追加、${skipped} 件をスキップしました。`,
    live: "現在", day: "24時間", updated: "更新", checked: "最終正常確認", never: "記録なし",
    created: "作成", started: "開始", finished: "終了", nextRetry: "次回再試行", attempts: "試行回数", recovering: "回復待ち",
    overdue: "件の購読が 5 分以上遅延しています", oldest: "最古の待機タスク", source: "ソース", task: "タスク",
    workerHelp: "一部のバックグラウンドチェックが成功していません。接続設定を確認するか、しばらくしてから更新してください。",
    failures: {
      entitlement: "権限またはクォータ制限", network: "ネットワークまたはソースへのリクエストに失敗", parser: "コンテンツの解析に失敗",
      provider: "処理サービスでエラーが発生", retry: "再試行回数の上限に達しました", timeout: "処理がタイムアウトしました", unknown: "処理に失敗しました。再試行するかサーバーログを確認してください"
    },
    types: { fetch_source: "購読の取得", ingest_newsletter: "メール解析", ingest_url: "記事インポート", refetch_article: "記事の再取得", translate_article: "記事の翻訳", generate_summary: "要約の生成", parse_pdf: "PDF 解析", export_account: "ライブラリ書き出し" },
    outcomes: { source_inactive: "無効な購読をスキップ", blocked: "ソースはブロック済み", duplicate: "重複メールをスキップ", ingested: "メールを取り込み済み", quarantined: "メールを隔離済み", rejected: "メールを拒否済み" }
  },
  ko: {
    title: "백그라운드 작업", intro: "구독 가져오기, 수신 이메일 및 콘텐츠 처리의 최근 활동입니다.",
    scheduler: "작업 스케줄러", newsletter: "수신 이메일", online: "정상", offline: "하트비트 끊김", degraded: "점검 실패", unknown: "하트비트 없음", disabled: "설정되지 않음",
    cancelled: "취소됨", all: "전체", queued: "대기 중", running: "실행 중", succeeded: "완료됨", failed: "실패", taskFailed: "작업 실패",
    refresh: "새로고침", retry: "재시도", retrying: "대기열 추가 중…", retryQueued: "백그라운드 처리 대기열에 추가되었습니다.",
    loadError: "작업 상태를 업데이트할 수 없습니다. 잠시 후 새로고침해 주세요.", retryError: "재시도할 수 없습니다. 작업 상태가 변경되었거나 이 소스에 이미 실행 중인 작업이 있습니다.",
    loading: "작업 불러오는 중…", empty: "이 기간에 일치하는 작업이 없습니다.", emptyFailures: "이 분류에 해당하는 실패 기록이 없습니다.",
    recent: "최근 작업", scope: "최근 활동에는 지난 24시간과 이전의 대기 중인 작업이 표시됩니다. 실패 분류에는 현재 모든 문제가 포함되며, 글별로 중복을 제거해 그룹당 최대 100건을 표시합니다. 일괄 재시도는 해당 분류의 재시도 가능한 모든 항목을 처리합니다. 10초마다 갱신됩니다.",
    failureTypes: { summary: "요약 실패", article_fetch: "글 가져오기 실패", source_fetch: "구독 가져오기 실패", other: "기타 실패" }, allFailures: "전체 실패", articleIssues: "문제가 있는 글", retryCategory: "이 분류 전체 재시도", retryable: "개 재시도 가능", retrySkipped: "이미 처리 중이거나 재시도할 수 없거나 상태가 변경된 항목은 건너뛰었습니다.",
    bulkQueued: (queued: number, skipped: number) => `${queued}건 대기열 추가, ${skipped}건 건너뜀.`,
    live: "현재", day: "24시간", updated: "업데이트", checked: "마지막 정상 확인", never: "기록 없음",
    created: "생성", started: "시작", finished: "완료", nextRetry: "다음 재시도", attempts: "시도 횟수", recovering: "복구 대기 중",
    overdue: "개 구독이 5분 이상 지연됨", oldest: "가장 오래된 대기 작업", source: "소스", task: "작업",
    workerHelp: "일부 백그라운드 점검이 성공하지 못했습니다. 연결 설정을 확인하거나 잠시 후 새로고침하세요.",
    failures: {
      entitlement: "권한 또는 할당량 제한", network: "네트워크 또는 소스 요청 실패", parser: "콘텐츠 파싱 실패",
      provider: "처리 서비스 오류", retry: "재시도 횟수 초과", timeout: "처리 시간 초과", unknown: "처리에 실패했습니다. 재시도하거나 서버 로그를 확인하세요"
    },
    types: { fetch_source: "구독 가져오기", ingest_newsletter: "이메일 파싱", ingest_url: "글 가져오기", refetch_article: "글 새로고침", translate_article: "글 번역", generate_summary: "요약 생성", parse_pdf: "PDF 파싱", export_account: "라이브러리 내보내기" },
    outcomes: { source_inactive: "비활성 구독 건너뜀", blocked: "차단된 소스", duplicate: "중복 이메일 건너뜀", ingested: "이메일 가져옴", quarantined: "이메일 격리됨", rejected: "이메일 거부됨" }
  },
  en: {
    title: "Background tasks", intro: "Recent activity for subscriptions, incoming email, and content processing.",
    scheduler: "Task scheduler", newsletter: "Incoming email", online: "Healthy", offline: "Heartbeat lost", degraded: "Check failing", unknown: "No heartbeat yet", disabled: "Not configured",
    cancelled: "Cancelled", all: "All", queued: "Queued", running: "Running", succeeded: "Completed", failed: "Failed", taskFailed: "Task failed",
    refresh: "Refresh", retry: "Retry", retrying: "Queuing…", retryQueued: "Queued for background processing.",
    loadError: "Unable to update task activity. Please refresh shortly.", retryError: "Unable to retry. The task may have changed or this source already has an active task.",
    loading: "Loading tasks…", empty: "No matching tasks in this period.", emptyFailures: "No matching failures in this category.",
    recent: "Recent tasks", scope: "Recent activity covers the last 24 hours plus older pending tasks. Failure categories include all current issues, with each affected article shown once and up to 100 rows per group. Bulk retry covers every retryable record in the category. Updates every 10 seconds.",
    failureTypes: { summary: "Summary fail", article_fetch: "Article fetch fail", source_fetch: "Subscription fetch fail", other: "Other fail" }, allFailures: "All failures", articleIssues: "Articles with issues", retryCategory: "Retry all in this category", retryable: "retry candidates", retrySkipped: "Skipped records are already processing, cannot be retried, or have changed state.",
    bulkQueued: (queued: number, skipped: number) => `Queued ${queued}; skipped ${skipped}.`,
    live: "Now", day: "24 hours", updated: "Updated", checked: "Last successful check", never: "No record",
    created: "Created", started: "Started", finished: "Finished", nextRetry: "Next retry", attempts: "Attempts", recovering: "Awaiting recovery",
    overdue: "subscriptions overdue by more than 5 minutes", oldest: "Oldest queued", source: "Source", task: "Task",
    workerHelp: "Some background checks have not succeeded. Review your connections or refresh shortly.",
    failures: {
      entitlement: "Permission or quota limit", network: "Network or source request failed", parser: "Content parsing failed",
      provider: "Processing service failed", retry: "Retry limit reached", timeout: "Processing timed out", unknown: "Processing failed. Retry or check server logs"
    },
    types: { fetch_source: "Fetch subscription", ingest_newsletter: "Parse email", ingest_url: "Import article", refetch_article: "Refresh article", translate_article: "Translate article", generate_summary: "Generate summary", parse_pdf: "Parse PDF", export_account: "Export library" },
    outcomes: { source_inactive: "Inactive subscription skipped", blocked: "Source blocked", duplicate: "Duplicate email skipped", ingested: "Email imported", quarantined: "Email quarantined", rejected: "Email rejected" }
  }
};

export function BackgroundTaskSettings({ active, locale }: { active: boolean; locale: SystemLanguage }) {
  const text = pickLocale(locale, copy);
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const filter: TaskFilter = status === "queued" || status === "running" || status === "succeeded" || status === "failed" ? status : "all";
  const failureType = searchParams.get("failureType");
  const failureFilter: TaskFailureFilter = filter === "failed" && isTaskFailureType(failureType) ? failureType : "all";
  const [result, setResult] = useState<{
    snapshot: TaskMonitorSnapshot;
    filter: TaskFilter;
    failureFilter: TaskFailureFilter;
    viewKey: string;
  } | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const viewKey = `${filter}:${filter === "failed" ? failureFilter : "all"}`;
  const data = result?.snapshot ?? null;
  const isChangingView = Boolean(data && result?.viewKey !== viewKey);
  const isLoadingView = isChangingView && !error;
  const displayedFilter = result?.filter ?? filter;
  const displayedFailureFilter = result?.failureFilter ?? failureFilter;

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
        if (!controller.signal.aborted) {
          setResult({ snapshot, filter, failureFilter: filter === "failed" ? failureFilter : "all", viewKey });
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 10_000);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, filter, failureFilter, refresh, viewKey]);

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
    if (value === filter && failureFilter === "all") return;
    updateFilters(value, "all");
  }

  function changeFailureFilter(value: TaskFailureFilter) {
    if (filter === "failed" && value === failureFilter) return;
    updateFilters("failed", value);
  }

  function updateFilters(status: TaskFilter, failure: TaskFailureFilter) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "tasks");
    if (status === "all") url.searchParams.delete("status");
    else url.searchParams.set("status", status);
    if (failure === "all") url.searchParams.delete("failureType");
    else url.searchParams.set("failureType", failure);
    setError(false);
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
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
        <div className="taskMonitorToolbarControls">
          <span className="taskMonitorViewFeedback" role="status">
            {isLoadingView ? <><i className="taskMonitorLoadingSpinner" aria-hidden="true" />{text.loading}</> : null}
          </span>
          <select aria-label={text.recent} value={filter} onChange={event => changeFilter(event.target.value as TaskFilter)}>
            {(["all", "queued", "running", "failed", "succeeded"] as const).map(value => <option value={value} key={value}>{text[value]}</option>)}
          </select>
        </div>
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
          <button type="button" className="taskMonitorButton" disabled={isChangingView || retrying !== null || data.retryableFailureCounts[failureFilter] === 0} onClick={() => void retryCategory(failureFilter)}>
            {retrying === `category:${failureFilter}` ? text.retrying : `${text.retryCategory} · ${text.failureTypes[failureFilter]}`}
          </button>
        </div> : null}
      </section> : null}
      <div className={`taskMonitorResults${isChangingView ? " taskMonitorResults--pending" : ""}`} key={result?.viewKey ?? "initial"} role="region" aria-label={text.recent} aria-busy={isLoadingView} inert={isChangingView}>
      {data?.jobs.length === 0 && (!(displayedFilter === "all" || displayedFilter === "failed") || data.articleIssues.length === 0) ? <p className="taskMonitorEmpty">{displayedFilter === "failed" ? text.emptyFailures : text.empty}</p> : null}
      {(displayedFilter === "all" || displayedFilter === "failed") && data && data.articleIssues.length > 0 ? <section aria-label={text.failed}>
        <h3 className="settingsSubsectionTitle">{displayedFailureFilter === "all" ? text.articleIssues : text.failureTypes[displayedFailureFilter]} · {displayedFailureFilter === "all" ? data.failureCounts.summary + data.failureCounts.article_fetch : data.failureCounts[displayedFailureFilter]}</h3>
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
      {displayedFilter === "failed" && data && data.jobs.length > 0 ? <h3 className="settingsSubsectionTitle">{displayedFailureFilter === "source_fetch" || displayedFailureFilter === "other"
        ? `${text.failureTypes[displayedFailureFilter]} · ${data.failureCounts[displayedFailureFilter]}`
        : `${text.failureTypes.source_fetch} / ${text.failureTypes.other} · ${data.failureCounts.source_fetch + data.failureCounts.other}`}</h3> : null}
      <ol className="taskMonitorList">
        {data?.jobs.map(job => <li key={job.id} className="taskMonitorRow">
          <div className="taskMonitorRowHeader">
            <div>
              <strong>{[text.types[job.type as keyof typeof text.types] ?? text.task, job.sourceName].filter(Boolean).join(" · ")}</strong>
              <span className="taskMonitorType">{job.id.slice(-8)}</span>
            </div>
            <span className={`taskMonitorBadge taskMonitorBadge--${job.status}`}>{job.recovering ? text.recovering : (job.status === "failed" ? text.taskFailed : text[job.status as TaskFilter | "cancelled"] ?? job.status)}{job.status === "running" && job.percent !== null ? ` · ${job.percent}%` : ""}</span>
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
      </div>
    </section>
  );
}
