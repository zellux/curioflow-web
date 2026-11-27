"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ARTICLE_IMPORT_SOURCES,
  MAX_ARTICLE_IMPORT_BYTES,
  parseArticleImportCsv,
  type ArticleImportSource,
  type ImportedArticle
} from "@/lib/article-import-csv";
import { pickLocale, type SystemLanguage } from "@/app/i18n";

type ArticleImportCopy = {
  fileTooLarge: string;
  fileType: string;
  fileLimit: string;
  chooseLabel: string;
  replaceLabel: string;
  sourceLabel: string;
  help: Record<ArticleImportSource, string>;
  duplicates: string;
  found: (total: number, archived: number) => string;
  progress: (done: number, total: number, counts: { imported: number; existing: number; invalid: number; failed: number }) => string;
  backgroundNote: string;
  importing: string;
  resume: string;
  retry: string;
  importArticles: string;
};

const IMPORT_COPY: Record<SystemLanguage, ArticleImportCopy> = {
  en: {
    fileTooLarge: "File must be 10 MB or smaller.",
    sourceLabel: "Source",
    fileType: "CSV export",
    fileLimit: "Up to 10 MB",
    chooseLabel: "Choose file",
    replaceLabel: "Change file",
    duplicates: "Existing URLs are skipped.",
    help: {
      readwise: "Upload the library CSV from Readwise Reader. Saved dates, archive status and reading progress are preserved.",
      matter: "In Matter, export your history as CSV. Saved dates and archive status are preserved when present.",
      instapaper: "In Instapaper, use Settings → Export → Download CSV. Saved dates and archive status are preserved.",
      pocket: "Unzip your Pocket backup and upload each CSV in turn. Saved dates and archive status are preserved."
    },
    found: (total, archived) => `${total.toLocaleString()} articles found, including ${archived.toLocaleString()} archived.`,
    progress: (done, total, counts) => `Processed ${done} / ${total}: ${counts.imported} imported, ${counts.existing} existing, ${counts.invalid} invalid URLs, ${counts.failed} failed.`,
    backgroundNote: "Content and summaries are processed in the background.",
    importing: "Importing… keep this page open",
    resume: "Resume import",
    retry: "Retry import",
    importArticles: "Import articles"
  },
  "zh-Hans": {
    fileTooLarge: "文件不能超过 10 MB",
    sourceLabel: "来源",
    fileType: "CSV 导出文件",
    fileLimit: "最多 10 MB",
    chooseLabel: "选择文件",
    replaceLabel: "更换文件",
    duplicates: "自动跳过已有链接。",
    help: {
      readwise: "上传 Readwise Reader 的资料库 CSV，可保留保存日期、归档状态和阅读进度。",
      matter: "在 Matter 中将历史记录导出为 CSV。导出文件中有保存日期和归档状态时会保留。",
      instapaper: "在 Instapaper 的「设置 → 导出」中下载 CSV，可保留保存日期和归档状态。",
      pocket: "解压 Pocket 备份并依次上传其中的 CSV，可保留保存日期和归档状态。"
    },
    found: (total, archived) => `找到 ${total} 篇文章，其中 ${archived} 篇已归档。`,
    progress: (done, total, counts) => `已处理 ${done} / ${total}：新增 ${counts.imported}，已存在 ${counts.existing}，无效 URL ${counts.invalid}，失败 ${counts.failed}。`,
    backgroundNote: "正文和摘要将在后台处理。",
    importing: "正在导入…请保持页面打开",
    resume: "继续导入",
    retry: "重试导入",
    importArticles: "导入文章"
  },
  "zh-Hant": {
    fileTooLarge: "檔案不能超過 10 MB",
    sourceLabel: "來源",
    fileType: "CSV 匯出檔案",
    fileLimit: "最多 10 MB",
    chooseLabel: "選擇檔案",
    replaceLabel: "更換檔案",
    duplicates: "會自動略過既有連結。",
    help: {
      readwise: "上傳 Readwise Reader 的資料庫 CSV，可保留儲存日期、封存狀態與閱讀進度。",
      matter: "在 Matter 中將歷史記錄匯出為 CSV。匯出檔案中有儲存日期和封存狀態時會保留。",
      instapaper: "在 Instapaper 的「設定 → 匯出」中下載 CSV，可保留儲存日期和封存狀態。",
      pocket: "解壓縮 Pocket 備份並依序上傳其中的 CSV，可保留儲存日期和封存狀態。"
    },
    found: (total, archived) => `找到 ${total} 篇文章，其中 ${archived} 篇已封存。`,
    progress: (done, total, counts) => `已處理 ${done} / ${total}：新增 ${counts.imported}，已存在 ${counts.existing}，無效 URL ${counts.invalid}，失敗 ${counts.failed}。`,
    backgroundNote: "內文與摘要將在背景處理。",
    importing: "正在匯入…請保持頁面開啟",
    resume: "繼續匯入",
    retry: "重試匯入",
    importArticles: "匯入文章"
  },
  ja: {
    fileTooLarge: "ファイルサイズは 10 MB 以下にしてください。",
    sourceLabel: "インポート元",
    fileType: "エクスポートした CSV",
    fileLimit: "最大 10 MB",
    chooseLabel: "ファイルを選択",
    replaceLabel: "ファイルを変更",
    duplicates: "既存の URL はスキップされます。",
    help: {
      readwise: "Readwise Reader のライブラリ CSV をアップロードします。保存日、アーカイブ状態、読書進捗を引き継ぎます。",
      matter: "Matter で履歴を CSV にエクスポートします。保存日とアーカイブ状態は、ファイルに含まれている場合に引き継ぎます。",
      instapaper: "Instapaper の設定 → エクスポートから CSV をダウンロードします。保存日とアーカイブ状態を引き継ぎます。",
      pocket: "Pocket のバックアップを解凍し、CSV を順にアップロードします。保存日とアーカイブ状態を引き継ぎます。"
    },
    found: (total, archived) => `${total.toLocaleString()} 件の記事が見つかりました（アーカイブ済み ${archived.toLocaleString()} 件）。`,
    progress: (done, total, counts) => `${done} / ${total} 件処理済み：インポート ${counts.imported}、既存 ${counts.existing}、無効な URL ${counts.invalid}、失敗 ${counts.failed}。`,
    backgroundNote: "本文と要約はバックグラウンドで処理されます。",
    importing: "インポート中…このページを開いたままにしてください",
    resume: "インポートを再開",
    retry: "インポートを再試行",
    importArticles: "記事をインポート"
  },
  ko: {
    fileTooLarge: "파일 크기는 10 MB 이하여야 합니다.",
    sourceLabel: "가져올 서비스",
    fileType: "내보낸 CSV",
    fileLimit: "최대 10 MB",
    chooseLabel: "파일 선택",
    replaceLabel: "파일 변경",
    duplicates: "기존 URL은 건너뜁니다.",
    help: {
      readwise: "Readwise Reader 라이브러리 CSV를 업로드하세요. 저장 날짜, 보관 상태, 읽기 진행률이 유지됩니다.",
      matter: "Matter에서 기록을 CSV로 내보내세요. 파일에 저장 날짜와 보관 상태가 포함되어 있으면 유지됩니다.",
      instapaper: "Instapaper 설정 → 내보내기에서 CSV를 다운로드하세요. 저장 날짜와 보관 상태가 유지됩니다.",
      pocket: "Pocket 백업의 압축을 풀고 CSV를 하나씩 업로드하세요. 저장 날짜와 보관 상태가 유지됩니다."
    },
    found: (total, archived) => `글 ${total.toLocaleString()}개를 찾았습니다(보관됨 ${archived.toLocaleString()}개).`,
    progress: (done, total, counts) => `${done} / ${total}건 처리됨: 가져옴 ${counts.imported}, 기존 ${counts.existing}, 잘못된 URL ${counts.invalid}, 실패 ${counts.failed}.`,
    backgroundNote: "본문과 요약은 백그라운드에서 처리됩니다.",
    importing: "가져오는 중… 이 페이지를 열어 두세요",
    resume: "가져오기 재개",
    retry: "가져오기 다시 시도",
    importArticles: "글 가져오기"
  }
};

