// Phantom wallet integration (devnet test build). Three jobs only:
//   1. connect() — get the player's wallet address from the Phantom extension;
//   2. linkWallet() — SIWS: sign the server's message (NEVER a transaction) to
//      bind the wallet to the account;
//   3. payGoldQuote() — build the SPL transfer the server QUOTED (amounts +
//      destinations are server-dictated; the client only signs), send it via
//      Phantom, and return the signature for server-side verification.
// The game never sees a private key and never decides an amount.

// The Solana libs are LAZY-LOADED inside buyGoldListing: they reference Node's
// Buffer at module scope, so a static import would run before main.tsx's
// polyfill (imports are hoisted) and blank the whole app. Dynamic import also
// keeps ~400KB of web3 code off the critical path for non-traders.
import type { Transaction } from "@solana/web3.js";
import { withAuth } from "./session";
import { siwsNonce, siwsLink, siwsStatus, goldMarketQuote, goldMarketBuy, type GoldQuote } from "./backend";

// Devnet RPC for tx building/confirmation (must match the backend's verifier).
const SOLANA_RPC_URL = (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined) || "https://api.devnet.solana.com";

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  signMessage(message: Uint8Array, encoding: "utf8"): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
}

function provider(): PhantomProvider | null {
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  const p = w.phantom?.solana ?? w.solana;
  return p?.isPhantom ? p : null;
}

export function hasPhantom(): boolean {
  return provider() !== null;
}

/** Connect Phantom and return the wallet address (throws if not installed). */
export async function connectWallet(): Promise<string> {
  const p = provider();
  if (!p) throw new Error("Phantom wallet not found — install it from phantom.app");
  const res = await p.connect();
  return res.publicKey.toBase58();
}

/** Linked wallet on the ACCOUNT (server truth), or null. */
export async function linkedWallet(): Promise<string | null> {
  const status = await withAuth((token) => siwsStatus(token));
  return status.wallet;
}

/** SIWS link: server nonce → wallet signs the server's message → server binds. */
export async function linkWallet(): Promise<string> {
  const p = provider();
  if (!p) throw new Error("Phantom wallet not found — install it from phantom.app");
  const wallet = await connectWallet();
  const { nonce, message } = await withAuth((token) => siwsNonce(token));
  const signed = await p.signMessage(new TextEncoder().encode(message), "utf8");
  const signatureB64 = btoa(String.fromCharCode(...signed.signature));
  await withAuth((token) => siwsLink(token, wallet, nonce, signatureB64));
  return wallet;
}

/**
 * Full buy flow for a gold listing: quote → build the exact transfer → Phantom
 * signs+sends → submit the signature for on-chain verification + settlement.
 * Returns the gold received.
 */
export async function buyGoldListing(listingId: string): Promise<{ goldReceived: number; balance: number }> {
  const p = provider();
  if (!p) throw new Error("Phantom wallet not found — install it from phantom.app");
  await p.connect();

  const [{ Connection, PublicKey, Transaction }, { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync }] = await Promise.all([
    import("@solana/web3.js"),
    import("@solana/spl-token"),
  ]);

  const quote: GoldQuote = await withAuth((token) => goldMarketQuote(token, listingId));
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const buyer = new PublicKey(quote.buyerWallet);
  const mint = new PublicKey(quote.mint);
  const seller = new PublicKey(quote.sellerWallet);
  const treasury = new PublicKey(quote.treasuryWallet);

  const buyerAta = getAssociatedTokenAddressSync(mint, buyer);
  const sellerAta = getAssociatedTokenAddressSync(mint, seller);
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury);

  const tx = new Transaction();
  // Create destination token accounts if missing (idempotent — no-ops if present).
  tx.add(createAssociatedTokenAccountIdempotentInstruction(buyer, sellerAta, seller, mint));
  tx.add(createAssociatedTokenAccountIdempotentInstruction(buyer, treasuryAta, treasury, mint));
  tx.add(createTransferInstruction(buyerAta, sellerAta, buyer, BigInt(quote.sellerAmountBase)));
  tx.add(createTransferInstruction(buyerAta, treasuryAta, buyer, BigInt(quote.treasuryAmountBase)));
  tx.feePayer = buyer;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  const { signature } = await p.signAndSendTransaction(tx);
  await connection.confirmTransaction(signature, "confirmed");

  return withAuth((token) => goldMarketBuy(token, listingId, signature));
}
