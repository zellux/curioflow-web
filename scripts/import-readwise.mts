import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import nextEnv from "@next/env";
import { parseReadwiseCsv } from "../src/lib/readwise-csv.ts";

const { values } = parseArgs({ options: { file: { type: "string" }, library: { type: "string" }, apply: { type: "boolean", default: false }, report: { type: "string" } } });
if (!values.file || !values.library) throw new Error("Usage: npm run import:readwise -- --file export.csv --library ID [--apply] [--report result.json]");
nextEnv.loadEnvConfig(process.cwd(), true);
process.env.CURIOFLOW_RUN_BACKGROUND_WORKER = "false";
const { prisma } = await import("../src/server/db.ts");
const { importReadwiseArticles } = await import("../src/server/ingest/readwise.ts");
try {
  const rows = parseReadwiseCsv(readFileSync(values.file, "utf8"));
  const report = { mode: values.apply ? "apply" : "preview", rows: rows.length, imported: 0, existing: 0, invalid: 0, failed: 0, missing: 0, errors: [] as { url: string; error: string }[] };
  for (let offset = 0; offset < rows.length; offset += 50) {
    const batch = await importReadwiseArticles(values.library, rows.slice(offset, offset + 50), values.apply);
    for (const key of ["imported", "existing", "invalid", "failed", "missing"] as const) report[key] += batch[key];
    report.errors.push(...batch.errors);
    console.error(`Processed ${Math.min(offset + 50, rows.length)}/${rows.length}`);
  }
  if (values.report) writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (report.failed) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
