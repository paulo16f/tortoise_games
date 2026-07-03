import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppContext } from "../server.js";
import { withTransaction, type DbClient } from "../db/pool.js";
import { signAccessToken } from "../auth/jwt.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import {
  issueRefreshToken,
  revokeByToken,
  rotateRefreshToken,
} from "../auth/refresh.js";
import { makeOptionalAuth } from "../plugins/guards.js";

const credentialsSchema = {
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email", maxLength: 254 },
      password: { type: "string", minLength: 8, maxLength: 128 },
    },
  },
} as const;

interface Credentials {
  email: string;
  password: string;
}

interface SessionPayload {
  accountId: string;
  accessToken: string;
  expiresIn: number;
}

type RegisterOutcome =
  | { ok: false; code: number; message: string }
  | { ok: true; session: SessionPayload };

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, pool } = ctx;

  function refreshTtl(kind: string): number {
    return kind === "guest" ? config.refreshTtlGuestSeconds : config.refreshTtlEmailSeconds;
  }

  function setRefreshCookie(reply: FastifyReply, token: string, ttlSeconds: number): void {
    reply.setCookie(config.refreshCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      path: "/api/auth",
      maxAge: ttlSeconds,
    });
  }

  function clearRefreshCookie(reply: FastifyReply): void {
    reply.clearCookie(config.refreshCookieName, { path: "/api/auth" });
  }

  async function issueSession(
    client: DbClient,
    reply: FastifyReply,
    accountId: string,
    kind: string,
  ): Promise<{ accountId: string; accessToken: string; expiresIn: number }> {
    const ttl = refreshTtl(kind);
    const refresh = await issueRefreshToken(client, accountId, ttl);
    setRefreshCookie(reply, refresh.token, ttl);
    const accessToken = await signAccessToken(
      accountId,
      config.sessionSecret,
      config.accessTokenTtlSeconds,
    );
    return { accountId, accessToken, expiresIn: config.accessTokenTtlSeconds };
  }

  app.post("/api/auth/guest", async (_request, reply) => {
    const session = await withTransaction(pool, async (client) => {
      const res = await client.query<{ id: string }>(
        "INSERT INTO accounts (kind, last_login_at) VALUES ('guest', now()) RETURNING id",
      );
      const accountId = res.rows[0]!.id;
      await client.query("INSERT INTO meta_wallets (account_id) VALUES ($1)", [accountId]);
      return issueSession(client, reply, accountId, "guest");
    });
    return reply.code(201).send(session);
  });

  app.post(
    "/api/auth/register",
    { schema: credentialsSchema, preHandler: makeOptionalAuth(config) },
    async (request, reply) => {
      const { email, password } = request.body as Credentials;
      const passwordHash = await hashPassword(password);

      const result = await withTransaction<RegisterOutcome>(pool, async (client) => {
        const taken = await client.query("SELECT 1 FROM accounts WHERE lower(email) = lower($1)", [
          email,
        ]);
        if (taken.rowCount) return { ok: false, code: 409, message: "email_taken" };

        if (request.accountId) {
          // Upgrade the authenticated guest account in place (keeps progress).
          const upgraded = await client.query(
            `UPDATE accounts SET kind = 'email', email = $2, password_hash = $3
             WHERE id = $1 AND kind = 'guest' RETURNING id`,
            [request.accountId, email, passwordHash],
          );
          if (!upgraded.rowCount) return { ok: false, code: 409, message: "not_upgradable" };
          return { ok: true, session: await issueSession(client, reply, request.accountId, "email") };
        }

        const created = await client.query<{ id: string }>(
          `INSERT INTO accounts (kind, email, password_hash, last_login_at)
           VALUES ('email', $1, $2, now()) RETURNING id`,
          [email, passwordHash],
        );
        const accountId = created.rows[0]!.id;
        await client.query("INSERT INTO meta_wallets (account_id) VALUES ($1)", [accountId]);
        return { ok: true, session: await issueSession(client, reply, accountId, "email") };
      });

      if (!result.ok) return reply.code(result.code).send({ error: result.message });
      return reply.code(201).send(result.session);
    },
  );

  app.post("/api/auth/login", { schema: credentialsSchema }, async (request, reply) => {
    const { email, password } = request.body as Credentials;
    const res = await pool.query<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM accounts WHERE lower(email) = lower($1) AND kind = 'email'",
      [email],
    );
    const account = res.rows[0];
    const valid = account ? await verifyPassword(password, account.password_hash) : false;
    if (!account || !valid) return reply.code(401).send({ error: "invalid_credentials" });

    const session = await withTransaction(pool, async (client) => {
      await client.query("UPDATE accounts SET last_login_at = now() WHERE id = $1", [account.id]);
      return issueSession(client, reply, account.id, "email");
    });
    return reply.send(session);
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    const rawToken = request.cookies[config.refreshCookieName];
    if (!rawToken) return reply.code(401).send({ error: "no_refresh_token" });

    const rotated = await withTransaction(pool, async (client) => {
      const result = await rotateRefreshToken(client, rawToken, config.refreshTtlGuestSeconds);
      if (!result) return null;
      const kindRes = await client.query<{ kind: string }>(
        "SELECT kind FROM accounts WHERE id = $1",
        [result.accountId],
      );
      return { ...result, kind: kindRes.rows[0]?.kind ?? "guest" };
    });

    if (!rotated) {
      clearRefreshCookie(reply);
      return reply.code(401).send({ error: "invalid_refresh_token" });
    }

    setRefreshCookie(reply, rotated.next.token, refreshTtl(rotated.kind));
    const accessToken = await signAccessToken(
      rotated.accountId,
      config.sessionSecret,
      config.accessTokenTtlSeconds,
    );
    return reply.send({
      accountId: rotated.accountId,
      accessToken,
      expiresIn: config.accessTokenTtlSeconds,
    });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const rawToken = request.cookies[config.refreshCookieName];
    if (rawToken) {
      await withTransaction(pool, (client) => revokeByToken(client, rawToken));
    }
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });
}
