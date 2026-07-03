// Request guards. Identity ALWAYS derives from verified credentials
// (JWT / shared secret), never from request bodies (AGENTS.md guardrail 6).

import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AppConfig } from "../config.js";
import { verifyAccessToken } from "../auth/jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    accountId?: string;
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

/** Populates request.accountId from a valid access token, else 401. */
export function makeRequireAuth(config: AppConfig): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    const accountId = token ? await verifyAccessToken(token, config.sessionSecret) : null;
    if (!accountId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    request.accountId = accountId;
  };
}

/** Like makeRequireAuth but leaves request.accountId unset instead of 401ing. */
export function makeOptionalAuth(config: AppConfig): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    const token = bearerToken(request);
    if (!token) return;
    const accountId = await verifyAccessToken(token, config.sessionSecret);
    if (accountId) request.accountId = accountId;
  };
}

/** Zone-server-only endpoints: constant-time shared-secret comparison. */
export function makeRequireZoneSecret(config: AppConfig): preHandlerHookHandler {
  const expected = Buffer.from(config.zoneSharedSecret);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    const actual = token ? Buffer.from(token) : Buffer.alloc(0);
    const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!ok) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
}
