// Ordered .sql migration runner. Each file applies inside one transaction;
// version = leading integer of the filename.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type pg from "pg";
import { createPool } from "./pool.js";
import { loadConfig } from "../config.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

// Arbitrary app-wide advisory lock key so concurrent boots can't race migrations.
const MIGRATION_LOCK_KEY = 0x0dbb_0001;

export async function runMigrations(pool: pg.Pool): Promise<number[]> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    return await applyPending(pool);
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    lockClient.release();
  }
}

async function applyPending(pool: pg.Pool): Promise<number[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version int PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort();

  const appliedRes = await pool.query<{ version: number }>("SELECT version FROM schema_migrations");
  const applied = new Set(appliedRes.rows.map((r) => Number(r.version)));

  const newlyApplied: number[] = [];
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (applied.has(version)) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      newlyApplied.push(version);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return newlyApplied;
}

// Run directly: `npm run migrate`
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const pool = createPool(loadConfig().databaseUrl);
  runMigrations(pool)
    .then((versions) => {
      console.log(versions.length ? `applied: ${versions.join(", ")}` : "up to date");
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
      return pool.end();
    });
}
