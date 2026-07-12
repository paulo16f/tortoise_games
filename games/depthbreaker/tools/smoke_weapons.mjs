// Headless verification of the weapon system against the running realtime
// (:2667) + backend (:3100): buying a typed weapon, equipping it (archetype
// class-gating), and the equipped weapon's stats taking effect — a faster weapon
// shortens the synced swing interval; a wrong-class weapon is refused.
import { Client } from "colyseus.js";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3100";
const REALTIME_URL = process.env.REALTIME_URL ?? "ws://localhost:2667";
const ZONE_SECRET = process.env.ZONE_SHARED_SECRET ?? "dev-zone-shared-secret-change-me";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
function bagIndex(self, itemId) { let idx = -1; self.inventory.forEach((s, i) => { if (idx === -1 && s.itemId === itemId && s.count > 0) idx = i; }); return idx; }
async function walkToStall(room, self) {
  let seq = 3000; const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const dx = 4 - self.x, dz = 3 - self.z, d = Math.hypot(dx, dz);
    if (d <= 1.5) break;
    room.send("input", { seq: seq++, moveX: dx / d, moveZ: dz / d, yaw: Math.atan2(dx, dz) });
    await wait(50);
  }
  room.send("input", { seq: seq++, moveX: 0, moveZ: 0, yaw: 0 });
  await wait(150);
}

async function main() {
  console.log("--- Weapon system (types / stats / gating) ---");
  const guest = await api("/api/auth/guest", { method: "POST", body: {} });
  const token = guest.json.accessToken, accountId = guest.json.accountId;
  const made = await api("/api/characters", { method: "POST", token, body: { name: "Smith", classId: "knight" } });
  const run = await api("/api/runs/start", { method: "POST", token, body: { characterId: made.json.character.id } });
  const client = new Client(REALTIME_URL);
  const room = await client.joinOrCreate("zone", { ticket: run.json.joinTicket, name: "Smith", classId: "knight" });
  for (const t of ["welcome", "combatEvent", "lootEvent", "stash", "dailies", "skins", "spinner", "spinResult", "chat"]) room.onMessage(t, () => {});
  const self = await waitFor(() => room.state?.players?.get(room.sessionId), "self");
  await wait(400);

  // Bruiser starts with the iron_sword (speed 1.0) equipped -> swingInterval 1.0.
  check("starts with iron_sword equipped", self.weaponId === "iron_sword", `weaponId=${self.weaponId}`);
  const swordInterval = self.swingInterval;
  check("iron_sword swing interval ~1.0s", Math.abs(swordInterval - 1.0) < 0.05, `interval=${swordInterval.toFixed(3)}`);

  // Fund + buy a fast dagger (speed 1.4), then equip it.
  await api(`/internal/wallet/${accountId}/credit`, { method: "POST", secret: ZONE_SECRET, body: { amount: 100, reason: "test" } });
  await walkToStall(room, self);
  room.send("buyItem", { itemId: "iron_dagger" });
  await waitFor(() => bagIndex(self, "iron_dagger") >= 0, "dagger in bag", 8000);
  check("bought an iron_dagger", bagIndex(self, "iron_dagger") >= 0);

  room.send("equipWeapon", { itemId: "iron_dagger" });
  await waitFor(() => self.weaponId === "iron_dagger", "dagger equipped", 8000);
  check("equipped the dagger (bruiser can wield a dagger)", self.weaponId === "iron_dagger");
  await wait(300);
  check("faster weapon shortens the swing interval", self.swingInterval < swordInterval - 0.1, `interval ${swordInterval.toFixed(2)}->${self.swingInterval.toFixed(2)}`);
  check("dagger swing interval ~0.71s (1.0 / 1.4)", Math.abs(self.swingInterval - 1.0 / 1.4) < 0.05, `interval=${self.swingInterval.toFixed(3)}`);

  // Class gating: a bruiser cannot equip a staff — buy one, try, weapon unchanged.
  room.send("buyItem", { itemId: "ash_staff" });
  await waitFor(() => bagIndex(self, "ash_staff") >= 0, "staff in bag", 8000);
  const before = self.weaponId;
  room.send("equipWeapon", { itemId: "ash_staff" });
  await wait(500);
  check("bruiser cannot equip a staff (archetype gating)", self.weaponId === before, `weaponId=${self.weaponId}`);

  await room.leave();
  console.log(failures === 0 ? "\nRESULT: PASS ✅ weapon system green" : `\nRESULT: FAIL ❌ ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; });
