// Devnet bootstrap for the gold-exchange buy leg. DEVNET ONLY — everything
// here is valueless test infrastructure. Creates a throwaway treasury keypair
// (saved locally, gitignored) and a 9-decimal SPL mint, mints supply to the
// treasury, and prints the backend env block.
//
//   node tools/setup_devnet.mjs setup          # one-time: keypair + mint + supply
//   node tools/setup_devnet.mjs fund <wallet> <tokens>   # send test tokens to a tester
//
// Uses the client workspace's @solana/web3.js + @solana/spl-token.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, transfer } from "@solana/spl-token";

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEYPAIR_PATH = resolve(root, "backend/.devnet-treasury.json");
const STATE_PATH = resolve(root, "backend/.devnet-state.json");
const DECIMALS = 9;

const connection = new Connection(RPC, "confirmed");

function loadTreasury() {
  if (!existsSync(KEYPAIR_PATH)) throw new Error("run `setup` first (no treasury keypair)");
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"))));
}

async function airdropWithRetry(pubkey, sol = 2) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      return;
    } catch (err) {
      console.log(`airdrop attempt ${attempt + 1} failed (${err.message}); retrying in 3s…`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("devnet airdrop kept failing — faucet may be rate-limited; try again later or fund the treasury manually via https://faucet.solana.com");
}

async function setup() {
  let treasury;
  if (existsSync(KEYPAIR_PATH)) {
    treasury = loadTreasury();
    console.log("reusing existing treasury keypair");
  } else {
    treasury = Keypair.generate();
    writeFileSync(KEYPAIR_PATH, JSON.stringify(Array.from(treasury.secretKey)));
    console.log("treasury keypair saved to backend/.devnet-treasury.json (gitignored)");
  }
  console.log("treasury:", treasury.publicKey.toBase58());

  const balance = await connection.getBalance(treasury.publicKey);
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log("requesting devnet SOL airdrop…");
    await airdropWithRetry(treasury.publicKey);
  }
  console.log("SOL:", (await connection.getBalance(treasury.publicKey)) / LAMPORTS_PER_SOL);

  let mint;
  const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};
  if (state.mint) {
    mint = new PublicKey(state.mint);
    console.log("reusing existing mint");
  } else {
    mint = await createMint(connection, treasury, treasury.publicKey, null, DECIMALS);
    writeFileSync(STATE_PATH, JSON.stringify({ mint: mint.toBase58() }, null, 2));
  }
  console.log("mint:", mint.toBase58());

  const ata = await getOrCreateAssociatedTokenAccount(connection, treasury, mint, treasury.publicKey);
  const supply = 1_000_000n * 10n ** BigInt(DECIMALS);
  if (BigInt(ata.amount) < supply / 2n) {
    await mintTo(connection, treasury, mint, ata.address, treasury, supply);
    console.log("minted 1,000,000 test tokens to the treasury");
  }

  console.log("\n=== add to games/depthbreaker/backend/.env ===");
  console.log(`SOLANA_RPC_URL=${RPC}`);
  console.log(`TOKEN_MINT=${mint.toBase58()}`);
  console.log(`TREASURY_WALLET=${treasury.publicKey.toBase58()}`);
  console.log("TOKEN_USD_PRICE=0.01");
  console.log("GOLD_MARKET_BUY_ENABLED=true");
}

async function fund(wallet, tokens) {
  const treasury = loadTreasury();
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  const mint = new PublicKey(state.mint);
  const dest = new PublicKey(wallet);
  const from = await getOrCreateAssociatedTokenAccount(connection, treasury, mint, treasury.publicKey);
  const to = await getOrCreateAssociatedTokenAccount(connection, treasury, mint, dest);
  const amount = BigInt(Math.round(Number(tokens))) * 10n ** BigInt(DECIMALS);
  const sig = await transfer(connection, treasury, from.address, to.address, treasury, amount);
  console.log(`sent ${tokens} test tokens to ${wallet}`);
  console.log("tx:", sig);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "setup") await setup();
else if (cmd === "fund" && args.length === 2) await fund(args[0], args[1]);
else {
  console.log("usage: node tools/setup_devnet.mjs setup | fund <wallet> <tokens>");
  process.exit(1);
}
