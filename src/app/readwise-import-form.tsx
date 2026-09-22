"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_READWISE_BYTES, parseReadwiseCsv, type ReadwiseArticle } from "@/lib/readwise-csv";
import type { SystemLanguage } from "@/app/i18n";

export function ReadwiseImportForm({ locale }: { locale: SystemLanguage }) {
  const zh = locale === "zh-Hans";
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
      if (file.size > MAX_READWISE_BYTES) throw new Error(zh ? "文件不能超过 10 MB" : "File must be 10 MB or smaller.");
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
    <label htmlFor="readwise-csv">{zh ? "选择 Readwise Reader 导出的 CSV" : "Choose a Readwise Reader CSV export"}</label>
    <input id="readwise-csv" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => void load(event.target.files?.[0])} />
    <small>{zh ? "最多 10 MB。已有 URL 自动跳过；保留归档状态、保存时间和阅读进度。其余文章进入 Library。暂不导入标签和高亮。" : "Up to 10 MB. Existing URLs are skipped. Archive status, saved dates and reading progress are preserved; other articles go to Library. Tags and highlights are not imported."}</small>
    {articles.length > 0 && <p>{zh ? `找到 ${articles.length} 篇文章，其中 ${articles.filter(row => row.archived).length} 篇已归档。` : `${articles.length.toLocaleString()} articles found, including ${articles.filter(row => row.archived).length.toLocaleString()} archived.`}</p>}
    {done > 0 && <div role="status" aria-live="polite">
      <p>{zh ? `已处理 ${done} / ${articles.length}：新增 ${counts.imported}，已存在 ${counts.existing}，无效 URL ${counts.invalid}，失败 ${counts.failed}。` : `Processed ${done} / ${articles.length}: ${counts.imported} imported, ${counts.existing} existing, ${counts.invalid} invalid URLs, ${counts.failed} failed.`}</p>
      <small>{zh ? "正文和摘要将在后台处理；失败条目可重新选择文件重试。" : "Content and summaries are processed in the background. Reselect the file to retry failed entries."}</small>
    </div>}
    {error && <p className="sourceError" role="alert">{error}</p>}
    <button type="button" disabled={busy || !articles.length || done === articles.length} onClick={() => void start()}>{busy ? (zh ? "正在导入…请保持页面打开" : "Importing… keep this page open") : done > 0 && done < articles.length ? (zh ? "继续导入" : "Resume import") : (zh ? "导入文章" : "Import articles")}</button>
  </div>;
}
