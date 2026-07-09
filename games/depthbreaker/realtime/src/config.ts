// Realtime server configuration. Shares the ZONE_SHARED_SECRET with the backend
// (join-ticket signing/verification) and BACKEND_URL for /internal reporting.

function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const DEV_ZONE_SHARED_SECRET = "dev-zone-shared-secret-change-me";

export interface RealtimeConfig {
  port: number;
  zoneSharedSecret: string;
  backendUrl: string;
  /** Set false to allow ticketless dev connections (see ZoneRoom.onAuth). */
  requireTicket: boolean;
  isProduction: boolean;
}

export function loadConfig(): RealtimeConfig {
  const nodeEnv = env("NODE_ENV", "development");
  return {
    // Railway (and most PaaS) inject the listen port as PORT; fall back to
    // REALTIME_PORT then the local default.
    port: envNumber("PORT", envNumber("REALTIME_PORT", 2567)),
    zoneSharedSecret: env("ZONE_SHARED_SECRET", DEV_ZONE_SHARED_SECRET),
    backendUrl: env("BACKEND_URL", "http://localhost:3000"),
    // Dev default: allow ticketless joins so you can open the client without a
    // full auth round-trip. Production MUST require tickets.
    requireTicket: env("REQUIRE_TICKET", nodeEnv === "production" ? "true" : "false") === "true",
    isProduction: nodeEnv === "production",
  };
}
