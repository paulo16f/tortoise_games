# Depthbreaker backend (Fastify + Postgres). Build context = repo root, because
# backend/src/config.ts imports ../../../../shared/lib/config.js (git-root shared/).
# On Railway: service Root Directory = "/" (repo root), Dockerfile Path =
# games/depthbreaker/backend/Dockerfile.
FROM node:22-alpine

WORKDIR /repo
COPY shared ./shared
COPY games/depthbreaker ./games/depthbreaker

WORKDIR /repo/games/depthbreaker
# Servers run via tsx (no build step), so dev deps are needed at runtime.
RUN npm ci --include=dev

ENV NODE_ENV=production
# Migrations apply on boot (server.ts main()). Binds 0.0.0.0:$PORT.
CMD ["npm", "run", "start", "--workspace", "backend"]
