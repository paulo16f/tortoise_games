// Environment-driven endpoints. In dev these default to the local backend and
// Colyseus realtime server. Override with VITE_BACKEND_URL / VITE_REALTIME_URL.

export const BACKEND_URL: string =
  import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

export const REALTIME_URL: string =
  import.meta.env.VITE_REALTIME_URL ?? "ws://localhost:2567";
