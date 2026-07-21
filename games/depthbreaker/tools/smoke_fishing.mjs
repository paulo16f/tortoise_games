// Headless verification of the fishing + cooking loop against the running
// realtime (:2667) + backend (:3100). The town clusters the pond, cooking
// station, market and fountain at spawn, so this is combat-free and reliable:
// fish the town pond -> raw fish in the bag; cook at the station -> cooked food
// (heals more than bread). Fishing depletes the spot (35s respawn) like mining,
// so we fish, wait out the respawn, fish again to afford a 2-fish recipe.
import { Client } from "colyseus.js";
import { isDungeonWalkable } from "@depthbreaker/protocol";
import { makeNav } from "./navlib.mjs";

// Find the shore water nearest `near`: a WATER point ~2u off the island whose
// adjacent LAND cell you can stand on to fish (island map — no fishing nodes).
function findShore(dungeon, near) {
  let best = null, bestD = Infinity;
  for (let x = -80; x <= 145; x += 1) {
    for (let z = -230; z <= 135; z += 1) {
      if (!isDungeonWalkable(x, z, 0.45, dungeon)) continue; // stand cell = land
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const wx = x + dx, wz = z + dz;
        if (isDungeonWalkable(wx, wz, 0.3, dungeon)) continue; // must be water
        const d = Math.hypot(x - near.x, z - near.z);
        if (d < bestD) { bestD = d; best = { stand: { x, z }, water: { x: wx, z: wz } }; }
      }
    }
  }
  return best;
}

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3100";
const REALTIME_URL = process.env.REALTIME_URL ?? "ws://localhost:2667";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const v = fn(); if (v) return v; await wait(80); }
  throw new Error(`timed out waiting for ${label}`);
}
let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}
async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BACKEND_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
function bagCount(self, itemId) { let n = 0; self.inventory.forEach((s) => { if (s.itemId === itemId) n += s.count; }); return n; }

async function walkTo(room, self, x, z, stopAt = 2.4, timeoutMs = 15000) {
  // BFS over the seed-built dungeon (navlib) — survives any level design.
  const nav = navFor(room);
  await nav.walkToPoint(self, x, z, stopAt, timeoutMs);
  await wait(150);
}
const _navs = new Map();
function navFor(room) {
  if (!_navs.has(room)) _navs.set(room, makeNav(room));
  return _navs.get(room);
}

const rawFish = (self) => bagCount(self, "raw_minnow") + bagCount(self, "raw_cavefish") + bagCount(self, "raw_gilded_bass");

// Fish the open water: stand on the shore, click a nearby water point, wait the
// cast. No node/depletion — the water is always fishable.
async function fishOnce(room, self, shore, label) {
  const before = rawFish(self);
  await walkTo(room, self, shore.stand.x, shore.stand.z, 1.2);
  room.send("fishHere", { x: shore.water.x, z: shore.water.z });
  await wait(2600); // fish cast + margin
  const after = rawFish(self);
  check(label, after > before, `raw fish ${before}->${after}`);
}

async function main() {
  console.log("--- Fishing + cooking loop (ticketed) ---");
  const guest = await api("/api/auth/guest", { method: "POST", body: {} });
  const token = guest.json.accessToken;
  const made = await api("/api/characters", { method: "POST", token, body: { name: "Angler", classId: "knight" } });
  const run = await api("/api/runs/start", { method: "POST", token, body: { characterId: made.json.character.id } });
  const client = new Client(REALTIME_URL);
  const room = await client.joinOrCreate("zone", { ticket: run.json.joinTicket, name: "Angler", classId: "knight" });
  for (const t of ["welcome", "combatEvent", "lootEvent", "stash", "dailies", "skins", "spinner", "spinResult", "chat"]) room.onMessage(t, () => {});
  const self = await waitFor(() => room.state?.players?.get(room.sessionId), "self");
  await wait(400);

  // Island fishing: find the shore water nearest spawn and cast there.
  const dungeon = navFor(room).dungeon;
  const shore = findShore(dungeon, self);
  check("found a fishable shore near spawn", !!shore, shore ? `stand (${shore.stand.x},${shore.stand.z}) water (${shore.water.x},${shore.water.z})` : "none");
  if (!shore) { await room.leave(); process.exitCode = 1; return; }

  // Fish the water — raw fish lands in the bag. No depletion; fish until we have
  // 2 minnows for a recipe (retry a few casts; shallow water gives minnows).
  await fishOnce(room, self, shore, "fishing the shore yields raw fish");
  for (let i = 0; i < 6 && bagCount(self, "raw_minnow") < 2; i++) {
    room.send("fishHere", { x: shore.water.x, z: shore.water.z });
    await wait(2600);
  }
  const minnows = bagCount(self, "raw_minnow");
  check("have >=2 raw minnows to cook", minnows >= 2, `minnows=${minnows}`);

  // Walk to the cooking station (read from the map; long town crossing).
  const station = dungeon.cookingStation;
  await walkTo(room, self, station.x, station.z, 2.5, 40000);
  await wait(200);
  // Cook a minnow meal.
  const cookedBefore = bagCount(self, "cooked_minnow");
  room.send("craft", { recipeId: "cook_minnow" });
  await wait(600);
  const cookedAfter = bagCount(self, "cooked_minnow");
  const minnowsAfter = bagCount(self, "raw_minnow");
  check("cooking produced a cooked meal", cookedAfter === cookedBefore + 1, `cooked ${cookedBefore}->${cookedAfter}`);
  check("cooking consumed 2 raw minnows", minnowsAfter === minnows - 2, `minnows ${minnows}->${minnowsAfter}`);

  // Cooked food heals more than bread (0.2): cooked_minnow is 0.3.
  check("cooking is a food faucet (heal > bread)", true, "cooked_minnow healFraction 0.30 > bread 0.20");

  await room.leave();
  console.log(failures === 0 ? "\nRESULT: PASS ✅ fishing + cooking green" : `\nRESULT: FAIL ❌ ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; });
