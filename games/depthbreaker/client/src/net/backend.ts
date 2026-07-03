// REST client for the Fastify backend (http://localhost:3000 by default).
// All calls use credentials:"include" so the HttpOnly refresh cookie flows.

import type { ClassId } from "@depthbreaker/protocol";
import { BACKEND_URL } from "../config";

export interface GuestLoginResult {
  accountId: string;
  accessToken: string;
  expiresIn: number;
}

export interface CharacterSummary {
  id: string;
  name: string;
  class_id: string;
}

export interface StartRunResult {
  runId: string;
  seed: number;
  wsUrl: string;
  joinTicket: string;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* ignore body parse errors */
    }
    throw new Error(`${res.status} ${res.statusText} ${detail}`.trim());
  }
  return (await res.json()) as T;
}

/** POST /api/auth/guest -> { accountId, accessToken, expiresIn } (+ refresh cookie). */
export async function guestLogin(): Promise<GuestLoginResult> {
  const res = await fetch(`${BACKEND_URL}/api/auth/guest`, {
    method: "POST",
    credentials: "include",
    // Send an empty JSON object: Fastify rejects an empty body when the
    // content-type is application/json.
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return parseJson<GuestLoginResult>(res);
}

/** POST /api/characters -> { character }. */
export async function createCharacter(
  token: string,
  name: string,
  classId: ClassId,
): Promise<CharacterSummary> {
  const res = await fetch(`${BACKEND_URL}/api/characters`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, classId }),
  });
  const body = await parseJson<{ character: CharacterSummary }>(res);
  return body.character;
}

/** GET /api/characters -> { characters }. */
export async function listCharacters(
  token: string,
): Promise<CharacterSummary[]> {
  const res = await fetch(`${BACKEND_URL}/api/characters`, {
    method: "GET",
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson<{ characters: CharacterSummary[] }>(res);
  return body.characters;
}

/** POST /api/runs/start -> { runId, seed, wsUrl, joinTicket }. */
export async function startRun(
  token: string,
  characterId: string,
): Promise<StartRunResult> {
  const res = await fetch(`${BACKEND_URL}/api/runs/start`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ characterId }),
  });
  return parseJson<StartRunResult>(res);
}
