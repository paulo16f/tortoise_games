# Depthbreaker client (Vite/React static SPA). Build context = repo root.
# VITE_* endpoints are baked into the bundle at BUILD time, so they must be set
# as service variables (Railway exposes them as build ARGs).
# On Railway: service Root Directory = "/", Dockerfile Path =
# games/depthbreaker/client/Dockerfile.
FROM node:22-alpine AS build

WORKDIR /repo
COPY games/depthbreaker ./games/depthbreaker
WORKDIR /repo/games/depthbreaker
RUN npm ci --include=dev

ARG VITE_BACKEND_URL
ARG VITE_REALTIME_URL
ARG VITE_ALLOW_TICKETLESS_DEV
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_REALTIME_URL=$VITE_REALTIME_URL
ENV VITE_ALLOW_TICKETLESS_DEV=$VITE_ALLOW_TICKETLESS_DEV
RUN npm run build --workspace client

# --- serve the static build ---
FROM node:22-alpine
RUN npm i -g serve@14
WORKDIR /app
COPY --from=build /repo/games/depthbreaker/client/dist ./dist
ENV NODE_ENV=production
# SPA fallback; binds $PORT (Railway) or 3000 locally.
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
