// Headless verification of the PvP wagered-duel MONEY paths against the running
// realtime (:2667) + backend (:3100): challenge → accept (escrow both stakes)
// → forfeit (winner takes 90%, 10% burned). Combat itself is proven by
// smoke_combat; this guards the gold flows, which are the dangerous part.
import { Client } from "colyseus.js";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3100";
const REALTIME_URL = process.env.REALTIME_URL ?? "ws://localhost:2667";
const ZONE_SECRET = process.env.ZONE_SHARED_SECRET ?? "dev-zone-shared-secret-change-me";
const STAKE = 50;

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

async function joinPlayer(name) {
  const guest = await api("/api/auth/guest", { method: "POST", body: {} });
  const token = guest.json.accessToken, accountId = guest.json.accountId;
  const made = await api("/api/characters", { method: "POST", token, body: { name, classId: "knight" } });
  const run = await api("/api/runs/start", { method: "POST", token, body: { characterId: made.json.character.id } });
  // Fund the wallet through the zone-secret credit route (ledgered, capped).
  await api(`/internal/wallet/${accountId}/credit`, { method: "POST", secret: ZONE_SECRET, body: { amount: 200, reason: "smoke_duel", ref: `smoke:duel:${accountId}` } });
  const client = new Client(REALTIME_URL);
  const room = await client.joinOrCreate("zone", { ticket: run.json.joinTicket, name, classId: "knight" });
  const chat = [];
  for (const t of ["welcome", "combatEvent", "lootEvent", "stash", "dailies", "skins", "spinner", "spinResult", "telegraph"]) room.onMessage(t, () => {});
  room.onMessage("chat", (m) => chat.push(m));
  const self = await waitFor(() => room.state?.players?.get(room.sessionId), `${name} self`);
  await wait(500);
  return { room, self, accountId, token, chat, name };
}

const balanceOf = async (accountId) => (await api(`/internal/wallet/${accountId}`, { secret: ZONE_SECRET })).json?.balance ?? -1;

console.log("--- PvP duel money paths (challenge / escrow / forfeit payout) ---");
const A = await joinPlayer("duelistA");
const B = await joinPlayer("duelistB");

const startA = await balanceOf(A.accountId);
const startB = await balanceOf(B.accountId);
check("both funded", startA >= STAKE && startB >= STAKE, `A=${startA} B=${startB}`);

// Challenge + accept → escrow.
A.room.send("chat", { text: `/duel ${B.name} ${STAKE}` });
await waitFor(() => B.chat.some((m) => m.text?.includes("challenges")), "challenge broadcast");
B.room.send("chat", { text: "/accept" });
await waitFor(() => A.chat.some((m) => m.text?.includes("Fight!")), "duel started");
await wait(1300); // > the 1s chat rate-limit, so /forfeit below isn't dropped
const escrowA = await balanceOf(A.accountId);
const escrowB = await balanceOf(B.accountId);
check("both stakes escrowed", escrowA === startA - STAKE && escrowB === startB - STAKE, `A=${escrowA} B=${escrowB}`);
check("auto-engaged (A targets B)", A.self.targetId === B.room.sessionId, `target=${A.self.targetId}`);

// A forfeits → B wins 90% of the pot; 10% burns.
A.room.send("chat", { text: "/forfeit" });
await waitFor(() => A.chat.some((m) => m.text?.includes("wins the duel")), "duel resolved");
await wait(700);
const endA = await balanceOf(A.accountId);
const endB = await balanceOf(B.accountId);
const payout = Math.floor(STAKE * 2 * 0.9);
check("loser paid the stake", endA === startA - STAKE, `A=${endA} (start ${startA})`);
check("winner took 90% of the pot", endB === startB - STAKE + payout, `B=${endB} (start ${startB}, payout ${payout})`);
check("10% burned (money left the world)", startA + startB - endA - endB === STAKE * 2 - payout, `burn=${startA + startB - endA - endB}`);

// A second /accept must be a no-op (no dangling challenge).
B.room.send("chat", { text: "/accept" });
await wait(600);
check("stale /accept is a no-op", (await balanceOf(A.accountId)) === endA && (await balanceOf(B.accountId)) === endB);

A.room.leave();
B.room.leave();
await wait(300);
console.log(failures ? `\nRESULT: FAIL ❌ ${failures} check(s) failed` : "\nRESULT: PASS ✅ duel money paths green");
process.exit(failures ? 1 : 0);
