/**
 * Idempotent migration runner.
 *
 *   pnpm db:migrate            apply pending migrations
 *   pnpm db:migrate --status   list applied/pending, change nothing
 *
 * Reads DATABASE_URL (default postgres://localhost:5432/money_management).
 * Creates the database if it does not exist, tracks what has been applied in
 * a `_migrations` table, and refuses to run if a file that was already
 * applied has since been edited (checksum mismatch) — an edited migration is
 * a schema drift bug, not something to silently re-run.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Load .env.local then .env, if present. Neither is required — the defaults
// below are enough for a stock local Postgres.
async function loadEnvFiles(root: string): Promise<void> {
  try {
    const dotenv = await import("dotenv");
    for (const file of [".env.local", ".env"]) {
      dotenv.config({ path: path.join(root, file), quiet: true });
    }
  } catch {
    // dotenv is optional; env may already be provided by the shell.
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");

const DEFAULT_URL = "postgres://localhost:5432/money_management";

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

function checksumOf(sql: string): string {
  // Normalise line endings so a CRLF checkout does not look like drift.
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

async function readMigrations(): Promise<MigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(MIGRATIONS_DIR);
  } catch {
    throw new Error(`No migrations directory at ${MIGRATIONS_DIR}`);
  }

  const files = entries.filter((f) => f.endsWith(".sql")).sort();

  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
      return { name, sql, checksum: checksumOf(sql) };
    }),
  );
}

/**
 * Split a connection string into {adminUrl, database}. CREATE DATABASE cannot
 * run from inside the database being created, so we connect to `postgres`
 * (or `template1`) first.
 */
function splitUrl(url: string): { adminUrl: string; database: string } {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error(`DATABASE_URL has no database name: ${url}`);
  }
  const admin = new URL(url);
  admin.pathname = "/postgres";
  return { adminUrl: admin.toString(), database };
}

async function ensureDatabase(url: string): Promise<boolean> {
  const { adminUrl, database } = splitUrl(url);
  const admin = postgres(adminUrl, {
    max: 1,
    onnotice: () => {},
    connection: { application_name: "money-management-migrate" },
  });

  try {
    const existing = await admin<{ datname: string }[]>`
      select datname from pg_database where datname = ${database}
    `;
    if (existing.length > 0) return false;

    // Identifier cannot be parameterised; the name comes from our own URL and
    // is quoted to keep it inert.
    await admin.unsafe(`create database "${database.replace(/"/g, '""')}"`);
    return true;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`
    create table if not exists public._migrations (
      id          bigint generated always as identity primary key,
      name        text not null unique,
      checksum    text not null,
      applied_at  timestamptz not null default now(),
      duration_ms integer not null default 0
    )
  `;
}

interface AppliedRow {
  name: string;
  checksum: string;
  applied_at: Date;
}

async function main(): Promise<void> {
  await loadEnvFiles(PROJECT_ROOT);

  const url = process.env.DATABASE_URL?.trim() || DEFAULT_URL;
  const statusOnly = process.argv.includes("--status");
  const { database } = splitUrl(url);

  const migrations = await readMigrations();
  if (migrations.length === 0) {
    console.log("No migration files found — nothing to do.");
    return;
  }

  const created = await ensureDatabase(url);
  if (created) console.log(`Created database "${database}".`);

  const sql = postgres(url, {
    max: 1,
    onnotice: (notice) => {
      if (notice.severity && notice.severity !== "NOTICE") {
        console.warn(`  ${notice.severity}: ${notice.message}`);
      }
    },
    connection: { application_name: "money-management-migrate" },
  });

  try {
    await ensureMigrationsTable(sql);

    const appliedRows = await sql<AppliedRow[]>`
      select name, checksum, applied_at from public._migrations
    `;
    const applied = new Map(appliedRows.map((r) => [r.name, r]));

    // Drift check first, so we fail before mutating anything.
    const drifted = migrations.filter(
      (m) => applied.has(m.name) && applied.get(m.name)!.checksum !== m.checksum,
    );
    if (drifted.length > 0) {
      const names = drifted.map((m) => m.name).join(", ");
      throw new Error(
        `Already-applied migration(s) changed on disk: ${names}. ` +
          `Add a new migration instead of editing an applied one.`,
      );
    }

    const pending = migrations.filter((m) => !applied.has(m.name));

    if (statusOnly) {
      console.log(`Database: ${database}`);
      for (const m of migrations) {
        const row = applied.get(m.name);
        console.log(
          row
            ? `  applied  ${m.name}  (${row.applied_at.toISOString()})`
            : `  PENDING  ${m.name}`,
        );
      }
      return;
    }

    if (pending.length === 0) {
      console.log(
        `Database "${database}" is up to date (${migrations.length} migration(s) applied).`,
      );
      return;
    }

    for (const migration of pending) {
      const started = Date.now();
      process.stdout.write(`Applying ${migration.name} ... `);

      await sql.begin(async (tx) => {
        // .simple() sends the whole file as one multi-statement query; the
        // extended protocol used for tagged templates allows only one.
        await tx.unsafe(migration.sql).simple();
        await tx`
          insert into public._migrations (name, checksum, duration_ms)
          values (${migration.name}, ${migration.checksum}, ${Date.now() - started})
        `;
      });

      console.log(`ok (${Date.now() - started}ms)`);
    }

    console.log(`Applied ${pending.length} migration(s) to "${database}".`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("\nMigration failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
