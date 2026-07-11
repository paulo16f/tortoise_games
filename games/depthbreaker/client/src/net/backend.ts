// REST client for the Fastify backend (http://localhost:3100 by default).
// All calls use credentials:"include" so the HttpOnly db_refresh cookie flows.
// These are dumb HTTP wrappers; session/token orchestration lives in session.ts.

import type { ClassId } from "@depthbreaker/protocol";
import { BACKEND_URL } from "../config";

/** Thrown on any non-2xx response; carries the HTTP status for 401 refresh logic. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Auth endpoints all return the same session shape (+ set the refresh cookie). */
export interface AuthResult {
  accountId: string;
  accessToken: string;
  expiresIn: number;
}

export interface CharacterSummary {
  id: string;
  name: string;
  class_id: string;
  /** Persistent cross-run XP; drives the displayed level via levelForTotalXp. */
  total_xp: number;
}

export interface StartRunResult {
  runId: string;
  seed: number;
  wsUrl: string;
  joinTicket: string;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BACKEND_URL}${path}`, { ...init, credentials: "include", headers });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* ignore body parse errors */
    }
    throw new ApiError(res.status, `${res.status} ${res.statusText} ${detail}`.trim());
  }
  return (await res.json()) as T;
}

// --- Auth ---

/** POST /api/auth/guest — a fresh anonymous account (progress persists via cookie). */
export function guestLogin(): Promise<AuthResult> {
  return request<AuthResult>("/api/auth/guest", { method: "POST", body: "{}" });
}

/** POST /api/auth/register — new email account, or upgrades the current guest in place. */
export function register(email: string, password: string, token?: string): Promise<AuthResult> {
  return request<AuthResult>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }, token);
}

/** POST /api/auth/login — email + password. */
export function login(email: string, password: string): Promise<AuthResult> {
  return request<AuthResult>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

/** POST /api/auth/refresh — mint a fresh access token from the refresh cookie. */
export function refresh(): Promise<AuthResult> {
  return request<AuthResult>("/api/auth/refresh", { method: "POST" });
}

/** POST /api/auth/logout — revoke the refresh-token family + clear the cookie. */
export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

// --- Characters ---

export async function createCharacter(token: string, name: string, classId: ClassId): Promise<CharacterSummary> {
  const body = await request<{ character: CharacterSummary }>(
    "/api/characters",
    { method: "POST", body: JSON.stringify({ name, classId }) },
    token,
  );
  return body.character;
}

export async function listCharacters(token: string): Promise<CharacterSummary[]> {
  const body = await request<{ characters: CharacterSummary[] }>("/api/characters", { method: "GET" }, token);
  return body.characters;
}

export function deleteCharacter(token: string, id: string): Promise<void> {
  return request<void>(`/api/characters/${id}`, { method: "DELETE" }, token);
}

// --- Runs ---

export function startRun(token: string, characterId: string): Promise<StartRunResult> {
  return request<StartRunResult>("/api/runs/start", { method: "POST", body: JSON.stringify({ characterId }) }, token);
}
