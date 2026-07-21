// Opaque rotated refresh tokens (design doc §7.2).
//
// The raw token lives only in the HttpOnly cookie; the DB stores a SHA-256
// hash. Every refresh rotates the token within a `family`; presenting an
// already-rotated token is treated as theft and revokes the whole family.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DbClient } from "../db/pool.js";

export interface IssuedRefreshToken {
  token: string;
  family: string;
  expiresAt: Date;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(
  client: DbClient,
  accountId: string,
  ttlSeconds: number,
  family?: string,
): Promise<IssuedRefreshToken> {
  const token = randomBytes(32).toString("base64url");
  const tokenFamily = family ?? randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await client.query(
    `INSERT INTO refresh_tokens (account_id, token_hash, family, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [accountId, hashToken(token), tokenFamily, expiresAt],
  );
  return { token, family: tokenFamily, expiresAt };
}

export async function revokeFamily(client: DbClient, family: string): Promise<void> {
  await client.query(
    "UPDATE refresh_tokens SET revoked_at = now() WHERE family = $1 AND revoked_at IS NULL",
    [family],
  );
}

export interface RotationResult {
  accountId: string;
  next: IssuedRefreshToken;
}

/**
 * Exchange a refresh token for a new one in the same family.
 * Returns null (after any necessary family revocation) when the token is
 * unknown, expired, revoked, or replayed.
 */
export async function rotateRefreshToken(
  client: DbClient,
  rawToken: string,
  ttlSeconds: number,
): Promise<RotationResult | null> {
  const res = await client.query<{
    id: string;
    account_id: string;
    family: string;
    expires_at: Date;
    rotated_at: Date | null;
    revoked_at: Date | null;
  }>("SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE", [hashToken(rawToken)]);
  const row = res.rows[0];
  if (!row) return null;

  if (row.revoked_at !== null || row.rotated_at !== null) {
    // Replay of a rotated/revoked token: contain the (possibly stolen) family.
    await revokeFamily(client, row.family);
    return null;
  }
  if (row.expires_at.getTime() <= Date.now()) return null;

  await client.query("UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1", [row.id]);
  const next = await issueRefreshToken(client, row.account_id, ttlSeconds, row.family);
  return { accountId: row.account_id, next };
}

/** Revoke the family a raw token belongs to (logout). No-op for unknown tokens. */
export async function revokeByToken(client: DbClient, rawToken: string): Promise<void> {
  const res = await client.query<{ family: string }>(
    "SELECT family FROM refresh_tokens WHERE token_hash = $1",
    [hashToken(rawToken)],
  );
  const family = res.rows[0]?.family;
  if (family) await revokeFamily(client, family);
}
