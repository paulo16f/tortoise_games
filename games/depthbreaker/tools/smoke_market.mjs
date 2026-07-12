// Headless verification of the mining + market loop against the running
// backend (:3100) + realtime (:2667) servers, with a real ticketed join so the
// persistent wallet is exercised end-to-end:
//   guest → character → run → join → walk to a node → gather (ore lands, node
//   depletes) → walk to the stall → sell ore (gold + wallet rise) → buy bread
//   (gold falls, item lands) → overpriced buy rejected → out-of-range rejected.
import { Client } from "colyseus.js";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3100";
const REALTIME_URL = process.env.REALTIME_URL ?? "ws://localhost:2667";
const ZONE_SECRET = process.env.ZONE_SHARED_SECRET ?? "dev-zone-shared-secret-change-me";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function entries(m) { const o = []; m?.forEach((v, k) => o.push([k, v])); return o; }
async function waitFor(fn, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const v = fn(); if (v) return v; await wait(80); }
  throw new Error(`timed out waiting for ${label}`);
}

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

async function api(path, { method = "GET", token, body, secret } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const res = await fetch(`${BACKEND_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

function bagCount(self, itemId) {
  let n = 0;
  self.inventory.forEach((s) => { if (s.itemId === itemId) n += s.count; });
  return n;
}

async function walkTo(room, self, x, z, stopAt = 1.2, timeoutMs = 45000) {
  let seq = 1000;
  const deadline = Date.now() + timeoutMs;
  // Naive straight-line walk with a wall-slide "unstick": the server rejects
  // moves into walls (isDungeonWalkable), so a corridor corner would stall a
  // pure beeline. When progress stalls, steer perpendicular for a few steps to
  // slide along the obstacle (classic bug-navigation), alternating sides.
  let lastD = Infinity;
  let stalled = 0;
  let slideDir = 1;
  let slideSteps = 0;
  while (Date.now() < deadline) {
    const dx = x - self.x;
    const dz = z - self.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopAt) break;

    if (d > lastD - 0.03) stalled++;
    else stalled = 0;
    lastD = d;

    let mx = dx / d;
    let mz = dz / d;
    if (slideSteps > 0) {
      // Perpendicular to the goal direction (rotate 90°), blended toward goal.
      const px = -mz * slideDir;
      const pz = mx * slideDir;
      mx = px * 0.85 + mx * 0.15;
      mz = pz * 0.85 + mz * 0.15;
      const l = Math.hypot(mx, mz) || 1;
      mx /= l;
      mz /= l;
      slideSteps--;
    } else if (stalled >= 6) {
      slideSteps = 8; // begin a slide burst
      slideDir *= -1; // alternate the side we try each time we re-stall
      stalled = 0;
    }
    room.send("input", { seq: seq++, moveX: mx, moveZ: mz, yaw: Math.atan2(dx, dz) });
    await wait(50);
  }
  room.send("input", { seq: seq++, moveX: 0, moveZ: 0, yaw: 0 });
  await wait(150);
  return Math.hypot(x - self.x, z - self.z);
}

async function main() {
  console.log("--- Mining + market loop (ticketed) ---");
  // Full backend chain for a real accountId-bearing ticket.
  const guest = await api("/api/auth/guest", { method: "POST", body: {} });
  const token = guest.json.accessToken;
  const accountId = guest.json.accountId;
  const made = await api("/api/characters", { method: "POST", token, body: { name: "MarketMiner", classId: "knight" } });
  const run = await api("/api/runs/start", { method: "POST", token, body: { characterId: made.json.character.id } });
  check("backend chain (guest→char→run)", run.status === 201 && !!run.json.joinTicket);

  const client = new Client(REALTIME_URL);
  const room = await client.joinOrCreate("zone", { ticket: run.json.joinTicket, name: "MarketMiner", classId: "knight" });
  for (const t of ["welcome", "combatEvent", "stash", "dailies", "skins", "spinner", "spinResult", "chat"]) room.onMessage(t, () => {});
  const lootSeen = [];
  room.onMessage("lootEvent", (m) => { if (m.playerId === room.sessionId) lootSeen.push(m.itemId); });
  const self = await waitFor(() => room.state?.players?.get(room.sessionId), "self");

  // Nodes synced from the seeded map.
  await waitFor(() => room.state.nodes && room.state.nodes.size > 0, "resource nodes");
  const nodes = entries(room.state.nodes).map(([, n]) => n);
  check("nodes synced from the map", nodes.length > 0, `count=${nodes.length}`);
  check("wallet starts at 0 (fresh account)", self.gold === 0, `gold=${self.gold}`);

  // Out-of-range guards (player spawns in the market room, nodes are elsewhere).
  // Pick the node farthest from living enemies — nodes sit in combat rooms, and
  // getting hit correctly interrupts the gather cast, so a real player clears
  // the room first (the test does the same below).
  const enemyDistTo = (x, z) => {
    const alive = entries(room.state.enemies).map(([, e]) => e).filter((e) => e.alive);
    if (alive.length === 0) return Infinity;
    return Math.min(...alive.map((e) => Math.hypot(e.x - x, e.z - z)));
  };
  const nearest = nodes.reduce((a, b) => (enemyDistTo(a.x, a.z) > enemyDistTo(b.x, b.z) ? a : b));
  room.send("gatherNode", { nodeId: nearest.id });
  await wait(300);
  check("gather rejected when out of range", bagCount(self, "iron_ore") + bagCount(self, "crystal_shard") === 0);

  // Walk to the chosen node.
  const reached = await walkTo(room, self, nearest.x, nearest.z, 2.0);
  check("walked to a node", reached <= 2.6, `d=${reached.toFixed(2)}`);

  // Fight off anything that aggroed on the way — a hit interrupts gathering.
  for (let kills = 0; kills < 6; kills++) {
    const foes = entries(room.state.enemies)
      .map(([, e]) => e)
      .filter((e) => e.alive && Math.hypot(e.x - self.x, e.z - self.z) < 14)
      .sort((a, b) => Math.hypot(a.x - self.x, a.z - self.z) - Math.hypot(b.x - self.x, b.z - self.z));
    if (foes.length === 0) break;
    const foe = foes[0];
    room.send("setTarget", { targetId: foe.id, autoAttack: true });
    const dead = await waitFor(() => !room.state.enemies.get(foe.id)?.alive, `kill ${foe.id}`, 45000)
      .then(() => true)
      .catch(() => false);
    if (!dead) break;
    room.send("setTarget", { targetId: "", autoAttack: false });
    // Auto-follow may have dragged us off the node; walk back.
    await walkTo(room, self, nearest.x, nearest.z, 2.0);
    await wait(300);
  }

  // Gather (retry a few times in case a late wave interrupts the cast).
  let oreAfter = 0;
  for (let attempt = 0; attempt < 4 && oreAfter === 0; attempt++) {
    await walkTo(room, self, nearest.x, nearest.z, 2.0);
    room.send("gatherNode", { nodeId: nearest.id });
    await wait(2300); // 1.4s cast + margin
    oreAfter = bagCount(self, "iron_ore") + bagCount(self, "crystal_shard");
  }
  check("gather yielded resources into the bag", oreAfter > 0, `resources=${oreAfter}`);
  check("loot toast fired for the yield", lootSeen.some((i) => i === "iron_ore" || i === "crystal_shard"));
  check("node depleted after gather", room.state.nodes.get(nearest.id)?.depleted === true);

  // Out-of-range market guard while standing at the node.
  const goldBeforeFarSell = self.gold;
  const sellIndexFar = (() => { let idx = -1; self.inventory.forEach((s, i) => { if (idx === -1 && (s.itemId === "iron_ore" || s.itemId === "crystal_shard")) idx = i; }); return idx; })();
  room.send("sellItem", { index: sellIndexFar });
  await wait(400);
  check("sell rejected away from the stall", self.gold === goldBeforeFarSell && bagCount(self, "iron_ore") + bagCount(self, "crystal_shard") === oreAfter);

  // Walk to the market stall and sell everything gathered.
  const stallGuess = { x: 4, z: 3 }; // marketStall = start room center + (4,3); spawn ring ≈ center
  const spawnRef = { x: 0, z: 0 };
  // Derive the stall from the map definition the server used: playerSpawn is the
  // room center; the run seed is in the welcome/state. Walk relative to origin.
  await walkTo(room, self, spawnRef.x + stallGuess.x, spawnRef.z + stallGuess.z, 1.5);
  const goldBefore = self.gold;
  let sold = 0;
  for (let guard = 0; guard < 40; guard++) {
    let idx = -1;
    self.inventory.forEach((s, i) => { if (idx === -1 && (s.itemId === "iron_ore" || s.itemId === "crystal_shard")) idx = i; });
    if (idx === -1) break;
    room.send("sellItem", { index: idx });
    await wait(350);
    sold++;
  }
  check("sold all gathered resources", bagCount(self, "iron_ore") + bagCount(self, "crystal_shard") === 0, `sold=${sold}`);
  check("gold increased from selling", self.gold > goldBefore, `gold=${self.gold}`);

  // Persistent wallet agrees with the synced gold.
  const wallet = await api(`/internal/wallet/${accountId}`, { secret: ZONE_SECRET });
  check("backend wallet matches synced gold", wallet.json?.balance === self.gold, `${wallet.json?.balance} vs ${self.gold}`);

  // Buy bread (10g) if affordable; assert gold falls and the item lands.
  if (self.gold >= 10) {
    const before = { gold: self.gold, bread: bagCount(self, "bread") };
    room.send("buyItem", { itemId: "bread" });
    await wait(600);
    check("buy bread: gold down, item landed", self.gold === before.gold - 10 && bagCount(self, "bread") === before.bread + 1, `gold=${self.gold}`);
  } else {
    check("buy bread skipped (not enough gold — unexpected for this loop)", false, `gold=${self.gold}`);
  }

  // Unaffordable buy is rejected with no gold movement.
  const beforeRich = self.gold;
  room.send("buyItem", { itemId: "war_hammer" }); // 160g
  await wait(600);
  check("unaffordable buy rejected (gold unchanged)", self.gold === beforeRich && bagCount(self, "war_hammer") === 0, `gold=${self.gold}`);

  // Off-stock item rejected even with gold.
  room.send("buyItem", { itemId: "starcaller" });
  await wait(400);
  check("off-stock item rejected", bagCount(self, "starcaller") === 0);

  // Node respawn (35s) — poll a little beyond it.
  const respawned = await waitFor(() => room.state.nodes.get(nearest.id)?.depleted === false, "node respawn", 45000).then(() => true).catch(() => false);
  check("node respawned after ~35s", respawned);

  await room.leave();
  console.log(failures === 0 ? "\nRESULT: PASS ✅ mining + market loop green" : `\nRESULT: FAIL ❌ ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; });
