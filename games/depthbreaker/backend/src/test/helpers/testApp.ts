// DB-backed test helpers. Tests using these must skip when TEST_DATABASE_URL
// is unset so `npm test` stays green on machines without Postgres.

import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { loadConfig, type AppConfig } from "../../config.js";
import { createPool } from "../../db/pool.js";
import { runMigrations } from "../../db/migrate.js";
import { buildServer } from "../../server.js";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "";
export const hasTestDb = TEST_DB_URL.length > 0;

export interface TestApp {
  app: FastifyInstance;
  pool: pg.Pool;
  config: AppConfig;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const config: AppConfig = { ...loadConfig(), databaseUrl: TEST_DB_URL, nodeEnv: "test", isProduction: false };
  const pool = createPool(TEST_DB_URL);
  await runMigrations(pool);
  const app = buildServer({ config, pool });
  await app.ready();
  return {
    app,
    pool,
    config,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** Wipe account-scoped data between tests. Keeps the meta_upgrades catalog. */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(
    `TRUNCATE accounts, refresh_tokens, characters, meta_wallets,
             account_upgrades, account_unlocks, runs, inventory_items CASCADE`,
  );
}

export interface GuestSession {
  accountId: string;
  accessToken: string;
  refreshCookie: string;
}

export async function createGuest(app: FastifyInstance): Promise<GuestSession> {
  const res = await app.inject({ method: "POST", url: "/api/auth/guest" });
  if (res.statusCode !== 201) throw new Error(`guest auth failed: ${res.body}`);
  const body = res.json() as { accountId: string; accessToken: string };
  const cookie = res.cookies.find((c) => c.name === "db_refresh");
  if (!cookie) throw new Error("no refresh cookie set");
  return { accountId: body.accountId, accessToken: body.accessToken, refreshCookie: cookie.value };
}
