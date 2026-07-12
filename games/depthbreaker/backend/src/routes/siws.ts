// SIWS wallet linking routes (Law 5: login/link is a signed message, NEVER a
// token transfer). Binds a Solana wallet to the CURRENT authed account —
// guests and email accounts alike (upgrade-in-place). The wallet is the
// Phase-2 P2P market gate; nothing else changes at link time.
//
// Flow: POST /nonce -> client wallet signs the canonical message ->
// POST /link { wallet, signature } -> server rebuilds the message from its
// own account id + nonce row, verifies ed25519, consumes the nonce, and
// stores the wallet (UNIQUE: one account per wallet).

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../server.js";
import { withTransaction } from "../db/pool.js";
import { makeRequireAuth } from "../plugins/guards.js";
import { randomUUID } from "node:crypto";
import { siwsLinkMessage, verifySiwsSignature, base58Decode32 } from "../lib/siws.js";

const NONCE_TTL_MS = 5 * 60 * 1000;

export function registerSiwsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, pool } = ctx;
  const requireAuth = makeRequireAuth(config);

  /** Issue a fresh nonce + the exact message the wallet must sign. */
  app.post("/api/auth/siws/nonce", { preHandler: requireAuth }, async (request, reply) => {
    const nonce = randomUUID();
    await pool.query(
      "INSERT INTO auth_nonces (nonce, account_id, expires_at) VALUES ($1, $2, now() + interval '5 minutes')",
      [nonce, request.accountId],
    );
    return reply.send({ nonce, message: siwsLinkMessage(request.accountId!, nonce), ttlMs: NONCE_TTL_MS });
  });

  /** Verify the signature and bind the wallet to this account. */
  app.post(
    "/api/auth/siws/link",
    {
      preHandler: requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["wallet", "nonce", "signature"],
          properties: {
            wallet: { type: "string", minLength: 32, maxLength: 44 },
            nonce: { type: "string", format: "uuid" },
            signature: { type: "string", minLength: 64, maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      const { wallet, nonce, signature } = request.body as { wallet: string; nonce: string; signature: string };
      try {
        base58Decode32(wallet);
      } catch {
        return reply.code(422).send({ error: "invalid_wallet" });
      }

      const result = await withTransaction(pool, async (client) => {
        // Consume the nonce under lock: unused, unexpired, THIS account.
        const row = await client.query<{ used: boolean; expired: boolean }>(
          "SELECT used, expires_at < now() AS expired FROM auth_nonces WHERE nonce = $1 AND account_id = $2 FOR UPDATE",
          [nonce, request.accountId],
        );
        if (!row.rowCount) return { code: 404 as const, error: "nonce_not_found" };
        if (row.rows[0]!.used || row.rows[0]!.expired) return { code: 409 as const, error: "nonce_spent" };
        await client.query("UPDATE auth_nonces SET used = true WHERE nonce = $1", [nonce]);

        // The message is rebuilt server-side — the client cannot vary it.
        const message = siwsLinkMessage(request.accountId!, nonce);
        if (!verifySiwsSignature(wallet, message, signature)) {
          return { code: 401 as const, error: "bad_signature" };
        }

        try {
          const upd = await client.query(
            "UPDATE accounts SET wallet = $2 WHERE id = $1 AND (wallet IS NULL OR wallet = $2)",
            [request.accountId, wallet],
          );
          if (!upd.rowCount) return { code: 409 as const, error: "account_has_wallet" };
        } catch (err: unknown) {
          // UNIQUE violation: this wallet already belongs to another account.
          if (typeof err === "object" && err && (err as { code?: string }).code === "23505") {
            return { code: 409 as const, error: "wallet_in_use" };
          }
          throw err;
        }
        return { code: 200 as const };
      });
      if (result.code !== 200) return reply.code(result.code).send({ error: result.error });
      return reply.send({ ok: true, wallet });
    },
  );

  /** Current link status (client shows "wallet linked" state). */
  app.get("/api/auth/siws/status", { preHandler: requireAuth }, async (request, reply) => {
    const row = await pool.query<{ wallet: string | null }>("SELECT wallet FROM accounts WHERE id = $1", [request.accountId]);
    return reply.send({ wallet: row.rows[0]?.wallet ?? null });
  });
}
