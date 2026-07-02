import bs58 from "bs58";

export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export function publicKeyBytes(wallet: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(wallet);
  } catch {
    throw new Error("Invalid wallet address");
  }
  if (bytes.length !== 32) throw new Error("Invalid wallet address");
  return bytes;
}

export function normalizePublicKey(wallet: string): string {
  return bs58.encode(publicKeyBytes(wallet));
}

export async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${method}:${Date.now()}`,
      method,
      params,
    }),
  });
  if (!res.ok) throw new Error(`Solana RPC ${method} failed with HTTP ${res.status}`);
  const data = await res.json() as { result?: T; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message ?? `Solana RPC ${method} failed`);
  return data.result as T;
}
