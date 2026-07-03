// App configuration. Env parsing reuses the repo-shared helpers
// (shared/lib/config.ts); values here fail closed in production via the
// health route (routes/health.ts).

import { env, envNumber, ProductionReadinessError } from "../../../../shared/lib/config.js";

export { ProductionReadinessError };

export const DEV_SESSION_SECRET = "dev-session-secret-change-me";
export const DEV_ZONE_SHARED_SECRET = "dev-zone-shared-secret-change-me";

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
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
}

export function loadConfig(): AppConfig {
  const nodeEnv = env("NODE_ENV") || "development";
  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    port: envNumber(3000, "PORT"),
    databaseUrl:
      env("DATABASE_URL") || "postgres://depthbreaker:depthbreaker@localhost:5432/depthbreaker",
    sessionSecret: env("SESSION_SECRET") || DEV_SESSION_SECRET,
    zoneSharedSecret: env("ZONE_SHARED_SECRET") || DEV_ZONE_SHARED_SECRET,
    // Points at the Colyseus realtime server (the "zone server" in the web stack).
    zoneWsUrl: env("ZONE_WS_URL") || "ws://localhost:2567",
    // Default to the Vite client dev origin so credentialed fetches work locally.
    corsOrigin: env("CORS_ORIGIN") || "http://localhost:5173",
    accessTokenTtlSeconds: envNumber(900, "ACCESS_TOKEN_TTL_SECONDS"),
    refreshTtlGuestSeconds: envNumber(30 * 24 * 3600, "REFRESH_TTL_GUEST_SECONDS"),
    refreshTtlEmailSeconds: envNumber(7 * 24 * 3600, "REFRESH_TTL_EMAIL_SECONDS"),
    joinTicketTtlSeconds: envNumber(60, "JOIN_TICKET_TTL_SECONDS"),
    refreshCookieName: "db_refresh",
  };
}
