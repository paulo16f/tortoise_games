// Zone-server-only endpoints (design doc §3 trust boundary 3). Clients cannot
// reach these: nginx does not route /internal, and the shared secret gates it.

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../server.js";
import { withTransaction } from "../db/pool.js";
import { makeRequireZoneSecret } from "../plugins/guards.js";
import {
  MAX_PLAUSIBLE_DEPTH,
  maxCurrencyForDepth,
  maxXpForDepth,
  dailyQuestsFor,
  dailyQuestDef,
  dateKeyUTC,
  skinDef,
} from "@depthbreaker/sim";

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

        // Persistent progression: run XP accumulates on the character forever
        // (level derives from total_xp via levelForTotalXp). Same idempotent
        // transaction as the wallet credit — a run finishes exactly once.
        await client.query(
          "UPDATE characters SET total_xp = total_xp + $2 WHERE id = $1",
          [run.character_id, body.xpEarned],
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

  // --- Daily quests (gold faucet; the active set is derived from the date) ---
  // The zone server reports gathered/killed/depth progress; this caps it at the
  // quest target and credits gold once on claim. The active quest ids come from
  // the shared deterministic sim, so the backend never stores which quests exist.

  app.get("/internal/dailies/:accountId", { preHandler: requireZoneSecret }, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const dateKey = dateKeyUTC(new Date());
    const defs = dailyQuestsFor(dateKey);
    const rows = await pool.query<{ quest_id: string; progress: number; claimed: boolean }>(
      "SELECT quest_id, progress, claimed FROM account_daily_quests WHERE account_id = $1 AND date_key = $2",
      [accountId, dateKey],
    );
    const byId = new Map(rows.rows.map((r) => [r.quest_id, r]));
    return reply.send({
      dateKey,
      quests: defs.map((d) => ({
        ...d,
        progress: byId.get(d.id)?.progress ?? 0,
        claimed: byId.get(d.id)?.claimed ?? false,
      })),
    });
  });

  app.post(
    "/internal/dailies/:accountId/progress",
    {
      preHandler: requireZoneSecret,
      schema: {
        body: {
          type: "object",
          required: ["questId", "delta"],
          properties: {
            questId: { type: "string", maxLength: 64 },
            delta: { type: "integer", minimum: 1, maximum: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { accountId } = request.params as { accountId: string };
      const { questId, delta } = request.body as { questId: string; delta: number };
      const dateKey = dateKeyUTC(new Date());
      const def = dailyQuestsFor(dateKey).find((q) => q.id === questId);
      if (!def) return reply.code(404).send({ error: "quest_not_active" }); // not today's quest
      // Upsert progress, clamped to the target (never over-counts on replays).
      // Casts are required: pg can't infer types for params used only in LEAST().
      await pool.query(
        `INSERT INTO account_daily_quests (account_id, date_key, quest_id, progress)
         VALUES ($1, $2, $3, LEAST($4::int, $5::int))
         ON CONFLICT (account_id, date_key, quest_id)
         DO UPDATE SET progress = LEAST(account_daily_quests.progress + $4::int, $5::int), updated_at = now()`,
        [accountId, dateKey, questId, delta, def.target],
      );
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/internal/dailies/:accountId/claim",
    {
      preHandler: requireZoneSecret,
      schema: {
        body: { type: "object", required: ["questId"], properties: { questId: { type: "string", maxLength: 64 } } },
      },
    },
    async (request, reply) => {
      const { accountId } = request.params as { accountId: string };
      const { questId } = request.body as { questId: string };
      const dateKey = dateKeyUTC(new Date());
      const def = dailyQuestsFor(dateKey).find((q) => q.id === questId) ?? dailyQuestDef(questId);
      if (!def) return reply.code(404).send({ error: "quest_not_found" });

      const result = await withTransaction(pool, async (client) => {
        const row = await client.query<{ progress: number; claimed: boolean }>(
          "SELECT progress, claimed FROM account_daily_quests WHERE account_id = $1 AND date_key = $2 AND quest_id = $3 FOR UPDATE",
          [accountId, dateKey, questId],
        );
        if (!row.rowCount || row.rows[0]!.progress < def.target) return { code: 409 as const, error: "not_complete" };
        if (row.rows[0]!.claimed) return { code: 409 as const, error: "already_claimed" };
        await client.query(
          "UPDATE account_daily_quests SET claimed = true, updated_at = now() WHERE account_id = $1 AND date_key = $2 AND quest_id = $3",
          [accountId, dateKey, questId],
        );
        const wallet = await client.query<{ currency: string }>(
          "UPDATE meta_wallets SET currency = currency + $2, updated_at = now() WHERE account_id = $1 RETURNING currency",
          [accountId, def.goldReward],
        );
        if (!wallet.rowCount) return { code: 404 as const, error: "wallet_not_found" };
        return { code: 200 as const, balance: Number(wallet.rows[0]!.currency), gold: def.goldReward, xp: def.xpReward };
      });
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send(result);
    },
  );

  // --- Cosmetic skins (gold sink) ---
  // Ownership is account-wide (account_skins); the equipped skin is per
  // character (characters.skin_id). Buying debits wallet gold in one tx.

  app.get("/internal/characters/:id/skins", { preHandler: requireZoneSecret }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const char = await pool.query<{ account_id: string; skin_id: string }>(
      "SELECT account_id, skin_id FROM characters WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (!char.rowCount) return reply.code(404).send({ error: "character_not_found" });
    const owned = await pool.query<{ skin_id: string }>(
      "SELECT skin_id FROM account_skins WHERE account_id = $1",
      [char.rows[0]!.account_id],
    );
    return reply.send({ equipped: char.rows[0]!.skin_id, owned: owned.rows.map((r) => r.skin_id) });
  });

  app.post(
    "/internal/characters/:id/skins/buy",
    {
      preHandler: requireZoneSecret,
      schema: { body: { type: "object", required: ["skinId"], properties: { skinId: { type: "string", maxLength: 64 } } } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { skinId } = request.body as { skinId: string };
      const def = skinDef(skinId);
      if (!def) return reply.code(404).send({ error: "skin_not_found" });

      const result = await withTransaction(pool, async (client) => {
        const char = await client.query<{ account_id: string }>(
          "SELECT account_id FROM characters WHERE id = $1 AND deleted_at IS NULL",
          [id],
        );
        if (!char.rowCount) return { code: 404 as const, error: "character_not_found" };
        const accountId = char.rows[0]!.account_id;
        const already = await client.query("SELECT 1 FROM account_skins WHERE account_id = $1 AND skin_id = $2", [accountId, skinId]);
        if (already.rowCount) return { code: 409 as const, error: "already_owned" };
        // Conditional debit — the balance check is the WHERE clause.
        const wallet = await client.query<{ currency: string }>(
          "UPDATE meta_wallets SET currency = currency - $2, updated_at = now() WHERE account_id = $1 AND currency >= $2 RETURNING currency",
          [accountId, def.price],
        );
        if (!wallet.rowCount) return { code: 402 as const, error: "insufficient_currency" };
        await client.query("INSERT INTO account_skins (account_id, skin_id) VALUES ($1, $2)", [accountId, skinId]);
        return { code: 200 as const, balance: Number(wallet.rows[0]!.currency) };
      });
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send(result);
    },
  );

  app.post(
    "/internal/characters/:id/skins/equip",
    {
      preHandler: requireZoneSecret,
      schema: { body: { type: "object", required: ["skinId"], properties: { skinId: { type: "string", maxLength: 64 } } } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { skinId } = request.body as { skinId: string };
      // "" always allowed (class default); anything else must be owned.
      if (skinId !== "" && !skinDef(skinId)) return reply.code(404).send({ error: "skin_not_found" });
      const result = await withTransaction(pool, async (client) => {
        const char = await client.query<{ account_id: string }>(
          "SELECT account_id FROM characters WHERE id = $1 AND deleted_at IS NULL",
          [id],
        );
        if (!char.rowCount) return { code: 404 as const, error: "character_not_found" };
        if (skinId !== "") {
          const owned = await client.query("SELECT 1 FROM account_skins WHERE account_id = $1 AND skin_id = $2", [char.rows[0]!.account_id, skinId]);
          if (!owned.rowCount) return { code: 403 as const, error: "not_owned" };
        }
        await client.query("UPDATE characters SET skin_id = $2 WHERE id = $1", [id, skinId]);
        return { code: 200 as const };
      });
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send({ ok: true, equipped: skinId });
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

  // --- Wallet (market transactions from the zone server) ---
  // The zone server is the only caller (shared secret). Amounts are derived
  // from server-side item defs, never from the client. Debits are conditional
  // (never below zero); credits are capped per call to bound the blast radius
  // of a leaked secret, mirroring the run-finish plausibility caps.

  const walletAmountSchema = {
    body: {
      type: "object",
      required: ["amount"],
      properties: {
        amount: { type: "integer", minimum: 1, maximum: 5000 },
        reason: { type: "string", maxLength: 64 },
      },
    },
  };
  const MAX_CREDIT_PER_CALL = 2000;

  app.get("/internal/wallet/:accountId", { preHandler: requireZoneSecret }, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const res = await pool.query<{ currency: string }>(
      "SELECT currency FROM meta_wallets WHERE account_id = $1",
      [accountId],
    );
    if (!res.rowCount) return reply.code(404).send({ error: "wallet_not_found" });
    return reply.send({ balance: Number(res.rows[0]!.currency) });
  });

  app.post(
    "/internal/wallet/:accountId/debit",
    { preHandler: requireZoneSecret, schema: walletAmountSchema },
    async (request, reply) => {
      const { accountId } = request.params as { accountId: string };
      const { amount } = request.body as { amount: number };
      // Conditional debit: the WHERE clause is the balance check, so two
      // concurrent debits can never drive the wallet negative.
      const res = await pool.query<{ currency: string }>(
        `UPDATE meta_wallets SET currency = currency - $2, updated_at = now()
         WHERE account_id = $1 AND currency >= $2 RETURNING currency`,
        [accountId, amount],
      );
      if (!res.rowCount) {
        const exists = await pool.query("SELECT 1 FROM meta_wallets WHERE account_id = $1", [accountId]);
        if (!exists.rowCount) return reply.code(404).send({ error: "wallet_not_found" });
        return reply.code(402).send({ error: "insufficient_currency" });
      }
      return reply.send({ balance: Number(res.rows[0]!.currency) });
    },
  );

  // --- Stash (persistent bank; deposits/withdrawals from the zone server) ---
  // One row per item type; slot cap = distinct rows. All mutations run in a
  // transaction with the account's rows locked so concurrent ops can't exceed
  // the caps.

  const STASH_SLOT_CAP = 24;
  const STACK_CAP = 999;
  const stashBodySchema = {
    body: {
      type: "object",
      required: ["itemId", "count"],
      properties: {
        itemId: { type: "string", minLength: 1, maxLength: 64 },
        count: { type: "integer", minimum: 1, maximum: 999 },
      },
    },
  };

  app.get("/internal/stash/:accountId", { preHandler: requireZoneSecret }, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const exists = await pool.query("SELECT 1 FROM accounts WHERE id = $1", [accountId]);
    if (!exists.rowCount) return reply.code(404).send({ error: "account_not_found" });
    const res = await pool.query<{ item_id: string; count: number }>(
      "SELECT item_id, count FROM stash_items WHERE account_id = $1 ORDER BY item_id",
      [accountId],
    );
    return reply.send({ items: res.rows.map((r) => ({ itemId: r.item_id, count: r.count })), slotCap: STASH_SLOT_CAP });
  });

  app.post(
    "/internal/stash/:accountId/deposit",
    { preHandler: requireZoneSecret, schema: stashBodySchema },
    async (request, reply) => {
      const { accountId } = request.params as { accountId: string };
      const { itemId, count } = request.body as { itemId: string; count: number };
      const result = await withTransaction(pool, async (client) => {
        const acct = await client.query("SELECT 1 FROM accounts WHERE id = $1", [accountId]);
        if (!acct.rowCount) return { code: 404 as const, error: "account_not_found" };
        const rows = await client.query<{ item_id: string; count: number }>(
          "SELECT item_id, count FROM stash_items WHERE account_id = $1 FOR UPDATE",
          [accountId],
        );
        const existing = rows.rows.find((r) => r.item_id === itemId);
        if (!existing && rows.rowCount! >= STASH_SLOT_CAP) return { code: 409 as const, error: "stash_full" };
        if ((existing?.count ?? 0) + count > STACK_CAP) return { code: 409 as const, error: "stack_full" };
        await client.query(
          `INSERT INTO stash_items (account_id, item_id, count) VALUES ($1, $2, $3)
           ON CONFLICT (account_id, item_id)
           DO UPDATE SET count = stash_items.count + $3, updated_at = now()`,
          [accountId, itemId, count],
        );
        return { code: 200 as const };
      });
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/internal/stash/:accountId/withdraw",
    { preHandler: requireZoneSecret, schema: stashBodySchema },
    async (request, reply) => {
      const { accountId } = request.params as { accountId: string };
      const { itemId, count } = request.body as { itemId: string; count: number };
      const result = await withTransaction(pool, async (client) => {
        const row = await client.query<{ count: number }>(
          "SELECT count FROM stash_items WHERE account_id = $1 AND item_id = $2 FOR UPDATE",
          [accountId, itemId],
        );
        if (!row.rowCount) return { code: 404 as const, error: "not_in_stash" };
        const have = row.rows[0]!.count;
        if (have < count) return { code: 409 as const, error: "not_enough" };
        if (have === count) {
          await client.query("DELETE FROM stash_items WHERE account_id = $1 AND item_id = $2", [accountId, itemId]);
        } else {
          await client.query(
            "UPDATE stash_items SET count = count - $3, updated_at = now() WHERE account_id = $1 AND item_id = $2",
            [accountId, itemId, count],
          );
        }
        return { code: 200 as const };
      });
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/internal/wallet/:accountId/credit",
    { preHandler: requireZoneSecret, schema: walletAmountSchema },
    async (request, reply) => {
      const { accountId } = request.params as { accountId: string };
      const { amount } = request.body as { amount: number };
      if (amount > MAX_CREDIT_PER_CALL) {
        request.log.warn({ accountId, amount }, "implausible wallet credit rejected");
        return reply.code(422).send({ error: "implausible_credit" });
      }
      const res = await pool.query<{ currency: string }>(
        `UPDATE meta_wallets SET currency = currency + $2, updated_at = now()
         WHERE account_id = $1 RETURNING currency`,
        [accountId, amount],
      );
      if (!res.rowCount) return reply.code(404).send({ error: "wallet_not_found" });
      return reply.send({ balance: Number(res.rows[0]!.currency) });
    },
  );
}
