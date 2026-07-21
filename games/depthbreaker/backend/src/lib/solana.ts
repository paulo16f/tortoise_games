// On-chain SPL payment verification (Phase 2 gold-exchange buy leg). Zero
// dependencies — plain JSON-RPC (`getTransaction` jsonParsed) like siws.ts uses
// node:crypto. The server never builds or signs transactions here; it only
// VERIFIES that a player-signed payment did what the quote demanded:
//   - transaction confirmed, no error;
//   - signed by the buyer's linked wallet;
//   - token balance deltas for OUR mint: seller received >= their cut and the
//     treasury received >= its fee.
// Replay is impossible one layer up: token_ledger.tx_signature is UNIQUE.

export interface SplExpectation {
  /** Wallet (owner) that must have RECEIVED tokens. */
  owner: string;
  /** Minimum received amount in base units (string to avoid float drift). */
  minAmountBase: bigint;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

interface ParsedTx {
  meta: {
    err: unknown;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
  transaction: {
    message: {
      accountKeys: { pubkey: string; signer: boolean }[];
    };
  };
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`solana rpc ${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? `solana rpc ${method} failed`);
  return body.result as T;
}

/** Net received tokens (base units) per owner for `mint` in a parsed tx. */
function ownerDeltas(tx: ParsedTx, mint: string): Map<string, bigint> {
  const deltas = new Map<string, bigint>();
  const apply = (balances: TokenBalance[] | undefined, sign: 1n | -1n) => {
    for (const b of balances ?? []) {
      if (b.mint !== mint || !b.owner) continue;
      const cur = deltas.get(b.owner) ?? 0n;
      deltas.set(b.owner, cur + sign * BigInt(b.uiTokenAmount.amount));
    }
  };
  apply(tx.meta?.postTokenBalances, 1n);
  apply(tx.meta?.preTokenBalances, -1n);
  return deltas;
}

/**
 * Verify a confirmed SPL payment. `signerWallet` must be a fee-payer/signer of
 * the transaction (the buyer paid from their own wallet — Law 4/7).
 */
export async function verifySplPayment(
  rpcUrl: string,
  txSignature: string,
  mint: string,
  signerWallet: string,
  expectations: SplExpectation[],
): Promise<VerifyResult> {
  let tx: ParsedTx | null;
  try {
    tx = await rpc<ParsedTx | null>(rpcUrl, "getTransaction", [
      txSignature,
      { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]);
  } catch (err) {
    return { ok: false, reason: `rpc_error: ${(err as Error).message}` };
  }
  if (!tx || !tx.meta) return { ok: false, reason: "tx_not_found" };
  if (tx.meta.err) return { ok: false, reason: "tx_failed" };

  const signers = tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey);
  if (!signers.includes(signerWallet)) return { ok: false, reason: "wrong_signer" };

  const deltas = ownerDeltas(tx, mint);
  for (const expect of expectations) {
    const received = deltas.get(expect.owner) ?? 0n;
    if (received < expect.minAmountBase) {
      return { ok: false, reason: `underpaid:${expect.owner}:${received}/${expect.minAmountBase}` };
    }
  }
  return { ok: true };
}

/** Convert a USD price to token base units at a fixed USD/token rate.
 *  Devnet uses a configured rate; mainnet will use an oracle at launch prep. */
export function usdToTokenBase(usd: number, tokenUsdPrice: number, decimals: number): bigint {
  if (tokenUsdPrice <= 0) throw new Error("token price not configured");
  const tokens = usd / tokenUsdPrice;
  return BigInt(Math.round(tokens * 10 ** decimals));
}

export const TOKEN_DECIMALS = 9;
export const SELLER_SHARE = 0.95;
