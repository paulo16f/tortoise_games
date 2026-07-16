// App configuration. Env parsing reuses the repo-shared helpers
// (shared/lib/config.ts); values here fail closed in production via the
// health route (routes/health.ts).

import { env, envNumber, ProductionReadinessError } from "../../../../shared/lib/config.js";

export { ProductionReadinessError };

export const DEV_SESSION_SECRET = "dev-session-secret-change-me";
export const DEV_ZONE_SHARED_SECRET = "dev-zone-shared-secret-change-me";

export type LaunchPhase = "phase0" | "phase2";

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  launchPhase: LaunchPhase;
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  zoneSharedSecret: string;
  /** wss:// URL clients connect to for the zone server (behind nginx). */
  zoneWsUrl: string;
  corsOrigin: string;
  accessTokenTtlSeconds: number;
  refreshTtlGuestSeconds: number;
  refreshTtlEmailSeconds: number;
  joinTicketTtlSeconds: number;
  refreshCookieName: string;
  /** Solana leg (gold-exchange buy). ALL FOUR must be set + the flag true or
   *  the buy route stays 503 phase2_locked (fail closed, AGENTS.md). Devnet
   *  values come from tools/setup_devnet.mjs; mainnet at launch prep only. */
  solanaRpcUrl: string;
  tokenMint: string;
  treasuryWallet: string;
  /** Fixed USD per token for quotes (devnet). Mainnet swaps this for an oracle. */
  tokenUsdPrice: number;
  goldMarketBuyEnabled: boolean;
}

export function loadConfig(): AppConfig {
  const nodeEnv = env("NODE_ENV") || "development";
  const launchPhase = parseLaunchPhase(env("DEPTHBREAKER_LAUNCH_PHASE") || "phase0");
  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    launchPhase,
    port: envNumber(3100, "PORT"),
    databaseUrl:
      env("DATABASE_URL") || "postgres://depthbreaker:depthbreaker@localhost:5432/depthbreaker",
    sessionSecret: env("SESSION_SECRET") || DEV_SESSION_SECRET,
    zoneSharedSecret: env("ZONE_SHARED_SECRET") || DEV_ZONE_SHARED_SECRET,
    // Points at the Colyseus realtime server (the "zone server" in the web stack).
    zoneWsUrl: env("ZONE_WS_URL") || "ws://localhost:2667",
    // Default to the Vite client dev origin so credentialed fetches work locally.
    corsOrigin: env("CORS_ORIGIN") || "http://localhost:5184",
    accessTokenTtlSeconds: envNumber(900, "ACCESS_TOKEN_TTL_SECONDS"),
    refreshTtlGuestSeconds: envNumber(30 * 24 * 3600, "REFRESH_TTL_GUEST_SECONDS"),
    refreshTtlEmailSeconds: envNumber(7 * 24 * 3600, "REFRESH_TTL_EMAIL_SECONDS"),
    joinTicketTtlSeconds: envNumber(60, "JOIN_TICKET_TTL_SECONDS"),
    refreshCookieName: "db_refresh",
    solanaRpcUrl: env("SOLANA_RPC_URL") || "",
    tokenMint: env("TOKEN_MINT") || "",
    treasuryWallet: env("TREASURY_WALLET") || "",
    tokenUsdPrice: envNumber(0, "TOKEN_USD_PRICE"),
    goldMarketBuyEnabled: env("GOLD_MARKET_BUY_ENABLED") === "true",
  };
}

/** True only when every Solana env value exists AND the flag is on. */
export function goldMarketBuyReady(config: AppConfig): boolean {
  return (
    config.goldMarketBuyEnabled &&
    config.solanaRpcUrl.length > 0 &&
    config.tokenMint.length > 0 &&
    config.treasuryWallet.length > 0 &&
    config.tokenUsdPrice > 0
  );
}

function parseLaunchPhase(value: string): LaunchPhase {
  if (value === "phase2") return "phase2";
  return "phase0";
}
