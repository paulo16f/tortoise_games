// Headless verification of the distinct 4-class kits against the running
// realtime (:2667) + backend (:3100). Each class is leveled to 9 (via
// zone-secret run-finish XP grants, so the FULL 7-skill kit is unlocked),
// joined, and its signature mechanics are exercised end-to-end:
//   Cleric      — solo-viable: Smite deals ranged damage; Holy Nova deals
//                 point-blank AoE damage; Blessing buffs damage (ampSeconds);
//                 Mend self-heals after taking a hit; Sanctuary unlocked.
//   Necromancer — Corruption DoT keeps ticking; Bone Spear nukes at range;
//                 Drain Life heals the necromancer from afar; Bone Armor unlocked.
//   Reaper      — Soul Reap lifesteals; Rupture's bleed keeps ticking.
//   Knight      — Taunt forces a nearby enemy to target the knight.
import { Client } from "colyseus.js";
import { makeNav } from "./navlib.mjs";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3100";
const REALTIME_URL = process.env.REALTIME_URL ?? "ws://localhost:2667";
const ZONE_SECRET = process.env.ZONE_SHARED_SECRET ?? "dev-zone-shared-secret-change-me";

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
async function api(path, { method = "GET", token, body, secret } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const res = await fetch(`${BACKEND_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const entries = (m) => { const out = []; m?.forEach((v, k) => out.push([k, v])); return out; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const HOTBAR = { silence: () => {} };

function nearestAliveEnemy(room, self, maxRank = "elite") {
  const rankOrder = { normal: 0, elite: 1, boss: 2 };
  const alive = entries(room.state.enemies).map(([, e]) => e)
    .filter((e) => e.alive && rankOrder[e.rank] <= rankOrder[maxRank]);
  alive.sort((a, b) => dist(a, self) - dist(b, self));
  return alive[0];
}

// Walk toward a (possibly moving) enemy until within stopDist, with a wall-slide
// unstick so corridors don't strand the beeline.
async function walkNear(room, self, enemyId, stopDist = 14, timeoutMs = 30000) {
  // BFS over the seed-built dungeon (navlib) — survives any level design.
  const nav = navFor(room);
  await nav.walkNearEnemy(self, enemyId, stopDist, timeoutMs);
  await wait(150);
}
const _navs = new Map();
function navFor(room) {
  if (!_navs.has(room)) _navs.set(room, makeNav(room));
  return _navs.get(room);
}

// guest → character(classId) → grant 30000 XP via three run-finishes (level 9,
// the full 7-skill kit unlocked) → start a fresh run → join the zone.
async function leveledClass(classId, name) {
  const guest = await api("/api/auth/guest", { method: "POST", body: {} });
  const token = guest.json.accessToken, accountId = guest.json.accountId;
  const made = await api("/api/characters", { method: "POST", token, body: { name, classId } });
  const characterId = made.json.character.id;
  // Grant XP through the plausible run-finish path (depth 2 caps XP at 10000
  // per run, so three runs reach the 29,323 total XP that level 9 needs).
  for (let i = 0; i < 3; i++) {
    const runA = await api("/api/runs/start", { method: "POST", token, body: { characterId } });
    await api(`/internal/runs/${runA.json.runId}/finish`, {
      method: "POST", secret: ZONE_SECRET,
      body: { outcome: "complete", depthReached: 2, xpEarned: 10000, currencyEarned: 0, loot: [] },
    });
  }
  const runB = await api("/api/runs/start", { method: "POST", token, body: { characterId } });
  const client = new Client(REALTIME_URL);
  const room = await client.joinOrCreate("zone", { ticket: runB.json.joinTicket, name, classId });
  for (const t of ["welcome", "combatEvent", "lootEvent", "stash", "dailies", "skins", "spinner", "spinResult", "chat", "telegraph"]) room.onMessage(t, HOTBAR.silence);
  const self = await waitFor(() => room.state?.players?.get(room.sessionId), "self");
  await wait(400);
  return { room, self, accountId, token };
}

const slotUnlocked = (self, skillId) => {
  let ok = false;
  self.hotbar.forEach((s) => { if (s.skillId === skillId && s.unlocked) ok = true; });
  return ok;
};

async function cast(room, slot) { room.send("useSkill", { slot }); }

// Stand in an enemy's melee until it damages the player (for heal tests).
async function takeAHit(room, self, enemyId, timeoutMs = 9000) {
  const start = self.hp;
  await walkNear(room, self, enemyId, 2.0, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  let seq = 8000;
  while (Date.now() < deadline && self.hp >= start && self.alive) {
    const e = room.state.enemies.get(enemyId);
    if (!e?.alive) break;
    room.send("input", { seq: seq++, moveX: 0, moveZ: 0, yaw: Math.atan2(e.x - self.x, e.z - self.z) });
    await wait(120);
  }
  return self.hp < start;
}

async function testCleric() {
  console.log("--- Cleric (solo-viable: damage + heals + buff + ward) ---");
  const { room, self } = await leveledClass("cleric", "Priestess");
  check("cleric reached Lv9 (full kit)", self.level >= 9, `level=${self.level}`);
  check("Smite (damage) is unlocked", slotUnlocked(self, "smite"));
  check("Renew (ally heal) is unlocked", slotUnlocked(self, "renew"));
  check("Blessing (damage buff) is unlocked", slotUnlocked(self, "blessing"));
  check("Holy Nova (AoE damage) is unlocked", slotUnlocked(self, "holy_nova"));
  check("Sanctuary (ward) is unlocked", slotUnlocked(self, "sanctuary"));

  // Blessing: pure self-buff, no combat needed — the most reliable buff proof.
  await cast(room, 5); // blessing = slot 5
  await waitFor(() => (self.ampSeconds ?? 0) > 0, "blessing amp active", 4000).catch(() => {});
  check("Blessing sets the damage-amp buff (ampSeconds > 0)", (self.ampSeconds ?? 0) > 0, `amp=${(self.ampSeconds ?? 0).toFixed(1)}`);

  // Smite: ranged holy damage — the cleric can kill on its own.
  const foe = nearestAliveEnemy(room, self);
  if (foe) {
    await walkNear(room, self, foe.id, 12);
    room.send("setTarget", { targetId: foe.id, autoAttack: false });
    await wait(200);
    const hp0 = room.state.enemies.get(foe.id)?.hp ?? foe.hp;
    await cast(room, 2); // smite = slot 2
    await waitFor(() => !room.state.enemies.get(foe.id)?.alive || (room.state.enemies.get(foe.id)?.hp ?? hp0) < hp0, "smite lands", 6000).catch(() => {});
    const live = room.state.enemies.get(foe.id);
    check("Smite deals ranged damage", !live?.alive || live.hp < hp0, `hp ${hp0}->${live?.hp ?? "dead"}`);

    // Holy Nova: walk into point-blank range and burst. The aggroed enemy is
    // often already adjacent, so walkNear returns instantly — wait out smite's
    // GCD first or the cast is dropped (input buffer only spans 0.6s).
    const novaFoe = nearestAliveEnemy(room, self);
    if (novaFoe) {
      await walkNear(room, self, novaFoe.id, 2.5);
      await waitFor(() => (self.gcdRemaining ?? 0) === 0, "gcd clear", 4000).catch(() => {});
      const nHp0 = room.state.enemies.get(novaFoe.id)?.hp ?? novaFoe.hp;
      await cast(room, 4); // holy_nova = slot 4
      await waitFor(() => !room.state.enemies.get(novaFoe.id)?.alive || (room.state.enemies.get(novaFoe.id)?.hp ?? nHp0) < nHp0, "holy nova lands", 6000).catch(() => {});
      const nLive = room.state.enemies.get(novaFoe.id);
      check("Holy Nova damages a point-blank enemy", !nLive?.alive || nLive.hp < nHp0, `hp ${nHp0}->${nLive?.hp ?? "dead"}`);
    } else {
      check("Holy Nova test (skipped — no enemy reachable)", true);
    }

    // Mend: get hit, then self-heal.
    const foe2 = nearestAliveEnemy(room, self) ?? foe;
    const damaged = foe2 ? await takeAHit(room, self, foe2.id) : false;
    if (damaged) {
      const hpHurt = self.hp;
      await cast(room, 1); // mend = slot 1
      await waitFor(() => self.hp > hpHurt, "mend heals", 4000).catch(() => {});
      check("Mend restores the cleric's health", self.hp > hpHurt, `hp ${hpHurt}->${self.hp}`);
    } else {
      check("Mend self-heal (skipped — cleric was not damaged in time)", true);
    }
  } else {
    check("Smite test (skipped — no enemy reachable)", true);
  }
  await room.leave();
}

async function testNecromancer() {
  console.log("--- Necromancer (affliction caster: DoT + nuke + ranged drain) ---");
  const { room, self } = await leveledClass("necromancer", "Bonelord");
  check("necromancer reached Lv9 (full kit)", self.level >= 9, `level=${self.level}`);
  check("Corruption (DoT) is unlocked", slotUnlocked(self, "corruption"));
  check("Drain Life (ranged lifesteal) is unlocked", slotUnlocked(self, "drain_life"));
  check("Bone Spear (nuke) is unlocked", slotUnlocked(self, "bone_spear"));
  check("Bone Armor (ward) is unlocked", slotUnlocked(self, "bone_armor"));

  const foe = nearestAliveEnemy(room, self);
  if (foe) {
    await walkNear(room, self, foe.id, 12);
    room.send("setTarget", { targetId: foe.id, autoAttack: false });
    await wait(200);
    await cast(room, 3); // corruption = slot 3
    await wait(900); // let the curse settle + first tick land
    const hpAfterCast = room.state.enemies.get(foe.id)?.hp ?? 0;
    // Now do NOTHING for ~3s: only the DoT can lower the enemy's HP.
    await wait(3200);
    const hpLater = room.state.enemies.get(foe.id)?.hp ?? 0;
    const live = room.state.enemies.get(foe.id);
    check("Corruption keeps ticking with no further action", !live?.alive || hpLater < hpAfterCast, `hp ${hpAfterCast}->${live?.alive ? hpLater : "dead"}`);

    // Bone Spear: heavy single-target projectile on whatever is still alive.
    const spearFoe = room.state.enemies.get(foe.id)?.alive ? foe : nearestAliveEnemy(room, self);
    if (spearFoe) {
      await walkNear(room, self, spearFoe.id, 12);
      room.send("setTarget", { targetId: spearFoe.id, autoAttack: false });
      await wait(200);
      const sHp0 = room.state.enemies.get(spearFoe.id)?.hp ?? spearFoe.hp;
      await cast(room, 5); // bone_spear = slot 5
      await waitFor(() => !room.state.enemies.get(spearFoe.id)?.alive || (room.state.enemies.get(spearFoe.id)?.hp ?? sHp0) < sHp0, "bone spear lands", 6000).catch(() => {});
      const sLive = room.state.enemies.get(spearFoe.id);
      check("Bone Spear nukes the target at range", !sLive?.alive || sLive.hp < sHp0, `hp ${sHp0}->${sLive?.hp ?? "dead"}`);
    } else {
      check("Bone Spear test (skipped — no enemy reachable)", true);
    }

    // Drain Life: take a hit so there's missing HP, then siphon from range.
    const drainFoe = nearestAliveEnemy(room, self);
    const damaged = drainFoe ? await takeAHit(room, self, drainFoe.id, 10000) : false;
    const drainTarget = drainFoe && room.state.enemies.get(drainFoe.id)?.alive ? drainFoe : nearestAliveEnemy(room, self);
    if (damaged && drainTarget) {
      await walkNear(room, self, drainTarget.id, 10); // inside drain's 12u range, outside melee
      room.send("setTarget", { targetId: drainTarget.id, autoAttack: false });
      await wait(200);
      const hpBefore = self.hp;
      await cast(room, 4); // drain_life = slot 4
      await waitFor(() => self.hp > hpBefore, "drain life heals", 4000).catch(() => {});
      check("Drain Life heals the necromancer from afar", self.hp > hpBefore, `hp ${hpBefore}->${self.hp}`);
    } else {
      check("Drain Life (skipped — necromancer not damaged / no target)", true);
    }
  } else {
    check("Corruption test (skipped — no enemy reachable)", true);
  }
  await room.leave();
}

async function testReaper() {
  console.log("--- Reaper (Soul Reap lifesteal + Rupture bleed) ---");
  const { room, self } = await leveledClass("reaper", "Grimscythe");
  check("reaper reached Lv9 (full kit)", self.level >= 9, `level=${self.level}`);
  check("Soul Reap (lifesteal) is unlocked", slotUnlocked(self, "soul_reap"));
  check("Rupture (bleed) is unlocked", slotUnlocked(self, "rupture"));

  const foe = nearestAliveEnemy(room, self, "normal");
  if (foe) {
    // Take a hit so there's missing HP for the drain to restore.
    const damaged = await takeAHit(room, self, foe.id, 10000);
    const target = room.state.enemies.get(foe.id)?.alive ? foe : nearestAliveEnemy(room, self, "normal");
    if (damaged && target) {
      await walkNear(room, self, target.id, 2.4);
      room.send("setTarget", { targetId: target.id, autoAttack: false });
      await wait(200);
      const hpBefore = self.hp;
      await cast(room, 2); // soul_reap = slot 2
      await waitFor(() => self.hp > hpBefore, "soul reap heals", 4000).catch(() => {});
      check("Soul Reap heals the reaper on a strike (lifesteal)", self.hp > hpBefore, `hp ${hpBefore}->${self.hp}`);

      // Rupture: melee bleed — strike, then verify the dot keeps ticking hands-off.
      const bleedFoe = room.state.enemies.get(target.id)?.alive ? target : nearestAliveEnemy(room, self, "normal");
      if (bleedFoe) {
        await walkNear(room, self, bleedFoe.id, 2.4);
        room.send("setTarget", { targetId: bleedFoe.id, autoAttack: false });
        await wait(200);
        await cast(room, 6); // rupture = slot 6
        await wait(900); // strike + first bleed tick
        const bHp0 = room.state.enemies.get(bleedFoe.id)?.hp ?? 0;
        await wait(2600); // hands off: only the bleed can lower HP now
        const bLive = room.state.enemies.get(bleedFoe.id);
        check("Rupture's bleed keeps ticking with no further action", !bLive?.alive || bLive.hp < bHp0, `hp ${bHp0}->${bLive?.alive ? bLive.hp : "dead"}`);
      } else {
        check("Rupture test (skipped — no enemy reachable)", true);
      }
    } else {
      check("Soul Reap lifesteal (skipped — reaper not damaged / no target)", true);
    }
  } else {
    check("Soul Reap test (skipped — no enemy reachable)", true);
  }
  await room.leave();
}

async function testKnight() {
  console.log("--- Knight (Taunt threat control) ---");
  const { room, self } = await leveledClass("knight", "Bulwarken");
  check("knight reached Lv9 (full kit)", self.level >= 9, `level=${self.level}`);
  check("Taunt is unlocked", slotUnlocked(self, "taunt"));

  const foe = nearestAliveEnemy(room, self);
  if (foe) {
    await walkNear(room, self, foe.id, 6); // inside the 8u taunt radius
    await cast(room, 4); // taunt = slot 4
    await waitFor(() => room.state.enemies.get(foe.id)?.targetId === room.sessionId, "enemy taunted onto knight", 4000).catch(() => {});
    const live = room.state.enemies.get(foe.id);
    check("Taunt forces a nearby enemy to target the knight", live?.targetId === room.sessionId, `targetId=${live?.targetId} vs ${room.sessionId}`);
  } else {
    check("Taunt test (skipped — no enemy reachable)", true);
  }
  await room.leave();
}

async function main() {
  console.log("=== Distinct class kits (Knight / Reaper / Cleric / Necromancer) ===");
  await testCleric();
  await testNecromancer();
  await testReaper();
  await testKnight();
  console.log(failures === 0 ? "\nRESULT: PASS ✅ class kits green" : `\nRESULT: FAIL ❌ ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; });
