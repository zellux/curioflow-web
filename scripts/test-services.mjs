import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const directory = mkdtempSync(join(tmpdir(), "curioflow-services-"));
const databaseUrl = process.env.CURIOFLOW_TEST_DATABASE_URL ?? `file:${join(directory, "test.db")}`;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  CURIOFLOW_TEST_STORAGE: directory,
  NODE_ENV: "test",
  CURIOFLOW_RUN_BACKGROUND_WORKER: "false"
};
try {
  if (databaseUrl.startsWith("file:")) {
    execFileSync(process.execPath, ["prisma/apply-migrations.mjs"], { env, stdio: "inherit" });
  } else {
    execFileSync("npm", ["run", "db:migrate:prod"], { env, stdio: "inherit" });
  }
  execFileSync(process.execPath, [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=DEP0205",
    "--import", resolve("scripts/register-service-test-loader.mjs"),
    "--experimental-strip-types", "--test", resolve("test/service-workflows.mts")
  ], { env, cwd: directory, stdio: "inherit" });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
