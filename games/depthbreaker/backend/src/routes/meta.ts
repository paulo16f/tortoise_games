import type { FastifyInstance } from "fastify";
import type { AppContext } from "../server.js";
import { withTransaction } from "../db/pool.js";
import { makeRequireAuth } from "../plugins/guards.js";

export function registerMetaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, pool } = ctx;
  const requireAuth = makeRequireAuth(config);

  app.get("/api/meta", { preHandler: requireAuth }, async (request) => {
    const [wallet, upgrades, unlocks] = await Promise.all([
      pool.query<{ currency: string }>(
        "SELECT currency FROM meta_wallets WHERE account_id = $1",
        [request.accountId],
      ),
      pool.query(
        `SELECT u.id, u.title, u.max_rank, u.cost_per_rank, u.prereq_id, u.effect,
                COALESCE(a.rank, 0) AS rank
         FROM meta_upgrades u
         LEFT JOIN account_upgrades a ON a.upgrade_id = u.id AND a.account_id = $1
         ORDER BY u.id`,
        [request.accountId],
      ),
      pool.query("SELECT unlock_id, unlocked_at FROM account_unlocks WHERE account_id = $1", [
        request.accountId,
      ]),
    ]);
    return {
      currency: Number(wallet.rows[0]?.currency ?? 0),
      upgrades: upgrades.rows,
      unlocks: unlocks.rows,
    };
  });

  app.post(
    "/api/meta/spend",
    {
      preHandler: requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["upgradeId"],
          properties: { upgradeId: { type: "string", maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      const { upgradeId } = request.body as { upgradeId: string };
      const accountId = request.accountId!;

      const result = await withTransaction(pool, async (client) => {
        const walletRes = await client.query<{ currency: string }>(
          "SELECT currency FROM meta_wallets WHERE account_id = $1 FOR UPDATE",
          [accountId],
        );
        if (!walletRes.rowCount) return { code: 404 as const, error: "wallet_not_found" };
        const currency = Number(walletRes.rows[0]!.currency);

        const upgradeRes = await client.query<{
          max_rank: number;
          cost_per_rank: string[];
          prereq_id: string | null;
        }>("SELECT max_rank, cost_per_rank, prereq_id FROM meta_upgrades WHERE id = $1", [
          upgradeId,
        ]);
        if (!upgradeRes.rowCount) return { code: 404 as const, error: "unknown_upgrade" };
        const upgrade = upgradeRes.rows[0]!;

        const rankRes = await client.query<{ rank: number }>(
          "SELECT rank FROM account_upgrades WHERE account_id = $1 AND upgrade_id = $2",
          [accountId, upgradeId],
        );
        const currentRank = rankRes.rows[0]?.rank ?? 0;
        if (currentRank >= upgrade.max_rank) return { code: 409 as const, error: "max_rank" };

        if (upgrade.prereq_id) {
          const prereqRes = await client.query(
            "SELECT 1 FROM account_upgrades WHERE account_id = $1 AND upgrade_id = $2",
            [accountId, upgrade.prereq_id],
          );
          if (!prereqRes.rowCount) return { code: 409 as const, error: "prereq_missing" };
        }

        const cost = Number(upgrade.cost_per_rank[currentRank]);
        if (!Number.isFinite(cost)) return { code: 500 as const, error: "bad_catalog" };
        if (currency < cost) return { code: 402 as const, error: "insufficient_currency" };

        await client.query(
          "UPDATE meta_wallets SET currency = currency - $2, updated_at = now() WHERE account_id = $1",
          [accountId, cost],
        );
        await client.query(
          `INSERT INTO account_upgrades (account_id, upgrade_id, rank) VALUES ($1, $2, 1)
           ON CONFLICT (account_id, upgrade_id)
           DO UPDATE SET rank = account_upgrades.rank + 1`,
          [accountId, upgradeId],
        );
        return { code: 200 as const, upgradeId, rank: currentRank + 1, currency: currency - cost };
      });

      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send(result);
    },
  );
}
