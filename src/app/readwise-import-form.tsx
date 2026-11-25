"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_READWISE_BYTES, parseReadwiseCsv, type ReadwiseArticle } from "@/lib/readwise-csv";
import { pickLocale, type SystemLanguage } from "@/app/i18n";

type ReadwiseCopy = {
  fileTooLarge: string;
  chooseLabel: string;
  help: string;
  found: (total: number, archived: number) => string;
  progress: (done: number, total: number, counts: { imported: number; existing: number; invalid: number; failed: number }) => string;
  backgroundNote: string;
  importing: string;
  resume: string;
  importArticles: string;
};

const READWISE_COPY: Record<SystemLanguage, ReadwiseCopy> = {
  en: {
    fileTooLarge: "File must be 10 MB or smaller.",
    chooseLabel: "Choose a Readwise Reader CSV export",
    help: "Up to 10 MB. Existing URLs are skipped. Archive status, saved dates and reading progress are preserved; other articles go to Library. Tags and highlights are not imported.",
    found: (total, archived) => `${total.toLocaleString()} articles found, including ${archived.toLocaleString()} archived.`,
    progress: (done, total, counts) => `Processed ${done} / ${total}: ${counts.imported} imported, ${counts.existing} existing, ${counts.invalid} invalid URLs, ${counts.failed} failed.`,
    backgroundNote: "Content and summaries are processed in the background. Reselect the file to retry failed entries.",
    importing: "Importing… keep this page open",
    resume: "Resume import",
    importArticles: "Import articles"
  },
  "zh-Hans": {
    fileTooLarge: "文件不能超过 10 MB",
    chooseLabel: "选择 Readwise Reader 导出的 CSV",
    help: "最多 10 MB。已有 URL 自动跳过；保留归档状态、保存时间和阅读进度。其余文章进入 Library。暂不导入标签和高亮。",
    found: (total, archived) => `找到 ${total} 篇文章，其中 ${archived} 篇已归档。`,
    progress: (done, total, counts) => `已处理 ${done} / ${total}：新增 ${counts.imported}，已存在 ${counts.existing}，无效 URL ${counts.invalid}，失败 ${counts.failed}。`,
    backgroundNote: "正文和摘要将在后台处理；失败条目可重新选择文件重试。",
    importing: "正在导入…请保持页面打开",
    resume: "继续导入",
    importArticles: "导入文章"
  },
  "zh-Hant": {
    fileTooLarge: "檔案不能超過 10 MB",
    chooseLabel: "選擇 Readwise Reader 匯出的 CSV",
    help: "最多 10 MB。既有 URL 會自動略過；保留封存狀態、儲存時間與閱讀進度。其餘文章進入資料庫。暫不匯入標籤與重點。",
    found: (total, archived) => `找到 ${total} 篇文章，其中 ${archived} 篇已封存。`,
    progress: (done, total, counts) => `已處理 ${done} / ${total}：新增 ${counts.imported}，已存在 ${counts.existing}，無效 URL ${counts.invalid}，失敗 ${counts.failed}。`,
    backgroundNote: "內文與摘要將在背景處理；失敗項目可重新選擇檔案重試。",
    importing: "正在匯入…請保持頁面開啟",
    resume: "繼續匯入",
    importArticles: "匯入文章"
  },
  ja: {
    fileTooLarge: "ファイルサイズは 10 MB 以下にしてください。",
    chooseLabel: "Readwise Reader からエクスポートした CSV を選択",
    help: "最大 10 MB。既存の URL はスキップされます。アーカイブ状態、保存日時、読書進捗は引き継がれ、その他の記事はライブラリに追加されます。タグとハイライトはインポートされません。",
    found: (total, archived) => `${total.toLocaleString()} 件の記事が見つかりました（アーカイブ済み ${archived.toLocaleString()} 件）。`,
    progress: (done, total, counts) => `${done} / ${total} 件処理済み：インポート ${counts.imported}、既存 ${counts.existing}、無効な URL ${counts.invalid}、失敗 ${counts.failed}。`,
    backgroundNote: "本文と要約はバックグラウンドで処理されます。失敗した項目はファイルを再選択して再試行できます。",
    importing: "インポート中…このページを開いたままにしてください",
    resume: "インポートを再開",
    importArticles: "記事をインポート"
  },
  ko: {
    fileTooLarge: "파일 크기는 10 MB 이하여야 합니다.",
    chooseLabel: "Readwise Reader에서 내보낸 CSV 선택",
    help: "최대 10 MB. 기존 URL은 건너뜁니다. 보관 상태, 저장 날짜, 읽기 진행률은 유지되며 나머지 글은 라이브러리로 이동합니다. 태그와 하이라이트는 가져오지 않습니다.",
    found: (total, archived) => `글 ${total.toLocaleString()}개를 찾았습니다(보관됨 ${archived.toLocaleString()}개).`,
    progress: (done, total, counts) => `${done} / ${total}건 처리됨: 가져옴 ${counts.imported}, 기존 ${counts.existing}, 잘못된 URL ${counts.invalid}, 실패 ${counts.failed}.`,
    backgroundNote: "본문과 요약은 백그라운드에서 처리됩니다. 실패한 항목은 파일을 다시 선택해 재시도할 수 있습니다.",
    importing: "가져오는 중… 이 페이지를 열어 두세요",
    resume: "가져오기 재개",
    importArticles: "글 가져오기"
  }
};

export function ReadwiseImportForm({ locale }: { locale: SystemLanguage }) {
  const copy = pickLocale(locale, READWISE_COPY);
  const router = useRouter();
  const [articles, setArticles] = useState<ReadwiseArticle[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(0);
  const [counts, setCounts] = useState({ imported: 0, existing: 0, invalid: 0, failed: 0 });
  async function load(file?: File) {
    setArticles([]); setDone(0); setError(""); setCounts({ imported: 0, existing: 0, invalid: 0, failed: 0 });
    if (!file) return;
    try {
      if (file.size > MAX_READWISE_BYTES) throw new Error(copy.fileTooLarge);
      setArticles(parseReadwiseCsv(await file.text()));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to read CSV"); }
  }
  async function start() {
    setBusy(true); setError("");
    try {
      for (let offset = done; offset < articles.length; offset += 50) {
        const response = await fetch("/api/uploads/readwise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ articles: articles.slice(offset, offset + 50) }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Import failed");
        setCounts(current => ({ imported: current.imported + result.imported, existing: current.existing + result.existing, invalid: current.invalid + result.invalid, failed: current.failed + result.failed }));
        setDone(Math.min(offset + 50, articles.length));
      }
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed"); }
    finally { setBusy(false); }
  }
  return <div className="sourceForm">
    <label htmlFor="readwise-csv">{copy.chooseLabel}</label>
    <input id="readwise-csv" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => void load(event.target.files?.[0])} />
    <small>{copy.help}</small>
    {articles.length > 0 && <p>{copy.found(articles.length, articles.filter(row => row.archived).length)}</p>}
    {done > 0 && <div role="status" aria-live="polite">
      <p>{copy.progress(done, articles.length, counts)}</p>
      <small>{copy.backgroundNote}</small>
    </div>}
    {error && <p className="sourceError" role="alert">{error}</p>}
    <button type="button" disabled={busy || !articles.length || done === articles.length} onClick={() => void start()}>{busy ? copy.importing : done > 0 && done < articles.length ? copy.resume : copy.importArticles}</button>
  </div>;
}
