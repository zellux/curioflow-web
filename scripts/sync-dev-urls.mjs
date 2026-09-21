import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import nextEnv from "@next/env";

const { values } = parseArgs({ options: {
  "source-library": { type: "string", multiple: true },
  "target-library": { type: "string" },
  host: { type: "string" },
  container: { type: "string", default: "curioflow-app" },
  apply: { type: "boolean", default: false },
  report: { type: "string" },
  help: { type: "boolean" }
} });
if (values.help) {
  console.log("Usage: npm run sync:dev-urls -- --source-library ID [--source-library ID] --target-library ID --host SSH_HOST [--container NAME] [--apply] [--report FILE]\nDefaults to read-only preview. Only manually added article URLs are selected. Loads local development env; SSH uses the target container's production env.");
} else {
  await main();
}

async function main() {
  if (!values["source-library"]?.length || !values["target-library"] || !values.host) {
    throw new Error("--source-library, --target-library and --host are required; see --help");
  }
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(values.host) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(values.container)) {
    throw new Error("Invalid SSH host or container name");
  }
  nextEnv.loadEnvConfig(process.cwd(), true);
  const db = new PrismaClient();
  let urls;
  try {
    const ids = [...new Set(values["source-library"])];
    const libraries = await db.library.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (libraries.length !== ids.length) throw new Error("Unknown source library");
    const items = await db.item.findMany({
      where: { libraryId: { in: ids }, type: "article", deletedAt: null, url: { not: null },
        OR: [{ source: { type: "url" } }, { sourceEntries: { some: { source: { type: "url" } } } }] },
      select: { url: true }, orderBy: { createdAt: "asc" }
    });
    urls = items.map(item => item.url);
  } finally { await db.$disconnect(); }
  const code = readFileSync(new URL("./sync-dev-urls-target.mjs", import.meta.url), "utf8");
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const command = ["docker", "exec", "-i", "-e", "CURIOFLOW_RUN_BACKGROUND_WORKER=false", values.container,
    "node", "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "--eval", code].map(quote).join(" ");
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", values.host, command], {
    input: JSON.stringify({ libraryId: values["target-library"], urls, apply: values.apply }), encoding: "utf8", maxBuffer: 16 * 1024 * 1024
  });
  const marker = "CURIOFLOW_URL_SYNC_RESULT=";
  const line = result.stdout?.split("\n").find(line => line.startsWith(marker));
  if (!line) throw new Error(`Remote sync failed (${result.status ?? result.error?.message}). ${result.stderr || "No result returned"}`);
  const report = JSON.parse(line.slice(marker.length));
  if (values.report) writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ mode: report.mode, sourceArticles: urls.length, ...report.counts }, null, 2));
  if (values.report) console.log(`Report: ${values.report}`);
  if (result.status !== 0 || report.counts.failed) process.exitCode = 1;
}
