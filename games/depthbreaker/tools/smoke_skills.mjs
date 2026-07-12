// Headless verification of the data-driven skill system against the running
// realtime server (ws://localhost:2667, requireTicket=false).
//
// Part A — ticketless bruiser (Lv1): hotbar layout, locked-slot rejection,
//   cleave commit (cooldown+GCD), potion no-waste guard, empty slot no-op,
//   slot-0 auto-attack toggle.
// Part B — self-signed dev ticket with txp=5000 (Lv5): persistent base level,
//   shield_wall unlocked + fires, whirlwind still locked, and the GCD blocking
//   a second on-GCD skill cast in the same instant.
import { Client } from "colyseus.js";
import { SignJWT } from "jose";

const REALTIME_URL = process.env.REALTIME_URL ?? "ws://localhost:2667";
const DEV_SECRET = "dev-zone-shared-secret-change-me";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const v = fn(); if (v) return v; await wait(80); }
  throw new Error(`timed out waiting for ${label}`);
}
function entries(m) { const o = []; m?.forEach((v, k) => o.push([k, v])); return o; }
function hotbar(self) {
  const out = [];
  self.hotbar.forEach((s) => out.push({ id: s.skillId, cd: +s.cooldownRemaining.toFixed(2), unlocked: s.unlocked }));
  return out;
}

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

async function joinRoom(opts) {
  const client = new Client(REALTIME_URL);
  const room = await client.joinOrCreate("zone", opts);
  for (const t of ["welcome", "combatEvent", "lootEvent", "stash", "dailies", "skins"]) room.onMessage(t, () => {});
  const self = await waitFor(() => room.state?.players?.get(room.sessionId), "self");
  return { room, self };
}

async function partA() {
  console.log("--- Part A: ticketless bruiser (Lv1) ---");
  const { room, self } = await joinRoom({ name: "SkillChkA", classId: "knight" });

  const bar = hotbar(self);
  console.log("  hotbar:", bar.map((s) => s.id || "·").join(" | "));
  const expected = ["basic_attack", "cleave", "shield_wall", "whirlwind", "charge", "execute", "bulwark", "", "", ""];
  check("layout is the 10-slot warrior kit (potion off the hotbar)", JSON.stringify(bar.map((s) => s.id)) === JSON.stringify(expected));
  check("Lv1 unlock flags (cleave yes, shield_wall no, bulwark no)",
    bar[1].unlocked === true && bar[2].unlocked === false && bar[6].unlocked === false);

  // Locked slot: shield_wall (Lv3) at Lv1 must be silently rejected.
  room.send("useSkill", { slot: 2 });
  await wait(250);
  check("locked shield_wall rejected: no cooldown", (self.hotbar[2]?.cooldownRemaining ?? -1) === 0);
  check("locked shield_wall rejected: no GCD spent", self.gcdRemaining === 0);

  // Empty slots (7, 8, 9 — potion is no longer here) are no-ops.
  room.send("useSkill", { slot: 9 });
  room.send("useSkill", { slot: 7 });
  await wait(150);
  check("empty slots no-op (no GCD)", self.gcdRemaining === 0);

  // Cleave (Lv1, on-GCD) commits: per-slot cooldown + GCD both charge.
  room.send("useSkill", { slot: 1 });
  await wait(250);
  const cleaveCd = self.hotbar[1]?.cooldownRemaining ?? 0;
  check("cleave fired: slot cooldown charged", cleaveCd > 5, `cd=${cleaveCd.toFixed(2)}`);
  check("cleave fired: GCD charged", self.gcdRemaining > 0, `gcd=${self.gcdRemaining.toFixed(2)}`);

  // Slot 0 toggles auto-attack once a target exists. setTarget is range-gated
  // (18u) and enemies spawn in combat rooms away from the start room, so walk
  // toward the nearest live enemy first (server-authoritative movement).
  const nearest = () =>
    entries(room.state.enemies)
      .map(([, e]) => e)
      .filter((e) => e.alive)
      .map((e) => ({ e, d: Math.hypot(e.x - self.x, e.z - self.z) }))
      .sort((a, b) => a.d - b.d)[0] ?? null;
  let seq = 0;
  const walkDeadline = Date.now() + 30000;
  let pick = nearest();
  while (pick && pick.d > 14 && Date.now() < walkDeadline) {
    const dx = pick.e.x - self.x;
    const dz = pick.e.z - self.z;
    const len = Math.hypot(dx, dz) || 1;
    room.send("input", { seq: seq++, moveX: dx / len, moveZ: dz / len, yaw: Math.atan2(dx, dz) });
    await wait(50);
    pick = nearest();
  }
  room.send("input", { seq: seq++, moveX: 0, moveZ: 0, yaw: 0 });
  if (!pick || pick.d > 16) throw new Error(`could not reach an enemy (d=${pick?.d.toFixed(1)})`);
  const enemy = pick.e;
  room.send("setTarget", { targetId: enemy.id, autoAttack: false });
  await wait(200);
  room.send("useSkill", { slot: 0 });
  await wait(200);
  check("slot 0 toggled auto-attack ON", self.autoAttack === true);
  room.send("useSkill", { slot: 0 });
  await wait(200);
  check("slot 0 toggled auto-attack OFF", self.autoAttack === false);

  await room.leave();
}

async function partB() {
  console.log("--- Part B: ticketed join, txp=5000 (persistent Lv5) ---");
  const ticket = await new SignJWT({ cid: "char-headless", rid: "run-headless", seed: 42, txp: 5000 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("acct-headless")
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(new TextEncoder().encode(DEV_SECRET));

  const { room, self } = await joinRoom({ name: "SkillChkB", classId: "knight", ticket });

  check("base level derived from ticket txp (Lv5)", self.level === 5, `level=${self.level}`);
  const bar = hotbar(self);
  check("shield_wall (Lv3) unlocked at Lv5", bar[2].unlocked === true);
  check("whirlwind (Lv6) still locked at Lv5", bar[3].unlocked === false);

  // GCD cross-skill block: shield_wall commits, cleave in the same instant is
  // refused by the GCD (its own cooldown stays 0), then fires once GCD clears.
  room.send("useSkill", { slot: 2 }); // shield_wall
  room.send("useSkill", { slot: 1 }); // cleave — must be GCD-blocked
  await wait(250);
  check("shield_wall fired (cooldown charged)", (self.hotbar[2]?.cooldownRemaining ?? 0) > 8);
  check("shield buff active (shieldSeconds > 0)", self.shieldSeconds > 0);
  check("cleave GCD-blocked in same instant", (self.hotbar[1]?.cooldownRemaining ?? -1) === 0);

  await wait(1100); // let the 1s GCD clear
  room.send("useSkill", { slot: 1 });
  await wait(250);
  check("cleave fires once GCD cleared", (self.hotbar[1]?.cooldownRemaining ?? 0) > 5);

  // Locked whirlwind still rejected at Lv5 even with everything else ready.
  await wait(1100);
  room.send("useSkill", { slot: 3 });
  await wait(250);
  check("locked whirlwind rejected at Lv5", (self.hotbar[3]?.cooldownRemaining ?? -1) === 0);

  await room.leave();
}

async function main() {
  await partA();
  await partB();
  console.log(failures === 0 ? "\nRESULT: PASS ✅ all skill-system checks green" : `\nRESULT: FAIL ❌ ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; });
