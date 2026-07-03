// Zone-server-only endpoints (design doc §3 trust boundary 3). Clients cannot
// reach these: nginx does not route /internal, and the shared secret gates it.

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../server.js";
import { withTransaction } from "../db/pool.js";
import { makeRequireZoneSecret } from "../plugins/guards.js";
import { MAX_PLAUSIBLE_DEPTH, maxCurrencyForDepth, maxXpForDepth } from "@depthbreaker/sim";

const OUTCOMES = ["dead", "complete", "abandoned"] as const;

export function registerInternalRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, pool } = ctx;
  const requireZoneSecret = makeRequireZoneSecret(config);

  app.post(
    "/internal/runs/:id/finish",
    {
      preHandler: requireZoneSecret,
      schema: {
        body: {
          type: "object",
          required: ["outcome", "depthReached", "xpEarned", "currencyEarned"],
          properties: {
            outcome: { type: "string", enum: [...OUTCOMES] },
            depthReached: { type: "integer", minimum: 0 },
            xpEarned: { type: "integer", minimum: 0 },
            currencyEarned: { type: "integer", minimum: 0 },
            loot: { type: "array" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        outcome: (typeof OUTCOMES)[number];
        depthReached: number;
        xpEarned: number;
        currencyEarned: number;
        loot?: unknown[];
      };

      // Plausibility bounds (GAME_MATH_SPEC §7): the backend never re-simulates,
      // but it caps what a report may claim.
      if (
        body.depthReached > MAX_PLAUSIBLE_DEPTH ||
        body.xpEarned > maxXpForDepth(body.depthReached) ||
        body.currencyEarned > maxCurrencyForDepth(body.depthReached)
      ) {
        request.log.warn({ runId: id, body }, "implausible run-finish report rejected");
        return reply.code(422).send({ error: "implausible_report" });
      }

      const result = await withTransaction(pool, async (client) => {
        const runRes = await client.query<{ status: string; character_id: string }>(
          "SELECT status, character_id FROM runs WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (!runRes.rowCount) return { code: 404 as const, error: "run_not_found" };
        const run = runRes.rows[0]!;
        // Idempotency: a run finishes exactly once.
        if (run.status !== "active") return { code: 409 as const, error: "already_finished" };

        await client.query(
          `UPDATE runs SET status = $2, depth_reached = $3, xp_earned = $4,
                  currency_earned = $5, loot = $6::jsonb, ended_at = now()
           WHERE id = $1`,
          [
            id,
            body.outcome,
            body.depthReached,
            body.xpEarned,
            body.currencyEarned,
            JSON.stringify(body.loot ?? []),
          ],
        );

        const walletRes = await client.query<{ currency: string }>(
          `UPDATE meta_wallets SET currency = currency + $2, updated_at = now()
           WHERE account_id = (SELECT account_id FROM characters WHERE id = $1)
           RETURNING currency`,
          [run.character_id, body.currencyEarned],
        );
        return {
          code: 200 as const,
          credited: body.currencyEarned,
          balance: Number(walletRes.rows[0]?.currency ?? 0),
        };
      });

      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send(result);
    },
  );

  app.post(
    "/internal/characters/:id/checkpoint",
    {
      preHandler: requireZoneSecret,
      schema: {
        body: {
          type: "object",
          required: ["depthReached"],
          properties: { depthReached: { type: "integer", minimum: 0 } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { depthReached } = request.body as { depthReached: number };
      if (depthReached > MAX_PLAUSIBLE_DEPTH) {
        return reply.code(422).send({ error: "implausible_report" });
      }
      const res = await pool.query(
        `UPDATE runs SET depth_reached = GREATEST(depth_reached, $2)
         WHERE character_id = $1 AND status = 'active' RETURNING id`,
        [id, depthReached],
      );
      if (!res.rowCount) return reply.code(404).send({ error: "no_active_run" });
      return reply.send({ ok: true });
    },
  );
}
