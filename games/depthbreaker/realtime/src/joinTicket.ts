// Verifies the 60-second HS256 join ticket the backend issues at
// POST /api/runs/start. Same secret, same claim names as
// backend/src/auth/joinTicket.ts — the realtime server is the "zone server"
// in the design doc's trust model.

import { jwtVerify } from "jose";

const encoder = new TextEncoder();

export interface JoinTicketClaims {
  accountId: string;
  characterId: string;
  runId: string;
  seed: number;
  /** Character's persistent total XP at run start; drives the base level. */
  totalXp: number;
}

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
