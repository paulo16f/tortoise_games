// Client auth session: holds the current account + in-memory access token, and
// orchestrates refresh. The access token is deliberately memory-only (never in
// localStorage); the HttpOnly db_refresh cookie is what survives reload, so
// bootstrap() re-mints an access token from it on load. Same external-store
// pattern as the UI panels so React and non-React code share one source.

import { useSyncExternalStore } from "react";
import { type AuthResult, ApiError, refresh as apiRefresh } from "./backend";

export type AccountKind = "guest" | "email";

export interface Session {
  accountId: string;
  accessToken: string;
  kind: AccountKind;
}

// Hint (not a credential) so a returning user boots straight into refresh
// rather than flashing the login screen; the real gate is the cookie.
const HINT_KEY = "db_hasSession";

let session: Session | null = null;
const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}

export function setSession(result: AuthResult, kind: AccountKind): void {
  session = { accountId: result.accountId, accessToken: result.accessToken, kind };
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
  emit();
}

export function clearSession(): void {
  session = null;
  try {
    localStorage.removeItem(HINT_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function getSession(): Session | null {
  return session;
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => session,
  );
}

/**
 * Restore a session on app load from the refresh cookie. Returns true if a
 * valid session was hydrated. Refresh doesn't tell us guest vs email, so we
 * keep whatever kind we had, defaulting to "guest".
 */
export async function bootstrap(): Promise<boolean> {
  try {
    const result = await apiRefresh();
    setSession(result, session?.kind ?? "guest");
    return true;
  } catch {
    clearSession();
    return false;
  }
}

/**
 * Run an authed backend call with the current token, transparently refreshing
 * once on a 401 (access tokens expire after 15 min). Throws if there is no
 * session or the refresh also fails.
 */
export async function withAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
  if (!session) throw new Error("not_authenticated");
  try {
    return await fn(session.accessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const result = await apiRefresh(); // may throw → caller handles re-login
      setSession(result, session.kind);
      return fn(result.accessToken);
    }
    throw err;
  }
}
