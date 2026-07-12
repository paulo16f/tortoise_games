// P2P player marketplace — gold listings (Kintara model, Phase 2 doc §3.3).
// Client-facing authed routes (Bearer access token), unlike the /internal
// zone-server API. Every mutation is ONE transaction over stash + wallet +
// listing rows (the WoCC escrow lesson): items leave the seller's stash at
// listing time (escrowed in the row); buying settles gold buyer->seller and
// items row->buyer stash atomically. Gold listings carry no fee; the Phase 2
// gold-for-token listing type reuses this table with a tx-signature leg.

import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { AppContext } from "../server.js";
import { withTransaction } from "../db/pool.js";
import { makeRequireAuth } from "../plugins/guards.js";
import { itemDef } from "@depthbreaker/sim";

const MAX_OPEN_LISTINGS_PER_ACCOUNT = 8;
const BROWSE_LIMIT = 100;
// Must match routes/internal.ts stash caps.
const STASH_SLOT_CAP = 24;
const STACK_CAP = 999;

type Tx = pg.PoolClient;

/**
 * Abort a withTransaction body AFTER mutations have run. withTransaction only
 * rolls back on THROW — returning an error object would COMMIT the partial
 * work — so any failure that follows a mutation must throw this.
 */
class TxAbort extends Error {
  constructor(
    readonly code: 402 | 404 | 409,
    readonly errorId: string,
  ) {
    super(errorId);
  }
}

/** Deposit into a stash inside an existing transaction. Rows must be lockable. */
async function depositIntoStash(
  client: Tx,
  accountId: string,
  itemId: string,
  count: number,
): Promise<"ok" | "stash_full" | "stack_full"> {
  const rows = await client.query<{ item_id: string; count: number }>(
    "SELECT item_id, count FROM stash_items WHERE account_id = $1 FOR UPDATE",
    [accountId],
  );
  const existing = rows.rows.find((r) => r.item_id === itemId);
  if (!existing && rows.rowCount! >= STASH_SLOT_CAP) return "stash_full";
  if ((existing?.count ?? 0) + count > STACK_CAP) return "stack_full";
  await client.query(
    `INSERT INTO stash_items (account_id, item_id, count) VALUES ($1, $2, $3)
     ON CONFLICT (account_id, item_id)
     DO UPDATE SET count = stash_items.count + $3, updated_at = now()`,
    [accountId, itemId, count],
  );
  return "ok";
}

async function withdrawFromStash(
  client: Tx,
  accountId: string,
  itemId: string,
  count: number,
): Promise<"ok" | "not_enough"> {
  const row = await client.query<{ count: number }>(
    "SELECT count FROM stash_items WHERE account_id = $1 AND item_id = $2 FOR UPDATE",
    [accountId, itemId],
  );
  const have = row.rows[0]?.count ?? 0;
  if (have < count) return "not_enough";
  if (have === count) {
    await client.query("DELETE FROM stash_items WHERE account_id = $1 AND item_id = $2", [accountId, itemId]);
  } else {
    await client.query(
      "UPDATE stash_items SET count = count - $3, updated_at = now() WHERE account_id = $1 AND item_id = $2",
      [accountId, itemId, count],
    );
  }
  return "ok";
}

interface ListingRow {
  id: string;
  seller_account: string;
  item_id: string;
  count: number;
  price: string;
  status: string;
  created_at: string;
}

function toView(row: ListingRow, selfAccountId?: string) {
  return {
    id: row.id,
    itemId: row.item_id,
    count: row.count,
    price: Number(row.price),
    status: row.status,
    mine: row.seller_account === selfAccountId,
    // Anonymized seller tag; real display names come with a profiles feature.
    seller: `Player-${row.seller_account.slice(0, 4)}`,
    createdAt: row.created_at,
  };
}

