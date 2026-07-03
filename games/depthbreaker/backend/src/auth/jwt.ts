// Access-token JWTs (HS256, short-lived, held in client memory only).

import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();

export async function signAccessToken(
  accountId: string,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(accountId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encoder.encode(secret));
}

/** Returns the account id, or null for any invalid/expired token. */
export async function verifyAccessToken(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}
