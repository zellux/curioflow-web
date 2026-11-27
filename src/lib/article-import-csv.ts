export type ImportedArticle = { title: string; url: string; savedAt: string | null; archived: boolean; progress: number };
export const MAX_ARTICLE_IMPORT_BYTES = 10 * 1024 * 1024;

export const ARTICLE_IMPORT_SOURCES = {
  readwise: "Readwise Reader",
  matter: "Matter",
  instapaper: "Instapaper",
  pocket: "Pocket"
} as const;
export type ArticleImportSource = keyof typeof ARTICLE_IMPORT_SOURCES;

// RFC 4180 fields, including quoted commas, escaped quotes and multiline titles.
function readCsvRows(csv: string) {
  if (new TextEncoder().encode(csv).length > MAX_ARTICLE_IMPORT_BYTES) throw new Error("CSV must be 10 MB or smaller.");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const endField = () => { row.push(field); field = ""; closed = false; };
  csv = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === ",") endField();
    else if (c === "\n" || c === "\r") {
      endField(); if (row.some(value => value.trim())) rows.push(row); row = [];
      if (c === "\r" && csv[i + 1] === "\n") i++;
    } else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error("Malformed CSV quoting.");
      field += c;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quoted field.");
  endField(); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function timestamp(value: string) {
  if (!value) return null;
  const numeric = /^\d+$/.test(value);
  const date = numeric
    ? new Date(Number(value) * (value.length <= 10 ? 1000 : 1))
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isArchive(value: string) {
  return ["archive", "archived"].includes(value.toLowerCase());
}

function matterArchive(get: (...names: string[]) => string) {
  const archived = get("archived", "is archived").toLowerCase();
  return ["true", "yes", "1"].includes(archived) || isArchive(archived)
    || Boolean(timestamp(get("archived at", "date archived")))
    || isArchive(get("location", "status"));
}

const REQUIRED_COLUMNS: Record<ArticleImportSource, string[]> = {
  readwise: ["Title", "URL", "Saved date", "Location", "Reading progress"],
  matter: [],
  instapaper: ["url", "title", "folder", "timestamp"],
  pocket: ["url", "title", "time_added", "status"]
};
const MATTER_URL_COLUMNS = ["original url", "canonical url", "article url", "url", "link"];
const MATTER_TITLE_COLUMNS = ["title", "article title"];

export function parseArticleImportCsv(csv: string, source: ArticleImportSource): ImportedArticle[] {
  const rows = readCsvRows(csv);
  const headers = rows.shift()?.map(value => source === "readwise"
    ? value.trim()
    : value.trim().toLowerCase()) ?? [];

  const sourceName = ARTICLE_IMPORT_SOURCES[source];
  for (const required of REQUIRED_COLUMNS[source]) {
    if (!headers.includes(required)) throw new Error(`Missing ${sourceName} column: ${required}`);
  }
  if (source === "matter" && (!MATTER_URL_COLUMNS.some(name => headers.includes(name))
    || !MATTER_TITLE_COLUMNS.some(name => headers.includes(name)))) {
    throw new Error("Matter CSV must include title and URL columns.");
  }
  if (!rows.length || rows.length > 20000) throw new Error("CSV must contain between 1 and 20,000 articles.");

  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Invalid CSV row ${index + 2}.`);
    const get = (...names: string[]) => {
      for (const name of names) {
        const value = values[headers.indexOf(name)]?.trim();
        if (value) return value;
      }
      return "";
    };
    const title = get("title");
    const url = get("url");

    switch (source) {
      case "readwise": {
        const date = new Date(get("Saved date"));
        const progress = Number(get("Reading progress"));
        return {
          title: get("Title"),
          url: get("URL"),
          savedAt: Number.isFinite(date.getTime()) ? date.toISOString() : null,
          archived: get("Location").toLowerCase() === "archive",
          progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
        };
      }
      case "matter":
        return {
          title: get(...MATTER_TITLE_COLUMNS),
          url: get(...MATTER_URL_COLUMNS),
          savedAt: timestamp(get("saved at", "saved date", "date saved", "added at", "date added")),
          archived: matterArchive(get),
          progress: 0
        };
      case "instapaper":
        return { title, url, savedAt: timestamp(get("timestamp")), archived: isArchive(get("folder")), progress: 0 };
      case "pocket":
        return { title, url, savedAt: timestamp(get("time_added")), archived: isArchive(get("status")), progress: 0 };
    }
  });
}
