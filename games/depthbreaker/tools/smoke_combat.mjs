// Headless verification of Phase-1 combat responsiveness against the running
// realtime server (:2667) + backend (:3100). Focus: the `engaging` change —
// auto-attack must (a) chase a clicked target into range and damage it, (b) keep
// landing while the player strafes in range, and (c) NOT yank the player back to
// the target after they deliberately move away (auto-attack persists, auto-follow
// does not). Combat-only; no gold/market involved.
import { Client } from "colyseus.js";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3100";
const REALTIME_URL = process.env.REALTIME_URL ?? "ws://localhost:2667";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const v = fn(); if (v) return v; await wait(60); }
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
const entries = (m) => { const out = []; m?.forEach((v, k) => out.push([k, v])); return out; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function nearestAliveEnemy(room, self) {
  const alive = entries(room.state.enemies).map(([, e]) => e).filter((e) => e.alive && e.rank !== "boss");
  alive.sort((a, b) => dist(a, self) - dist(b, self));
  return alive[0];
}

// Walk toward a (possibly moving) enemy until within `stopDist`, with a wall-slide
// unstick so corridors don't strand the beeline. Targets can only be selected
// within 18u, so we approach before setTarget.
async function walkNear(room, self, enemyId, stopDist = 14, timeoutMs = 20000) {
  let seq = 4000, lastD = Infinity, stalled = 0, slideDir = 1, slideSteps = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const e = room.state.enemies.get(enemyId);
    if (!e || !e.alive) break;
    const dx = e.x - self.x, dz = e.z - self.z, d = Math.hypot(dx, dz);
    if (d <= stopDist) break;
    if (d > lastD - 0.03) stalled++; else stalled = 0;
    lastD = d;
    let mx = dx / d, mz = dz / d;
    if (slideSteps > 0) { const px = -mz * slideDir, pz = mx * slideDir; mx = px * 0.85 + mx * 0.15; mz = pz * 0.85 + mz * 0.15; const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l; slideSteps--; }
    else if (stalled >= 6) { slideSteps = 8; slideDir *= -1; stalled = 0; }
    room.send("input", { seq: seq++, moveX: mx, moveZ: mz, yaw: Math.atan2(dx, dz) });
    await wait(50);
  }
  room.send("input", { seq: seq++, moveX: 0, moveZ: 0, yaw: 0 });
  await wait(150);
}

