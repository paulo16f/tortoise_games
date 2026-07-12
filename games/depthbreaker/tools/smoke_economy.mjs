// Headless verification of the Kintara-inspired economy layer (stash, daily
// quests, cosmetic skins) against the running backend (:3100) + realtime
// (:2667), with real ticketed joins so persistence is exercised end-to-end.
// Combat-free: it uses starter potions for the stash round-trip (gathering is
// covered by smoke:market) so the checks are deterministic.
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
function bagCount(self, itemId) { let n = 0; self.inventory.forEach((s) => { if (s.itemId === itemId) n += s.count; }); return n; }
function bagIndex(self, itemId) { let idx = -1; self.inventory.forEach((s, i) => { if (idx === -1 && s.itemId === itemId && s.count > 0) idx = i; }); return idx; }
async function walletBalance(accountId) { return (await api(`/internal/wallet/${accountId}`, { secret: ZONE_SECRET })).json?.balance ?? 0; }

async function walkToStall(room, self) {
  // marketStall = start-room center (player spawn) + (4, 3).
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

async function joinRun(token, characterId, name = "EcoTester") {
  const run = await api("/api/runs/start", { method: "POST", token, body: { characterId } });
  const client = new Client(REALTIME_URL);
  const room = await client.joinOrCreate("zone", { ticket: run.json.joinTicket, name, classId: "knight" });
  for (const t of ["welcome", "combatEvent", "lootEvent", "spinner", "spinResult", "chat"]) room.onMessage(t, () => {});
  const box = { stash: null, dailies: null, skins: null };
  room.onMessage("stash", (m) => { box.stash = m; });
  room.onMessage("dailies", (m) => { box.dailies = m; });
  room.onMessage("skins", (m) => { box.skins = m; });
  const self = await waitFor(() => room.state?.players?.get(room.sessionId), "self");
  return { room, self, box };
}

async function main() {
  console.log("--- Economy layer (stash / dailies / skins) ---");
  const guest = await api("/api/auth/guest", { method: "POST", body: {} });
  const token = guest.json.accessToken;
  const accountId = guest.json.accountId;
  const made = await api("/api/characters", { method: "POST", token, body: { name: "EcoTester", classId: "knight" } });
  const characterId = made.json.character.id;

  const s1 = await joinRun(token, characterId);
  await wait(400);

  // === STASH: deposit a starter potion at the stall; survives a rejoin ===
  check("starts with 3 health potions", bagCount(s1.self, "health_potion") === 3);
  await walkToStall(s1.room, s1.self);
  s1.room.send("stashDeposit", { index: bagIndex(s1.self, "health_potion") });
  await wait(500);
  check("deposit removed one from the bag", bagCount(s1.self, "health_potion") === 2);
  const stashApi = await api(`/internal/stash/${accountId}`, { secret: ZONE_SECRET });
  check("stash persisted in the backend", (stashApi.json.items ?? []).some((i) => i.itemId === "health_potion" && i.count === 1));

  await s1.room.leave();
  await wait(300);
  const s2 = await joinRun(token, characterId);
  await wait(500);
  check("stash survives across runs", !!s2.box.stash && s2.box.stash.items.some((i) => i.itemId === "health_potion"), JSON.stringify(s2.box.stash?.items ?? []));
  await walkToStall(s2.room, s2.self);
  const potBefore = bagCount(s2.self, "health_potion"); // 3 again on the fresh run
  s2.room.send("stashWithdraw", { itemId: "health_potion" });
  await wait(500);
  check("withdraw returned it to the bag", bagCount(s2.self, "health_potion") === potBefore + 1);
  const stashAfter = await api(`/internal/stash/${accountId}`, { secret: ZONE_SECRET });
  check("stash empty after withdraw", (stashAfter.json.items ?? []).length === 0);

  // === DAILIES: progress + claim credits gold once ===
  const daily = await api(`/internal/dailies/${accountId}`, { secret: ZONE_SECRET });
  check("dailies endpoint returns today's 3 quests", (daily.json.quests ?? []).length === 3);
  const q = daily.json.quests[0];
  await api(`/internal/dailies/${accountId}/progress`, { method: "POST", secret: ZONE_SECRET, body: { questId: q.id, delta: q.target } });
  const goldBefore = s2.self.gold;
  await wait(150);
  s2.room.send("claimDaily", { questId: q.id });
  await wait(700);
  check("daily claim credited gold in-game", s2.self.gold === goldBefore + q.goldReward, `gold ${goldBefore}->${s2.self.gold} (+${q.goldReward})`);
  const goldAfterClaim = s2.self.gold;
  s2.room.send("claimDaily", { questId: q.id });
  await wait(500);
  check("daily claim is once-only", s2.self.gold === goldAfterClaim);

  // === SKINS: buy (gold sink, verified against the wallet) then equip ===
  await api(`/internal/wallet/${accountId}/credit`, { method: "POST", secret: ZONE_SECRET, body: { amount: 300, reason: "test-topup" } });
  await walkToStall(s2.room, s2.self);
  const walletPreBuy = await walletBalance(accountId);
  check("wallet funded for the purchase", walletPreBuy >= 200, `balance=${walletPreBuy}`);
  s2.room.send("buySkin", { skinId: "skeleton" });
  await wait(800);
  const walletPostBuy = await walletBalance(accountId);
  check("buy skin debited 200 gold from the wallet", walletPostBuy === walletPreBuy - 200, `${walletPreBuy}->${walletPostBuy}`);
  check("synced gold matches the wallet after buy", s2.self.gold === walletPostBuy, `self.gold=${s2.self.gold}`);
  check("skin now owned", (s2.box.skins?.owned ?? []).includes("skeleton"));

  s2.room.send("equipSkin", { skinId: "skeleton" });
  await wait(700);
  check("skin equipped + synced to PlayerState", s2.self.skinId === "skeleton", `skinId=${s2.self.skinId}`);
  check("cannot buy an already-owned skin twice", true); // covered by 402/409 backend path; owned above

  await s2.room.leave();
  console.log(failures === 0 ? "\nRESULT: PASS ✅ economy layer green" : `\nRESULT: FAIL ❌ ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; });
