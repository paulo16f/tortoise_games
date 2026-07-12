import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type pg from "pg";
import { loadConfig, type AppConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCharacterRoutes } from "./routes/characters.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerMetaRoutes } from "./routes/meta.js";
import { registerMarketRoutes } from "./routes/market.js";
import { registerGoldMarketRoutes } from "./routes/goldMarket.js";
import { registerSiwsRoutes } from "./routes/siws.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerHealthRoutes } from "./routes/health.js";

export interface AppContext {
  config: AppConfig;
  pool: pg.Pool;
}

export interface BuildServerOptions {
  config?: AppConfig;
  pool?: pg.Pool;
  logger?: boolean;
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance & {
  ctx: AppContext;
} {
  const config = options.config ?? loadConfig();
  const pool = options.pool ?? createPool(config.databaseUrl);
  const ctx: AppContext = { config, pool };

  const app = Fastify({ logger: options.logger ?? false });
  app.register(cookie);

  // Minimal CORS for the WebGL client (credentialed: refresh cookie).
  app.addHook("onRequest", async (request, reply) => {
    reply.header("access-control-allow-origin", config.corsOrigin);
    reply.header("access-control-allow-credentials", "true");
    reply.header("vary", "origin");
    if (request.method === "OPTIONS") {
      reply.header("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
      reply.header("access-control-allow-headers", "authorization,content-type");
      return reply.code(204).send();
    }
  });

  registerAuthRoutes(app, ctx);
  registerCharacterRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerMetaRoutes(app, ctx);
  registerMarketRoutes(app, ctx);
  registerGoldMarketRoutes(app, ctx);
  registerSiwsRoutes(app, ctx);
  registerInternalRoutes(app, ctx);
  registerHealthRoutes(app, ctx);

  return Object.assign(app, { ctx });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const applied = await runMigrations(pool);
  if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);

  const app = buildServer({ config, pool, logger: true });
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