export function registerMarketRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, pool } = ctx;
  const requireAuth = makeRequireAuth(config);

  /** Browse open listings, newest first. */
  app.get("/api/market/listings", { preHandler: requireAuth }, async (request) => {
    const res = await pool.query<ListingRow>(
      `SELECT id, seller_account, item_id, count, price, status, created_at
       FROM market_listings WHERE status = 'open' ORDER BY created_at DESC LIMIT $1`,
      [BROWSE_LIMIT],
    );
    return { listings: res.rows.map((r) => toView(r, request.accountId)) };
  });

  /** My listings (any status), newest first. */
  app.get("/api/market/mine", { preHandler: requireAuth }, async (request) => {
    const res = await pool.query<ListingRow>(
      `SELECT id, seller_account, item_id, count, price, status, created_at
       FROM market_listings WHERE seller_account = $1 ORDER BY created_at DESC LIMIT 20`,
      [request.accountId],
    );
    return { listings: res.rows.map((r) => toView(r, request.accountId)) };
  });

  /** Create a listing: escrow items out of the stash. */
  app.post(
    "/api/market/list",
    {
      preHandler: requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["itemId", "count", "price"],
          properties: {
            itemId: { type: "string", minLength: 1, maxLength: 64 },
            count: { type: "integer", minimum: 1, maximum: 999 },
            price: { type: "integer", minimum: 1, maximum: 1000000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { itemId, count, price } = request.body as { itemId: string; count: number; price: number };
      if (!itemDef(itemId)) return reply.code(404).send({ error: "unknown_item" });

      const result = await withTransaction(pool, async (client) => {
        const openCount = await client.query<{ count: string }>(
          "SELECT count(*) FROM market_listings WHERE seller_account = $1 AND status = 'open'",
          [request.accountId],
        );
        if (Number(openCount.rows[0]!.count) >= MAX_OPEN_LISTINGS_PER_ACCOUNT) {
          return { code: 409 as const, error: "listing_limit_reached" };
        }
        const escrow = await withdrawFromStash(client, request.accountId!, itemId, count);
        if (escrow !== "ok") return { code: 409 as const, error: "not_in_stash" };
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO market_listings (seller_account, item_id, count, price) VALUES ($1, $2, $3, $4) RETURNING id",
          [request.accountId, itemId, count, price],
        );
        return { code: 201 as const, id: inserted.rows[0]!.id };
      });
      if (result.code !== 201) return reply.code(result.code).send({ error: result.error });
      return reply.code(201).send({ id: result.id });
    },
  );

  /** Buy a listing: gold buyer->seller, items row->buyer stash, atomically. */
  app.post(
    "/api/market/buy",
    {
      preHandler: requireAuth,
      schema: {
        body: { type: "object", required: ["listingId"], properties: { listingId: { type: "string", format: "uuid" } } },
      },
    },
    async (request, reply) => {
      const { listingId } = request.body as { listingId: string };
      let result: { code: 200; balance: number } | { code: 402 | 404 | 409; error: string };
      try {
        result = await withTransaction(pool, async (client) => {
          const row = await client.query<ListingRow>(
            "SELECT id, seller_account, item_id, count, price, status, created_at FROM market_listings WHERE id = $1 FOR UPDATE",
            [listingId],
          );
          // Pre-mutation guards may plain-return (nothing to roll back yet).
          if (!row.rowCount) return { code: 404 as const, error: "listing_not_found" };
          const listing = row.rows[0]!;
          if (listing.status !== "open") return { code: 409 as const, error: "not_open" };
          if (listing.seller_account === request.accountId) return { code: 409 as const, error: "own_listing" };

          // 1. Conditional debit — the WHERE clause is the balance check, and
          //    it is the FIRST mutation, so a failed payment mutates nothing.
          const price = Number(listing.price);
          const debit = await client.query<{ currency: string }>(
            "UPDATE meta_wallets SET currency = currency - $2, updated_at = now() WHERE account_id = $1 AND currency >= $2 RETURNING currency",
            [request.accountId, price],
          );
          if (!debit.rowCount) return { code: 402 as const, error: "insufficient_currency" };

          // 2..4 follow mutations — any failure past this point must THROW so
          //    the whole transaction (including the debit) rolls back.
          // Market fee: 5% of the sale price (min 1g) leaves the economy — the
          // buyer pays full price, the seller receives price minus the fee.
          // This is the P2P gold sink (Kintara-style burn; ECONOMY_LAWS spend
          // split). Pre-token it simply vanishes; the token-era ledger will
          // book it under the burn share.
          const fee = Math.max(1, Math.floor(price * 0.05));
          await client.query(
            "UPDATE meta_wallets SET currency = currency + $2, updated_at = now() WHERE account_id = $1",
            [listing.seller_account, price - fee],
          );
          const deposit = await depositIntoStash(client, request.accountId!, listing.item_id, listing.count);
          if (deposit !== "ok") throw new TxAbort(409, deposit);
          await client.query(
            "UPDATE market_listings SET status = 'sold', buyer_account = $2, updated_at = now() WHERE id = $1",
            [listingId, request.accountId],
          );
          return { code: 200 as const, balance: Number(debit.rows[0]!.currency) };
        });
      } catch (err) {
        if (err instanceof TxAbort) return reply.code(err.code).send({ error: err.errorId });
        throw err;
      }
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send({ ok: true, balance: result.balance });
    },
  );

  /** Cancel my open listing: escrowed items return to my stash. */
  app.post(
    "/api/market/cancel",
    {
      preHandler: requireAuth,
      schema: {
        body: { type: "object", required: ["listingId"], properties: { listingId: { type: "string", format: "uuid" } } },
      },
    },
    async (request, reply) => {
      const { listingId } = request.body as { listingId: string };
      const result = await withTransaction(pool, async (client) => {
        const row = await client.query<ListingRow>(
          "SELECT id, seller_account, item_id, count, price, status, created_at FROM market_listings WHERE id = $1 FOR UPDATE",
          [listingId],
        );
        if (!row.rowCount || row.rows[0]!.seller_account !== request.accountId) {
          return { code: 404 as const, error: "listing_not_found" };
        }
        const listing = row.rows[0]!;
        if (listing.status !== "open") return { code: 409 as const, error: "not_open" };
        const back = await depositIntoStash(client, request.accountId!, listing.item_id, listing.count);
        if (back !== "ok") return { code: 409 as const, error: back }; // free stash space first
        await client.query("UPDATE market_listings SET status = 'cancelled', updated_at = now() WHERE id = $1", [listingId]);
        return { code: 200 as const };
      });
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send({ ok: true });
    },
  );
}
