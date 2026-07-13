// Zone-server-only endpoints (design doc §3 trust boundary 3). Clients cannot
// reach these: nginx does not route /internal, and the shared secret gates it.

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../server.js";
import { withTransaction } from "../db/pool.js";
import { makeRequireZoneSecret } from "../plugins/guards.js";
import {
  DAILY_EARN_CAP,
  MAX_PLAUSIBLE_DEPTH,
  maxCurrencyForDepth,
  maxXpForDepth,
  dailyQuestsFor,
  dailyQuestDef,
  dateKeyUTC,
  advanceStreak,
  streakGold,
  skinDef,
  isStarterSkin,
  spinPrizeAt,
  SPINNER_SEGMENTS,
  itemDef,
} from "@depthbreaker/sim";

const OUTCOMES = ["dead", "complete", "abandoned"] as const;

/** Sum of today's ledgered grants for an account (0 if none). */
async function earnedToday(client: { query: (q: string, v: unknown[]) => Promise<{ rows: Array<{ total: string }> }> }, accountId: string, dateKey: string): Promise<number> {
  const res = await client.query(
    "SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM wallet_ledger WHERE account_id = $1 AND date_key = $2 AND amount > 0",
    [accountId, dateKey],
  );
  return Number(res.rows[0]?.total ?? 0);
}

/**
 * Append a grant to the wallet ledger. `ref` (when set) is globally unique —
 * a replay inserts nothing and returns false, so callers can skip the wallet
 * credit too (idempotent grants).
 */