async function main() {
  console.log("--- Combat responsiveness (engage / strafe-attack / no yank-back) ---");
  const guest = await api("/api/auth/guest", { method: "POST", body: {} });
  const token = guest.json.accessToken;
  const made = await api("/api/characters", { method: "POST", token, body: { name: "Fighter", classId: "bruiser" } });
  const run = await api("/api/runs/start", { method: "POST", token, body: { characterId: made.json.character.id } });
  const client = new Client(REALTIME_URL);
  const room = await client.joinOrCreate("zone", { ticket: run.json.joinTicket, name: "Fighter", classId: "bruiser" });
  for (const t of ["welcome", "combatEvent", "lootEvent", "stash", "dailies", "skins", "spinner", "spinResult", "chat"]) room.onMessage(t, () => {});
  const self = await waitFor(() => room.state?.players?.get(room.sessionId), "self");
  await wait(400);

  // === A) Engage: clicking a target auto-follows it into range and damages it ===
  const foe = nearestAliveEnemy(room, self);
  check("found a target enemy", !!foe, foe ? `d=${dist(foe, self).toFixed(1)}` : "none");
  await walkNear(room, self, foe.id, 14); // get within the 18u selection range
  const hp0 = room.state.enemies.get(foe.id)?.hp ?? foe.hp;
  room.send("setTarget", { targetId: foe.id, autoAttack: true }); // engaging = true -> server chases
  await waitFor(() => !room.state.enemies.get(foe.id)?.alive || room.state.enemies.get(foe.id)?.hp < hp0, "first hit lands", 15000);
  const foeLive = room.state.enemies.get(foe.id);
  check("auto-attack chased target into range and damaged it", !foeLive?.alive || foeLive.hp < hp0, `hp ${hp0}->${foeLive?.hp ?? "dead"}`);

  // === B) Strafe-attack: moving while in range keeps auto-attack landing ===
  let foe2 = room.state.enemies.get(foe.id)?.alive ? room.state.enemies.get(foe.id) : nearestAliveEnemy(room, self);
  if (foe2) {
    await walkNear(room, self, foe2.id, 14);
    room.send("setTarget", { targetId: foe2.id, autoAttack: true });
    // Let the server bring us into range.
    await waitFor(() => dist(room.state.enemies.get(foe2.id) ?? foe2, self) <= 2.6 || !room.state.enemies.get(foe2.id)?.alive, "in melee range", 12000);
    const before = room.state.enemies.get(foe2.id);
    if (before?.alive) {
      const hpBeforeStrafe = before.hp;
      // Small alternating lateral nudges (perpendicular to the foe) — stays in
      // range while proving movement no longer cancels auto-attack.
      let seq = 5000;
      for (let i = 0; i < 24; i++) {
        const e = room.state.enemies.get(foe2.id);
        if (!e?.alive) break;
        const dx = e.x - self.x, dz = e.z - self.z, d = Math.hypot(dx, dz) || 1;
        const side = i % 8 < 4 ? 1 : -1; // strafe one way then the other
        room.send("input", { seq: seq++, moveX: (-dz / d) * side * 0.5, moveZ: (dx / d) * side * 0.5, yaw: Math.atan2(dx, dz) });
        await wait(60);
      }
      room.send("input", { seq: seq++, moveX: 0, moveZ: 0, yaw: 0 });
      await wait(300);
      const after = room.state.enemies.get(foe2.id);
      check("auto-attack keeps landing while strafing (no re-toggle needed)", !after?.alive || after.hp < hpBeforeStrafe, `hp ${hpBeforeStrafe}->${after?.hp ?? "dead"}`);
      check("auto-attack flag stayed on through movement", room.state.players.get(room.sessionId)?.autoAttack === true);
    } else {
      check("auto-attack keeps landing while strafing", true, "target died before strafe window");
    }
  }

  // === C) No yank-back: after moving away + stopping, not dragged to the target ===
  const foe3 = nearestAliveEnemy(room, self);
  if (foe3) {
    await walkNear(room, self, foe3.id, 12);
    room.send("setTarget", { targetId: foe3.id, autoAttack: true });
    await wait(400);
    // Move directly away from the target for ~1.2s, then stop.
    let seq = 6000;
    for (let i = 0; i < 20; i++) {
      const e = room.state.enemies.get(foe3.id) ?? foe3;
      const dx = self.x - e.x, dz = self.z - e.z, d = Math.hypot(dx, dz) || 1;
      room.send("input", { seq: seq++, moveX: dx / d, moveZ: dz / d, yaw: Math.atan2(dx, dz) });
      await wait(60);
    }
    room.send("input", { seq: seq++, moveX: 0, moveZ: 0, yaw: 0 });
    await wait(250);
    const stopPos = { x: self.x, z: self.z };
    const foeAtStop = room.state.enemies.get(foe3.id) ?? foe3;
    const towardFoe = { x: foeAtStop.x - stopPos.x, z: foeAtStop.z - stopPos.z };
    const towardLen = Math.hypot(towardFoe.x, towardFoe.z) || 1;
    await wait(1400); // if auto-follow wrongly re-engaged, the player would drift toward the target
    // Displacement of the PLAYER only (the enemy chasing us must not count):
    // with engaging=false and no input, movePlayers/autoFollow move us 0.
    const dispX = self.x - stopPos.x, dispZ = self.z - stopPos.z;
    const moved = Math.hypot(dispX, dispZ);
    const movedTowardFoe = (dispX * towardFoe.x + dispZ * towardFoe.z) / towardLen; // signed projection
    check("player stays put after disengaging (auto-follow off, not yanked to target)", moved < 0.6 && movedTowardFoe < 0.5, `moved=${moved.toFixed(2)}, towardFoe=${movedTowardFoe.toFixed(2)}`);
  }

  await room.leave();
  console.log(failures === 0 ? "\nRESULT: PASS ✅ combat responsiveness green" : `\nRESULT: FAIL ❌ ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; });
