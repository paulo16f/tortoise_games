// scrypt password hashing via node:crypto — no native-build dependencies.
// Format: scrypt$N$r$p$<salt hex>$<key hex>

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex!, "hex");
  const expected = Buffer.from(keyHex!, "hex");
  const key = await scrypt(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
