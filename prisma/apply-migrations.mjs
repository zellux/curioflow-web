import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const migrationsDir = join(process.cwd(), "prisma", "migrations");

function splitSql(sql) {
  if (sql.includes("-- statement-breakpoint")) {
    return sql
      .split("-- statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
  }
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS curioflow_migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of migrations) {
    const applied = await prisma.$queryRawUnsafe(
      "SELECT name FROM curioflow_migrations WHERE name = ?",
      name
    );

    if (applied.length > 0) {
      console.log(`Already applied ${name}`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
    console.log(`Applying ${name}`);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
      for (const statement of splitSql(sql)) {
        await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRawUnsafe("PRAGMA foreign_keys = ON");
      await tx.$executeRawUnsafe(
        "INSERT INTO curioflow_migrations (name) VALUES (?)",
        name
      );
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