const SOURCE_OPTIONS = Object.keys(ARTICLE_IMPORT_SOURCES) as ArticleImportSource[];
const EMPTY_COUNTS = { imported: 0, existing: 0, invalid: 0, failed: 0 };

export function ArticleImportForm({ locale }: { locale: SystemLanguage }) {
  const copy = pickLocale(locale, IMPORT_COPY);
  const router = useRouter();
  const [source, setSource] = useState<ArticleImportSource>("readwise");
  const [fileName, setFileName] = useState("");
  const [articles, setArticles] = useState<ImportedArticle[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(0);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const finished = articles.length > 0 && done === articles.length;
  const canRetry = finished && counts.failed > 0;

  function reset() {
    setFileName("");
    setArticles([]);
    setDone(0);
    setError("");
    setCounts(EMPTY_COUNTS);
  }

  async function load(file?: File) {
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      if (file.size > MAX_ARTICLE_IMPORT_BYTES) throw new Error(copy.fileTooLarge);
      setArticles(parseArticleImportCsv(await file.text(), source));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to read CSV");
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setError("");
    if (canRetry) {
      setDone(0);
      setCounts(EMPTY_COUNTS);
    }

    try {
      for (let offset = canRetry ? 0 : done; offset < articles.length; offset += 50) {
        const response = await fetch("/api/uploads/articles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articles: articles.slice(offset, offset + 50) })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Import failed");
        setCounts(current => ({
          imported: current.imported + result.imported,
          existing: current.existing + result.existing,
          invalid: current.invalid + result.invalid,
          failed: current.failed + result.failed
        }));
        setDone(Math.min(offset + 50, articles.length));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const buttonLabel = canRetry ? copy.retry : done > 0 && !finished ? copy.resume : copy.importArticles;

  return (
    <div className="settingsImportGroup" id="import-readwise">
      <h3 className="settingsSubsectionTitle">{copy.importArticles}</h3>
      <div className="sourceForm articleImportForm">
        <fieldset className="articleImportSources" disabled={busy}>
          <legend>{copy.sourceLabel}</legend>
          <div className="articleImportSourceOptions">
            {SOURCE_OPTIONS.map(value => (
              <label className="articleImportSource" key={value}>
                <input
                  type="radio"
                  name="article-import-source"
                  value={value}
                  checked={source === value}
                  onChange={() => {
                    setSource(value);
                    reset();
                  }}
                />
                <span>{ARTICLE_IMPORT_SOURCES[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="articleImportFile" data-selected={Boolean(fileName)}>
          <input
            className="articleImportFileInput"
            type="file"
            accept=".csv,text/csv"
            aria-label={fileName ? copy.replaceLabel : copy.chooseLabel}
            aria-describedby="article-import-file-name article-import-file-limit article-import-help"
            disabled={busy}
            onChange={event => {
              void load(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <span className="articleImportFileIcon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10m-7-7v7h7m-7-7 7 7M8 14h8m-8 3h5" />
            </svg>
          </span>
          <span className="articleImportFileInfo">
            <strong id="article-import-file-name" title={fileName || undefined}>{fileName || copy.fileType}</strong>
            <small id="article-import-file-limit">{copy.fileLimit}</small>
          </span>
          <span className="articleImportFileAction" aria-hidden="true">{fileName ? copy.replaceLabel : copy.chooseLabel}</span>
        </label>
        <small className="articleImportHelp" id="article-import-help">{copy.help[source]} {copy.duplicates}</small>
        {articles.length > 0 && <p className="articleImportPreview" role="status">{copy.found(articles.length, articles.filter(row => row.archived).length)}</p>}
        {done > 0 && <div role="status" aria-live="polite">
          <p>{copy.progress(done, articles.length, counts)}</p>
          <small>{copy.backgroundNote}</small>
        </div>}
        {error && <p className="sourceError" role="alert">{error}</p>}
        <button type="button" disabled={busy || !articles.length || (finished && !canRetry)} onClick={() => void start()}>
          {busy ? copy.importing : buttonLabel}
        </button>
      </div>
    </div>
  );
}
