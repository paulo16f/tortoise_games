// Zone join tickets (design doc §3): 60-second HS256 JWTs signed with
// ZONE_SHARED_SECRET. The Unity zone server verifies them locally with plain
// HMAC (JoinTicketVerifier.cs) — claim names below are part of that contract.

import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();

export interface JoinTicketClaims {
  accountId: string;
  characterId: string;
  runId: string;
  seed: number; // uint32
  /** Character's persistent total XP at run start; drives the base level. */
  totalXp: number;
}

export async function signJoinTicket(
  claims: JoinTicketClaims,
  zoneSharedSecret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({
    cid: claims.characterId,
    rid: claims.runId,
    seed: claims.seed,
    txp: claims.totalXp,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.accountId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encoder.encode(zoneSharedSecret));
}

/** Mirror of the zone server's verification, used in tests. */
export async function verifyJoinTicket(
  token: string,
  zoneSharedSecret: string,
): Promise<JoinTicketClaims | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(zoneSharedSecret), {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.cid !== "string" ||
      typeof payload.rid !== "string" ||
      typeof payload.seed !== "number"
    ) {
      return null;
    }
    return {
      accountId: payload.sub,
      characterId: payload.cid,
      runId: payload.rid,
      seed: payload.seed,
      // Tolerate tickets without txp (pre-progression signers) as level 1.
      totalXp: typeof payload.txp === "number" ? payload.txp : 0,
    };
  } catch {
    return null;
  }
}
