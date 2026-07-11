import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../server.js";
import { withTransaction } from "../db/pool.js";
import { signJoinTicket } from "../auth/joinTicket.js";
import { makeRequireAuth } from "../plugins/guards.js";

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, pool } = ctx;
  const requireAuth = makeRequireAuth(config);

  app.post(
    "/api/runs/start",
    {
      preHandler: requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["characterId"],
          properties: { characterId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const { characterId } = request.body as { characterId: string };

      const owned = await pool.query<{ total_xp: string }>(
        "SELECT total_xp FROM characters WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL",
        [characterId, request.accountId],
      );
      if (!owned.rowCount) return reply.code(404).send({ error: "character_not_found" });
      const totalXp = Number(owned.rows[0]!.total_xp);

      const seed = randomInt(0, 4294967296); // uint32, the zone server's run seed
      const run = await withTransaction(pool, async (client) => {
        // A character can have one active run; a new start abandons the old one.
        await client.query(
          `UPDATE runs SET status = 'abandoned', ended_at = now()
           WHERE character_id = $1 AND status = 'active'`,
          [characterId],
        );
        const res = await client.query<{ id: string }>(
          "INSERT INTO runs (character_id, seed) VALUES ($1, $2) RETURNING id",
          [characterId, seed],
        );
        return res.rows[0]!;
      });

      const joinTicket = await signJoinTicket(
        { accountId: request.accountId!, characterId, runId: run.id, seed, totalXp },
        config.zoneSharedSecret,
        config.joinTicketTtlSeconds,
      );
      return reply.code(201).send({
        runId: run.id,
        seed,
        wsUrl: config.zoneWsUrl,
        joinTicket,
      });
    },
  );

  app.get("/api/runs/history", { preHandler: requireAuth }, async (request, reply) => {
    const { characterId } = request.query as { characterId?: string };
    if (!characterId) return reply.code(400).send({ error: "character_id_required" });

    const owned = await pool.query(
      "SELECT 1 FROM characters WHERE id = $1 AND account_id = $2",
      [characterId, request.accountId],
    );
    if (!owned.rowCount) return reply.code(404).send({ error: "character_not_found" });

    const res = await pool.query(
      `SELECT id, seed, status, depth_reached, xp_earned, currency_earned, started_at, ended_at
       FROM runs WHERE character_id = $1 AND status <> 'active'
       ORDER BY started_at DESC LIMIT 20`,
      [characterId],
    );
    return { runs: res.rows };
  });
}
