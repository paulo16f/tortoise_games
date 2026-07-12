// Gold exchange — the Kintara core loop (PHASE2_TOKEN_ECONOMY.md §1, §5.2):
// players sell GOLD to other players for the token. Fully off-chain today:
// listing escrows gold out of the seller's wallet, cancel returns it, browse
// is public to authed players. BUY is the one on-chain leg (buyer pays the
// seller 95/5 on Solana, server verifies the signature) and therefore FAILS
// CLOSED with 503 phase2_locked until the Solana env + verification exist —
// the game never takes custody of tokens (no payout signer, by design).

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../server.js";
import { withTransaction } from "../db/pool.js";
import { makeRequireAuth } from "../plugins/guards.js";

const MAX_OPEN_GOLD_LISTINGS = 4;
const MAX_GOLD_PER_LISTING = 5000;
const BROWSE_LIMIT = 100;

interface GoldListingRow {
  id: string;
  seller_account: string;
  gold_amount: string;
  usd_price: string;
  status: string;
  created_at: Date;
}

function toView(row: GoldListingRow, selfAccountId: string | undefined) {
  return {
    id: row.id,
    goldAmount: Number(row.gold_amount),
    usdPrice: Number(row.usd_price),
    status: row.status,
    mine: row.seller_account === selfAccountId,
    seller: `Player-${row.seller_account.slice(0, 4)}`,
    createdAt: row.created_at,
  };
}

export function registerGoldMarketRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, pool } = ctx;
  const requireAuth = makeRequireAuth(config);

  /** Browse open gold listings (+ my own listing history). */
  app.get("/api/goldmarket", { preHandler: requireAuth }, async (request, reply) => {
    const open = await pool.query<GoldListingRow>(
      `SELECT id, seller_account, gold_amount, usd_price, status, created_at
       FROM gold_listings WHERE status = 'open' ORDER BY usd_price / gold_amount ASC, created_at ASC LIMIT ${BROWSE_LIMIT}`,
      [],
    );
    const mine = await pool.query<GoldListingRow>(
      `SELECT id, seller_account, gold_amount, usd_price, status, created_at
       FROM gold_listings WHERE seller_account = $1 ORDER BY created_at DESC LIMIT 20`,
      [request.accountId],
    );
    return reply.send({
      listings: open.rows.map((r) => toView(r, request.accountId)),
      mine: mine.rows.map((r) => toView(r, request.accountId)),
    });
  });

  /** Create a listing: escrow the gold out of my wallet in the same tx. */
  app.post(
    "/api/goldmarket/list",
    {
      preHandler: requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["goldAmount", "usdPrice"],
          properties: {
            goldAmount: { type: "integer", minimum: 100, maximum: MAX_GOLD_PER_LISTING },
            usdPrice: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { goldAmount, usdPrice } = request.body as { goldAmount: number; usdPrice: number };
      const result = await withTransaction(pool, async (client) => {
        const openCount = await client.query<{ count: string }>(
          "SELECT count(*) FROM gold_listings WHERE seller_account = $1 AND status = 'open'",
          [request.accountId],
        );
        if (Number(openCount.rows[0]!.count) >= MAX_OPEN_GOLD_LISTINGS) {
          return { code: 409 as const, error: "listing_limit_reached" };
        }
        // Conditional escrow debit — the WHERE clause is the balance check and
        // the FIRST mutation, so a failed escrow mutates nothing.
        const debit = await client.query(
          "UPDATE meta_wallets SET currency = currency - $2, updated_at = now() WHERE account_id = $1 AND currency >= $2",
          [request.accountId, goldAmount],
        );
        if (!debit.rowCount) return { code: 402 as const, error: "insufficient_gold" };
        const ins = await client.query<{ id: string }>(
          "INSERT INTO gold_listings (seller_account, gold_amount, usd_price) VALUES ($1, $2, $3) RETURNING id",
          [request.accountId, goldAmount, usdPrice],
        );
        return { code: 201 as const, id: ins.rows[0]!.id };
      });
      if (result.code !== 201) return reply.code(result.code).send({ error: result.error });
      return reply.code(201).send({ ok: true, id: result.id });
    },
  );

  /** Cancel my open listing: escrowed gold returns to my wallet. */
  app.post(
    "/api/goldmarket/cancel",
    {
      preHandler: requireAuth,
      schema: {
        body: { type: "object", required: ["listingId"], properties: { listingId: { type: "string", format: "uuid" } } },
      },
    },
    async (request, reply) => {
      const { listingId } = request.body as { listingId: string };
      const result = await withTransaction(pool, async (client) => {
        const row = await client.query<GoldListingRow>(
          "SELECT id, seller_account, gold_amount, usd_price, status, created_at FROM gold_listings WHERE id = $1 FOR UPDATE",
          [listingId],
        );
        const listing = row.rows[0];
        if (!listing || listing.seller_account !== request.accountId) return { code: 404 as const, error: "listing_not_found" };
        if (listing.status !== "open") return { code: 409 as const, error: "not_open" };
        await client.query(
          "UPDATE gold_listings SET status = 'cancelled', updated_at = now() WHERE id = $1",
          [listingId],
        );
        await client.query(
          "UPDATE meta_wallets SET currency = currency + $2, updated_at = now() WHERE account_id = $1",
          [request.accountId, Number(listing.gold_amount)],
        );
        return { code: 200 as const };
      });
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send({ ok: true });
    },
  );

  /** Buy = the on-chain leg. Fail closed until Phase 2 launch prep wires
   *  SIWS + payment verification (AGENTS.md: missing production env = 503). */
  app.post("/api/goldmarket/buy", { preHandler: requireAuth }, async (_request, reply) => {
    return reply.code(503).send({ error: "phase2_locked", detail: "Gold purchases unlock with wallet linking (Phase 2)." });
  });
}
