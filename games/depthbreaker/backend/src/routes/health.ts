// Launch-readiness health endpoint (AGENTS.md guardrail 10, CODEX_PATTERNS
// pattern 6). Fails CLOSED: misconfiguration in production returns 503.
// Phase 2 extends this with Solana RPC / token mint / treasury checks.

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../server.js";
import { DEV_SESSION_SECRET, DEV_ZONE_SHARED_SECRET } from "../config.js";

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, pool } = ctx;

  app.get("/api/health", async (_request, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      const res = await pool.query<{ count: string }>("SELECT count(*) FROM schema_migrations");
      const migrations = Number(res.rows[0]!.count);
      checks.database = { ok: migrations >= 2, detail: `${migrations} migrations applied` };
    } catch (err) {
      checks.database = { ok: false, detail: (err as Error).message };
    }

    const sessionSecretIsDefault = config.sessionSecret === DEV_SESSION_SECRET;
    checks.session_secret = {
      ok: !(config.isProduction && sessionSecretIsDefault),
      detail: sessionSecretIsDefault ? "using dev default" : "configured",
    };

    const zoneSecretIsDefault = config.zoneSharedSecret === DEV_ZONE_SHARED_SECRET;
    checks.zone_shared_secret = {
      ok: !(config.isProduction && zoneSecretIsDefault),
      detail: zoneSecretIsDefault ? "using dev default" : "configured",
    };

    checks.zone_ws_url = {
      ok: !config.isProduction || config.zoneWsUrl.startsWith("wss://"),
      detail: config.zoneWsUrl,
    };

    checks.payouts = {
      ok: true,
      detail: "disabled for Phase 0 soft launch",
    };

    // Solana layer is deferred by design; Phase 0 can soft-launch without it,
    // while Phase 2 still fails closed until the token checks are implemented.
    checks.solana_layer = {
      ok: config.launchPhase === "phase0" || !config.isProduction,
      detail:
        config.launchPhase === "phase0"
          ? "not implemented; deferred to Phase 2"
          : "not implemented (Phase 2) - token launch blocked",
    };

    const healthy = Object.values(checks).every((c) => c.ok);
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "not_ready",
      environment: config.nodeEnv,
      launchPhase: config.launchPhase,
      checks,
    });
  });
}
