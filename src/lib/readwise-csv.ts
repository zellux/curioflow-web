export type ReadwiseArticle = { title: string; url: string; savedAt: string | null; archived: boolean; progress: number };
export const MAX_READWISE_BYTES = 10 * 1024 * 1024;

// RFC 4180 fields, including quoted commas, escaped quotes and multiline titles.
export function parseReadwiseCsv(csv: string): ReadwiseArticle[] {
  if (new TextEncoder().encode(csv).length > MAX_READWISE_BYTES) throw new Error("CSV must be 10 MB or smaller.");
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
  const headers = rows.shift()?.map(value => value.trim()) ?? [];
  for (const required of ["Title", "URL", "Saved date", "Location", "Reading progress"]) {
    if (!headers.includes(required)) throw new Error(`Missing Readwise column: ${required}`);
  }
  if (!rows.length || rows.length > 20000) throw new Error("CSV must contain between 1 and 20,000 articles.");
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Invalid CSV row ${index + 2}.`);
    const get = (name: string) => values[headers.indexOf(name)]?.trim() ?? "";
    const date = new Date(get("Saved date"));
    const progress = Number(get("Reading progress"));
    return { title: get("Title"), url: get("URL"), savedAt: Number.isFinite(date.getTime()) ? date.toISOString() : null,
      archived: get("Location").toLowerCase() === "archive", progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0 };
  });
}