async function ledgerGrant(client: { query: (q: string, v: unknown[]) => Promise<{ rowCount: number | null }> }, accountId: string, amount: number, reason: string, ref: string | null, dateKey: string): Promise<boolean> {
  if (amount <= 0) return true;
  const res = await client.query(
    `INSERT INTO wallet_ledger (account_id, amount, reason, ref, date_key)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (ref) WHERE ref IS NOT NULL DO NOTHING`,
    [accountId, amount, reason, ref, dateKey],
  );
  return (res.rowCount ?? 0) > 0 || ref === null;
}

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

        // Daily earn cap: run gold is clamped to the account's remaining
        // headroom for today (never rejected — the run still finishes), and
        // the grant is ledgered with the run id as its idempotency ref.
        const acctRes = await client.query<{ account_id: string }>(
          "SELECT account_id FROM characters WHERE id = $1",
          [run.character_id],
        );
        const accountId = acctRes.rows[0]!.account_id;
        const dateKey = dateKeyUTC(new Date());
        const headroom = Math.max(0, DAILY_EARN_CAP - (await earnedToday(client, accountId, dateKey)));
        const granted = Math.min(body.currencyEarned, headroom);
        await ledgerGrant(client, accountId, granted, "run_finish", `run:${id}`, dateKey);
        const walletRes = await client.query<{ currency: string }>(
          `UPDATE meta_wallets SET currency = currency + $2, updated_at = now()
           WHERE account_id = $1 RETURNING currency`,
          [accountId, granted],
        );
        return {
          code: 200 as const,
          credited: granted,
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
        // Streak: the first claim of a UTC day advances it (consecutive day)
        // or resets it (gap); later claims the same day keep it. The streak
        // multiplies daily GOLD only — bounded by streakGoldMult's +50% cap.
        const streakRow = await client.query<{ last_claim_date: string; streak: number }>(
          "SELECT last_claim_date, streak FROM account_daily_streaks WHERE account_id = $1 FOR UPDATE",
          [accountId],
        );
        const prev = streakRow.rows[0] ?? { last_claim_date: "", streak: 0 };
        const streak = advanceStreak(prev.last_claim_date, dateKey, prev.streak);
        await client.query(
          `INSERT INTO account_daily_streaks (account_id, last_claim_date, streak)
           VALUES ($1, $2, $3)
           ON CONFLICT (account_id) DO UPDATE SET last_claim_date = $2, streak = $3, updated_at = now()`,
          [accountId, dateKey, streak],
        );
        const gold = streakGold(def.goldReward, streak);
        // Ledgered (dailies are self-capped, so no headroom check) with a
        // per-day-per-quest ref — belt-and-suspenders on top of `claimed`.
        await ledgerGrant(client, accountId, gold, "daily_claim", `daily:${accountId}:${dateKey}:${questId}`, dateKey);
        const wallet = await client.query<{ currency: string }>(
          "UPDATE meta_wallets SET currency = currency + $2, updated_at = now() WHERE account_id = $1 RETURNING currency",
          [accountId, gold],
        );
        if (!wallet.rowCount) return { code: 404 as const, error: "wallet_not_found" };
        return { code: 200 as const, balance: Number(wallet.rows[0]!.currency), gold, xp: def.xpReward, streak };
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
        // Starter body variants (price 0) are always owned by everyone.
        if (skinId !== "" && !isStarterSkin(skinId)) {
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

  // --- Spinner wheel (free daily spin; gold faucet with a 24h cooldown) ---

  app.get("/internal/spinner/:accountId", { preHandler: requireZoneSecret }, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const res = await pool.query<{ remaining: string | null }>(
      `SELECT GREATEST(0, EXTRACT(EPOCH FROM (last_free_spin_at + interval '24 hours' - now())))::int AS remaining
       FROM account_spins WHERE account_id = $1`,
      [accountId],
    );
    return reply.send({ cooldownRemaining: res.rowCount ? Number(res.rows[0]!.remaining ?? 0) : 0 });
  });

  app.post("/internal/spinner/:accountId/spin", { preHandler: requireZoneSecret }, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const result = await withTransaction(pool, async (client) => {
      const acct = await client.query("SELECT 1 FROM accounts WHERE id = $1", [accountId]);
      if (!acct.rowCount) return { code: 404 as const, error: "account_not_found" };
      // Lock the spin row (upsert first so FOR UPDATE has a row to hold).
      await client.query(
        "INSERT INTO account_spins (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING",
        [accountId],
      );
      const row = await client.query<{ ready: boolean; remaining: string }>(
        `SELECT (last_free_spin_at IS NULL OR last_free_spin_at <= now() - interval '24 hours') AS ready,
                GREATEST(0, EXTRACT(EPOCH FROM (last_free_spin_at + interval '24 hours' - now())))::int AS remaining
         FROM account_spins WHERE account_id = $1 FOR UPDATE`,
        [accountId],
      );
      if (!row.rows[0]!.ready) return { code: 429 as const, error: "on_cooldown", remaining: Number(row.rows[0]!.remaining) };
      await client.query("UPDATE account_spins SET last_free_spin_at = now() WHERE account_id = $1", [accountId]);

      // Server rolls the segment; prize is gold (wallet) or an item (stash,
      // falling back to its gold sellValue if the stash can't hold it — a spin
      // never pays nothing).
      const prize = spinPrizeAt(Math.floor(Math.random() * SPINNER_SEGMENTS));
      if (prize.kind === "gold") {
        await client.query("UPDATE meta_wallets SET currency = currency + $2, updated_at = now() WHERE account_id = $1", [accountId, prize.count]);
        return { code: 200 as const, itemId: "gold", count: prize.count, isGold: true };
      }
      const stash = await client.query<{ item_id: string; count: number }>(
        "SELECT item_id, count FROM stash_items WHERE account_id = $1 FOR UPDATE",
        [accountId],
      );
      const existing = stash.rows.find((r) => r.item_id === prize.itemId);
      const canStash = existing ? existing.count + prize.count <= 999 : stash.rowCount! < 24;
      if (canStash) {
        await client.query(
          `INSERT INTO stash_items (account_id, item_id, count) VALUES ($1, $2, $3)
           ON CONFLICT (account_id, item_id) DO UPDATE SET count = stash_items.count + $3, updated_at = now()`,
          [accountId, prize.itemId, prize.count],
        );
        return { code: 200 as const, itemId: prize.itemId, count: prize.count, isGold: false };
      }
      // Stash full: convert to gold so the spin still pays.
      const goldValue = (itemDef(prize.itemId)?.sellValue ?? 1) * prize.count;
      await client.query("UPDATE meta_wallets SET currency = currency + $2, updated_at = now() WHERE account_id = $1", [accountId, goldValue]);
      return { code: 200 as const, itemId: "gold", count: goldValue, isGold: true };
    });
    if (result.code === 429) return reply.code(429).send({ error: result.error, cooldownRemaining: result.remaining });
    if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
    return reply.send({ itemId: result.itemId, count: result.count, isGold: result.isGold, cooldownRemaining: 86400 });
  });

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
      const { amount, reason } = request.body as { amount: number; reason?: string };
      if (amount > MAX_CREDIT_PER_CALL) {
        request.log.warn({ accountId, amount }, "implausible wallet credit rejected");
        return reply.code(422).send({ error: "implausible_credit" });
      }
      // Per-account daily earn cap across all ledgered grants — hard reject
      // (this route is the unbounded inflow; gameplay paths clamp instead).
      const dateKey = dateKeyUTC(new Date());
      const result = await withTransaction(pool, async (client) => {
        const total = await earnedToday(client, accountId, dateKey);
        if (total + amount > DAILY_EARN_CAP) return { code: 422 as const, error: "daily_earn_cap" };
        await ledgerGrant(client, accountId, amount, reason ?? "credit", null, dateKey);
        const res = await client.query<{ currency: string }>(
          `UPDATE meta_wallets SET currency = currency + $2, updated_at = now()
           WHERE account_id = $1 RETURNING currency`,
          [accountId, amount],
        );
        if (!res.rowCount) return { code: 404 as const, error: "wallet_not_found" };
        return { code: 200 as const, balance: Number(res.rows[0]!.currency) };
      });
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send({ balance: result.balance });
    },
  );
}
