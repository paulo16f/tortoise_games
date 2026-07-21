import { Client } from "colyseus.js";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";
const REALTIME_URL = process.env.REALTIME_URL ?? "ws://localhost:2567";
const CLASS_ID = process.env.SMOKE_CLASS_ID ?? "mage";
const NAME = `Smoke${Date.now().toString().slice(-6)}`;

async function jsonFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} -> ${res.status}: ${text}`);
  return { body, headers: res.headers };
}

async function startTicketedRun(name, classId) {
  const login = await jsonFetch(`${BACKEND_URL}/api/auth/guest`, { method: "POST", body: "{}" });
  const token = login.body.accessToken;
  const character = await jsonFetch(`${BACKEND_URL}/api/characters`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, classId }),
  });
  const run = await jsonFetch(`${BACKEND_URL}/api/runs/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ characterId: character.body.character.id }),
  });
  return run.body;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await wait(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function entries(schemaMap) {
  const out = [];
  schemaMap?.forEach((value, key) => out.push([key, value]));
  return out;
}

async function main() {
  const health = await jsonFetch(`${BACKEND_URL}/api/health`);
  console.log(`backend health: ${health.body.status} (${health.body.launchPhase ?? "unknown phase"})`);

  const run = await startTicketedRun(NAME, CLASS_ID);
  console.log(`run started: ${run.runId} seed=${run.seed}`);

  const client = new Client(run.wsUrl || REALTIME_URL);
  const room = await client.joinOrCreate("zone", {
    ticket: run.joinTicket,
    name: NAME,
    classId: CLASS_ID,
  });
  console.log(`joined realtime: room=${room.roomId} session=${room.sessionId}`);

  let lootSeen = false;
  room.onMessage("lootEvent", (msg) => {
    if (msg.playerId === room.sessionId) lootSeen = true;
  });

  await waitFor(() => room.state?.players?.get(room.sessionId), "self player");
  const enemy = await waitFor(
    () => entries(room.state.enemies).find(([, e]) => e.alive)?.[1],
    "live enemy",
  );
  room.send("setTarget", { targetId: enemy.id, autoAttack: true });

  const startXp = room.state.players.get(room.sessionId).runXp;
  const result = await waitFor(() => {
    const self = room.state.players.get(room.sessionId);
    const deadEnemy = entries(room.state.enemies).some(([, e]) => !e.alive);
    if (self && (self.runXp > startXp || lootSeen || deadEnemy)) {
      return { xp: self.runXp, lootSeen, deadEnemy };
    }
    return null;
  }, "combat XP/loot/death", 30000);

  await room.leave();
  console.log(`combat smoke ok: xp=${result.xp} loot=${result.lootSeen} deadEnemy=${result.deadEnemy}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

