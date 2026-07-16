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
import { goldMarketBuyReady } from "../config.js";
import { verifySplPayment, usdToTokenBase, TOKEN_DECIMALS, SELLER_SHARE } from "../lib/solana.js";

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

  /** Split a listing's USD price into seller/treasury token amounts (base units).
   *  The SERVER dictates every number — the client only signs what we quote. */
  function quoteAmounts(usdPrice: number): { seller: bigint; treasury: bigint } {
    const total = usdToTokenBase(usdPrice, config.tokenUsdPrice, TOKEN_DECIMALS);
    const seller = (total * BigInt(Math.round(SELLER_SHARE * 100))) / 100n;
    return { seller, treasury: total - seller };
  }

  /** Payment quote for a listing: destinations + exact token amounts. The buyer
   *  builds a transfer matching this, signs with their own wallet, and submits
   *  the signature to /buy. Requires BOTH parties to have linked wallets. */
  app.post(
    "/api/goldmarket/quote",
    {
      preHandler: requireAuth,
      schema: {
        body: { type: "object", required: ["listingId"], properties: { listingId: { type: "string", format: "uuid" } } },
      },
    },
    async (request, reply) => {
      if (!goldMarketBuyReady(config)) {
        return reply.code(503).send({ error: "phase2_locked", detail: "Solana env not configured." });
      }
      const { listingId } = request.body as { listingId: string };
      const row = await pool.query<GoldListingRow & { seller_wallet: string | null }>(
        `SELECT l.id, l.seller_account, l.gold_amount, l.usd_price, l.status, l.created_at, a.wallet AS seller_wallet
         FROM gold_listings l JOIN accounts a ON a.id = l.seller_account WHERE l.id = $1`,
        [listingId],
      );
      const listing = row.rows[0];
      if (!listing || listing.status !== "open") return reply.code(404).send({ error: "listing_not_open" });
      if (listing.seller_account === request.accountId) return reply.code(409).send({ error: "own_listing" });
      if (!listing.seller_wallet) return reply.code(409).send({ error: "seller_has_no_wallet" });
      const buyer = await pool.query<{ wallet: string | null }>("SELECT wallet FROM accounts WHERE id = $1", [request.accountId]);
      const buyerWallet = buyer.rows[0]?.wallet;
      if (!buyerWallet) return reply.code(409).send({ error: "link_wallet_first" });

      const amounts = quoteAmounts(Number(listing.usd_price));
      return reply.send({
        listingId,
        mint: config.tokenMint,
        decimals: TOKEN_DECIMALS,
        buyerWallet,
        sellerWallet: listing.seller_wallet,
        treasuryWallet: config.treasuryWallet,
        sellerAmountBase: amounts.seller.toString(),
        treasuryAmountBase: amounts.treasury.toString(),
        goldAmount: Number(listing.gold_amount),
        usdPrice: Number(listing.usd_price),
      });
    },
  );

  /** Buy = the on-chain leg. The buyer paid seller (95%) + treasury (5%) in
   *  $TOKEN from their own wallet; we verify the confirmed transaction on-chain
   *  and only then release the escrowed gold. Replay-proof: token_ledger's
   *  UNIQUE tx_signature is inserted in the SAME transaction as settlement. */
  app.post(
    "/api/goldmarket/buy",
    {
      preHandler: requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["listingId", "txSignature"],
          properties: {
            listingId: { type: "string", format: "uuid" },
            txSignature: { type: "string", minLength: 64, maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!goldMarketBuyReady(config)) {
        return reply.code(503).send({ error: "phase2_locked", detail: "Solana env not configured." });
      }
      const { listingId, txSignature } = request.body as { listingId: string; txSignature: string };

      // Load the parties OUTSIDE the settle tx (RPC verification is slow; never
      // hold row locks across the network call).
      const row = await pool.query<GoldListingRow & { seller_wallet: string | null }>(
        `SELECT l.id, l.seller_account, l.gold_amount, l.usd_price, l.status, l.created_at, a.wallet AS seller_wallet
         FROM gold_listings l JOIN accounts a ON a.id = l.seller_account WHERE l.id = $1`,
        [listingId],
      );
      const listing = row.rows[0];
      if (!listing || listing.status !== "open") return reply.code(404).send({ error: "listing_not_open" });
      if (listing.seller_account === request.accountId) return reply.code(409).send({ error: "own_listing" });
      if (!listing.seller_wallet) return reply.code(409).send({ error: "seller_has_no_wallet" });
      const buyer = await pool.query<{ wallet: string | null }>("SELECT wallet FROM accounts WHERE id = $1", [request.accountId]);
      const buyerWallet = buyer.rows[0]?.wallet;
      if (!buyerWallet) return reply.code(409).send({ error: "link_wallet_first" });

      const amounts = quoteAmounts(Number(listing.usd_price));
      const verdict = await verifySplPayment(config.solanaRpcUrl, txSignature, config.tokenMint, buyerWallet, [
        { owner: listing.seller_wallet, minAmountBase: amounts.seller },
        { owner: config.treasuryWallet, minAmountBase: amounts.treasury },
      ]);
      if (!verdict.ok) {
        request.log.warn({ listingId, txSignature, reason: verdict.reason }, "gold buy verification failed");
        return reply.code(402).send({ error: "payment_not_verified", detail: verdict.reason });
      }

      const result = await withTransaction(pool, async (client) => {
        // Replay brake FIRST: the UNIQUE tx_signature makes double-settlement
        // impossible even if two requests verified the same payment.
        try {
          await client.query(
            `INSERT INTO token_ledger (kind, account_id, token_amount, treasury_amount, tx_signature, ref)
             VALUES ('fee', $1, $2, $3, $4, $5)`,
            [
              request.accountId,
              (Number(amounts.seller + amounts.treasury) / 10 ** TOKEN_DECIMALS).toFixed(9),
              (Number(amounts.treasury) / 10 ** TOKEN_DECIMALS).toFixed(9),
              txSignature,
              `goldmarket:${listingId}`,
            ],
          );
        } catch (err: unknown) {
          if (typeof err === "object" && err && (err as { code?: string }).code === "23505") {
            return { code: 409 as const, error: "tx_signature_reused" };
          }
          throw err;
        }
        const upd = await client.query(
          "UPDATE gold_listings SET status = 'sold', updated_at = now() WHERE id = $1 AND status = 'open'",
          [listingId],
        );
        if (!upd.rowCount) return { code: 409 as const, error: "not_open" };
        // Escrowed gold releases to the BUYER (the seller was debited at list time).
        const credit = await client.query<{ currency: string }>(
          `INSERT INTO meta_wallets (account_id, currency) VALUES ($1, $2)
           ON CONFLICT (account_id) DO UPDATE SET currency = meta_wallets.currency + $2, updated_at = now()
           RETURNING currency`,
          [request.accountId, Number(listing.gold_amount)],
        );
        return { code: 200 as const, gold: Number(listing.gold_amount), balance: Number(credit.rows[0]?.currency ?? 0) };
      });
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send({ ok: true, goldReceived: result.gold, balance: result.balance });
    },
  );
}
