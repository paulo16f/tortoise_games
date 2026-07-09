# Depthbreaker realtime (Colyseus WebSocket). Build context = repo root for a
# uniform Railway setup (self-contained within the workspace; no shared/ needed).
# On Railway: service Root Directory = "/", Dockerfile Path =
# games/depthbreaker/realtime/Dockerfile.
FROM node:22-alpine

WORKDIR /repo
COPY games/depthbreaker ./games/depthbreaker

WORKDIR /repo/games/depthbreaker
RUN npm ci --include=dev

ENV NODE_ENV=production
# Colyseus listens on 0.0.0.0:$PORT (config reads PORT).
CMD ["npm", "run", "start", "--workspace", "realtime"]
