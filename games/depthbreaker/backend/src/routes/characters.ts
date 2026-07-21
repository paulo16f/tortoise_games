import type { FastifyInstance } from "fastify";
import type { AppContext } from "../server.js";
import { makeRequireAuth } from "../plugins/guards.js";

const CLASS_IDS = ["knight", "reaper", "cleric", "necromancer"] as const;
const MAX_CHARACTERS_PER_ACCOUNT = 5;

export function registerCharacterRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, pool } = ctx;
  const requireAuth = makeRequireAuth(config);

  app.get("/api/characters", { preHandler: requireAuth }, async (request) => {
    const res = await pool.query(
      // total_xp is bigint (pg → string); cast to int (value is capped well
      // under 2^31) so the client gets a number for levelForTotalXp().
      `SELECT id, name, class_id, skin_id, total_xp::int AS total_xp, created_at FROM characters
       WHERE account_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [request.accountId],
    );
    return { characters: res.rows };
  });

  app.post(
    "/api/characters",
    {
      preHandler: requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["name", "classId"],
          properties: {
            name: { type: "string", minLength: 3, maxLength: 20, pattern: "^[A-Za-z][A-Za-z0-9 _-]*$" },
            classId: { type: "string", enum: [...CLASS_IDS] },
            variant: { type: "string", enum: ["a", "b"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, classId, variant } = request.body as { name: string; classId: string; variant?: "a" | "b" };
      // Body variant "b" equips the class's free starter skin from creation
      // (variant "a"/absent = the class default model, skin_id "").
      const VARIANT_B_SKIN: Record<string, string> = { knight: "knight_f", cleric: "warden_m", reaper: "reaper_b", necromancer: "necro_b" };
      const skinId = variant === "b" ? (VARIANT_B_SKIN[classId] ?? "") : "";
      const countRes = await pool.query<{ count: string }>(
        "SELECT count(*) FROM characters WHERE account_id = $1 AND deleted_at IS NULL",
        [request.accountId],
      );
      if (Number(countRes.rows[0]!.count) >= MAX_CHARACTERS_PER_ACCOUNT) {
        return reply.code(409).send({ error: "character_limit_reached" });
      }
      const res = await pool.query(
        `INSERT INTO characters (account_id, name, class_id, skin_id)
         VALUES ($1, $2, $3, $4) RETURNING id, name, class_id, created_at`,
        [request.accountId, name.trim(), classId, skinId],
      );
      return reply.code(201).send({ character: res.rows[0] });
    },
  );

  app.get("/api/characters/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const res = await pool.query(
      `SELECT id, name, class_id, skin_id, total_xp::int AS total_xp, created_at FROM characters
       WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
      [id, request.accountId],
    );
    if (!res.rowCount) return reply.code(404).send({ error: "not_found" });
    return { character: res.rows[0] };
  });

  // Soft delete: sets deleted_at so every other query (which filters
  // deleted_at IS NULL) stops seeing it, freeing a character slot. Runs/wallet
  // history stay intact. Only the owner can delete their own character.
  app.delete("/api/characters/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const res = await pool.query(
      `UPDATE characters SET deleted_at = now()
       WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
      [id, request.accountId],
    );
    if (!res.rowCount) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
