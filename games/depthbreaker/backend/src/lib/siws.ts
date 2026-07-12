// Sign-In-With-Solana primitives — self-contained (no new deps): base58 for
// wallet addresses + ed25519 verification via Node's built-in crypto. The
// message format is canonical and versioned; the client must sign it byte-
// for-byte, and the server rebuilds it from ITS OWN account id + nonce (never
// from request-body text), so a signature can't be replayed across accounts.

import { createPublicKey, verify as edVerify } from "node:crypto";

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = new Map([...B58_ALPHABET].map((c, i) => [c, i]));

/** Decode a base58 Solana address; throws on bad chars or wrong length. */
export function base58Decode32(input: string): Buffer {
  let num = 0n;
  for (const c of input) {
    const v = B58_MAP.get(c);
    if (v === undefined) throw new Error("invalid_base58");
    num = num * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.push(Number(num & 0xffn));
    num >>= 8n;
  }
  // Leading '1' characters encode leading zero bytes.
  for (const c of input) {
    if (c !== "1") break;
    bytes.push(0);
  }
  const out = Buffer.from(bytes.reverse());
  if (out.length !== 32) throw new Error("invalid_wallet_length");
  return out;
}

/** Encode 32 raw bytes as base58 (used by tests to derive an address). */
export function base58Encode(buf: Buffer): string {
  let num = 0n;
  for (const b of buf) num = (num << 8n) + BigInt(b);
  let out = "";
  while (num > 0n) {
    out = B58_ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** The canonical link message — rebuilt server-side, never taken from the body. */
export function siwsLinkMessage(accountId: string, nonce: string): string {
  return [
    "Depthbreaker wants you to link this Solana wallet to your account.",
    "This request will NOT trigger any transaction or cost any funds.",
    `Account: ${accountId}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

// ed25519 raw-public-key -> SPKI DER wrapper (RFC 8410).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Verify an ed25519 signature (base64) over `message` by base58 `wallet`. */
export function verifySiwsSignature(wallet: string, message: string, signatureB64: string): boolean {
  try {
    const raw = base58Decode32(wallet);
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
    const sig = Buffer.from(signatureB64, "base64");
    if (sig.length !== 64) return false;
    return edVerify(null, Buffer.from(message, "utf8"), key, sig);
  } catch {
    return false;
  }
}
