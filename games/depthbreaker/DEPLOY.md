# Depthbreaker — Deploy (Railway) & continuous delivery

Live stack = **4 Railway services** in one project, all connected to
`github.com/paulo16f/tortoise_games`, auto-deploying on push:

| Service   | What                         | Build                                   | Public? |
|-----------|------------------------------|-----------------------------------------|---------|
| Postgres  | managed DB                   | Railway plugin                          | no      |
| backend   | Fastify REST + auth (`pg`)   | `games/depthbreaker/backend/Dockerfile` | yes     |
| realtime  | Colyseus WebSocket           | `games/depthbreaker/realtime/Dockerfile`| yes     |
| client    | Vite static SPA              | `games/depthbreaker/client/Dockerfile`  | yes     |

Servers run TypeScript directly via `tsx` (no build step). The **backend build
context is the repo root** because it imports `shared/lib/config.ts`; every
service therefore uses **Root Directory = `/`** + a per-service Dockerfile path.

## One-time setup

### 0. Secrets
```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # ZONE_SHARED_SECRET
```

### 1. Project + Postgres
New Railway project → **Deploy from GitHub repo** `tortoise_games` → add a
**Postgres** database to the project.

### 2. backend service
- Source: the repo. **Settings → Root Directory = `/`**, **Dockerfile Path =
  `games/depthbreaker/backend/Dockerfile`**.
- Variables:
  - `NODE_ENV=production`
  - `DATABASE_URL=${{ Postgres.DATABASE_URL }}`
  - `SESSION_SECRET=<secret 1>`
  - `ZONE_SHARED_SECRET=<secret 2>`
  - `CORS_ORIGIN=` *(fill after step 4)*
  - `ZONE_WS_URL=` *(fill after step 3)*
- **Settings → Networking → Generate Domain.** Health check path: `/api/health`.

### 3. realtime service
- **+ New → GitHub repo** (same repo). Root Directory = `/`, Dockerfile Path =
  `games/depthbreaker/realtime/Dockerfile`.
- Variables:
  - `NODE_ENV=production`
  - `ZONE_SHARED_SECRET=<secret 2>` *(same as backend)*
  - `BACKEND_URL=https://<backend-domain>`
  - `REQUIRE_TICKET=false`  *(soft launch — client is ticketless today; see Follow-ups)*
- Generate Domain → note the `wss://<realtime-domain>` (same host, wss scheme).
- Back on **backend**, set `ZONE_WS_URL=wss://<realtime-domain>` and redeploy.

### 4. client service
- **+ New → GitHub repo**. Root Directory = `/`, Dockerfile Path =
  `games/depthbreaker/client/Dockerfile`.
- Variables (baked at **build** time via Dockerfile ARGs):
  - `VITE_BACKEND_URL=https://<backend-domain>`
  - `VITE_REALTIME_URL=wss://<realtime-domain>`
- Generate Domain → this is the game URL.
- Back on **backend**, set `CORS_ORIGIN=https://<client-domain>` and redeploy.

## Continuous delivery
Each service auto-deploys on push to the connected branch (start with
`feat/depthbreaker-web-stack`, move to `main` once stable). Normal loop:
```
git add -A && git commit -m "..." && git push
```
Client endpoints are baked at build → changing a domain/URL requires a client
**redeploy**, not just a restart.

## Verify (smoke test)
1. `https://<backend-domain>/api/health` → ready (secrets non-default, DB reachable).
2. Open the client URL in **two browsers** → pick name/class → Play → both see
   each other move (WASD/click) and fight. That exercises backend (session),
   realtime (WS sync), and Postgres.

## Local prod-like check (before pushing)
```
docker compose -f infra/docker-compose.yml up postgres      # DB only
# backend
NODE_ENV=production DATABASE_URL=postgres://depthbreaker:depthbreaker@localhost:5432/depthbreaker \
  SESSION_SECRET=x ZONE_SHARED_SECRET=y CORS_ORIGIN=http://localhost:4173 npm run start --workspace backend
# realtime
NODE_ENV=production ZONE_SHARED_SECRET=y REQUIRE_TICKET=false npm run start --workspace realtime
# client
VITE_BACKEND_URL=http://localhost:3000 VITE_REALTIME_URL=ws://localhost:2567 npm run build --workspace client
npx serve -s client/dist -l 4173
```

## Follow-ups (post-launch hardening)
- **Auth/tickets:** wire `App.tsx` to the real flow (`loginGuest` → `startRun`
  → `connectToZone({ url: wsUrl, ticket })` from `net/backend.ts`), then flip
  `REQUIRE_TICKET=true` on realtime.
- **Animation:** arm poses are imperfect (rig rest-mismatch); iterate the
  Blender bake on a branch (`tools/convert_synty_depthbreaker.py`,
  `tools/render_clip_qa.py`) without blocking deploys.
- Private networking for `BACKEND_URL` (use `*.railway.internal`) to avoid a
  public round-trip.
