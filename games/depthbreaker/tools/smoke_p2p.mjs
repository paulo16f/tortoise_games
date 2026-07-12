// Headless verification of the town cluster: P2P marketplace (list -> browse ->
// buy -> settle), the free spinner (spin once, blocked within 24h), world chat
// (broadcast between two clients in a room), and RefreshPrivate (out-of-band
// gold credit reflected in the live zone after a refresh). Runs against the
// backend (:3100) + realtime (:2667). Combat-free; the seller's stash is seeded
// via the internal deposit route so listing has something to escrow.
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
async function walletBalance(accountId) { return (await api(`/internal/wallet/${accountId}`, { secret: ZONE_SECRET })).json?.balance ?? 0; }
async function stashItems(accountId) { return (await api(`/internal/stash/${accountId}`, { secret: ZONE_SECRET })).json?.items ?? []; }

async function newAccount(name) {
  const guest = await api("/api/auth/guest", { method: "POST", body: {} });
  const token = guest.json.accessToken;
  const accountId = guest.json.accountId;
  const made = await api("/api/characters", { method: "POST", token, body: { name, classId: "knight" } });
  return { token, accountId, characterId: made.json.character.id };
}

async function joinRun(token, characterId, name) {
  const run = await api("/api/runs/start", { method: "POST", token, body: { characterId } });
  const client = new Client(REALTIME_URL);
  const room = await client.joinOrCreate("zone", { ticket: run.json.joinTicket, name, classId: "knight" });
  const box = { spinner: null, spinResult: null, chat: [] };
  for (const t of ["welcome", "combatEvent", "lootEvent", "stash", "dailies", "skins"]) room.onMessage(t, () => {});
  room.onMessage("spinner", (m) => { box.spinner = m; });
  room.onMessage("spinResult", (m) => { box.spinResult = m; });
  room.onMessage("chat", (m) => { box.chat.push(m); });
  const self = await waitFor(() => room.state?.players?.get(room.sessionId), "self");
  return { room, self, box };
}

async function main() {
  console.log("--- Town cluster (P2P market / spinner / chat / refresh) ---");
  const seller = await newAccount("Seller");
  const buyer = await newAccount("Buyer");

  // === P2P MARKET: seed seller stash, list, buyer browses + buys, settle ===
  await api(`/internal/stash/${seller.accountId}/deposit`, { secret: ZONE_SECRET, method: "POST", body: { itemId: "iron_ore", count: 5 } });
  const listed = await api("/api/market/list", { method: "POST", token: seller.token, body: { itemId: "iron_ore", count: 5, price: 120 } });
  check("seller can list stash items", listed.status === 201, `status=${listed.status}`);
  check("listing escrowed items out of the seller stash", (await stashItems(seller.accountId)).length === 0);

  await api(`/internal/wallet/${buyer.accountId}/credit`, { method: "POST", secret: ZONE_SECRET, body: { amount: 500, reason: "test-topup" } });
  const browse = await api("/api/market/listings", { token: buyer.token });
  const target = (browse.json.listings ?? []).find((l) => l.id === listed.json.id);
  check("buyer sees the listing in browse", !!target && !target.mine, JSON.stringify(target ?? {}));
  check("seller is anonymized in the listing view", !!target && target.seller.startsWith("Player-"));

  const sellerGoldBefore = await walletBalance(seller.accountId);
  const bought = await api("/api/market/buy", { method: "POST", token: buyer.token, body: { listingId: listed.json.id } });
  check("buy succeeded", bought.status === 200, `status=${bought.status}`);
  check("buyer charged the listing price (500 -> 380)", bought.json.balance === 380, `balance=${bought.json?.balance}`);
  check("seller received the full gold price", (await walletBalance(seller.accountId)) === sellerGoldBefore + 120);
  check("item landed in the buyer stash", (await stashItems(buyer.accountId)).some((i) => i.itemId === "iron_ore" && i.count === 5));
  const mine = await api("/api/market/mine", { token: seller.token });
  check("listing now shows as sold", (mine.json.listings ?? []).some((l) => l.id === listed.json.id && l.status === "sold"));

  // Cancel path: seller lists again, then cancels; items return to stash.
  await api(`/internal/stash/${seller.accountId}/deposit`, { secret: ZONE_SECRET, method: "POST", body: { itemId: "crystal_shard", count: 2 } });
  const relist = await api("/api/market/list", { method: "POST", token: seller.token, body: { itemId: "crystal_shard", count: 2, price: 90 } });
  await api("/api/market/cancel", { method: "POST", token: seller.token, body: { listingId: relist.json.id } });
  check("cancel returns escrowed items to the stash", (await stashItems(seller.accountId)).some((i) => i.itemId === "crystal_shard" && i.count === 2));

  // === SPINNER: first spin awards a prize; second within 24h is blocked ===
  const s = await joinRun(buyer.token, buyer.characterId, "Buyer");
  await wait(300);
  s.room.send("spin", {});
  await waitFor(() => s.box.spinResult, "spin result");
  check("free spin awarded a prize", s.box.spinResult.count > 0, JSON.stringify(s.box.spinResult));
  check("spin started the 24h cooldown", s.box.spinResult.cooldownRemaining === 86400);
  s.box.spinner = null;
  s.room.send("spin", {});
  await waitFor(() => s.box.spinner, "second-spin cooldown");
  check("second spin within 24h is on cooldown", s.box.spinner.cooldownRemaining > 86000, `remaining=${s.box.spinner?.cooldownRemaining}`);

  // === REFRESH: out-of-band credit is reflected after RefreshPrivate ===
  const goldBefore = s.self.gold;
  await api(`/internal/wallet/${buyer.accountId}/credit`, { method: "POST", secret: ZONE_SECRET, body: { amount: 250, reason: "test-oob" } });
  s.room.send("refreshPrivate", {});
  await waitFor(() => s.self.gold === goldBefore + 250, "refreshed gold", 8000);
  check("RefreshPrivate re-synced the out-of-band gold credit", s.self.gold === goldBefore + 250, `gold ${goldBefore}->${s.self.gold}`);

  // === CHAT: a broadcast from one client reaches the other in the room ===
  const s2 = await joinRun(seller.token, seller.characterId, "Seller");
  await wait(300);
  s.room.send("chat", { text: "hello town" });
  await waitFor(() => s2.box.chat.some((m) => m.text === "hello town"), "chat broadcast", 8000);
  const line = s2.box.chat.find((m) => m.text === "hello town");
  check("chat broadcast reached the other player", !!line);
  check("chat line carries the sender name", line?.from === "Buyer", `from=${line?.from}`);
  // Let the 1s rate-limit window clear from the "hello town" line, then fire two
  // back-to-back: the first passes, the second is dropped inside the window.
  await wait(1200);
  s.room.send("chat", { text: "spam1" });
  s.room.send("chat", { text: "spam2" });
  await wait(500);
  const spamCount = s2.box.chat.filter((m) => m.text.startsWith("spam")).length;
  check("chat is rate-limited (back-to-back drop)", spamCount === 1, `delivered=${spamCount}`);

  await s.room.leave();
  await s2.room.leave();
  console.log(failures === 0 ? "\nRESULT: PASS ✅ town cluster green" : `\nRESULT: FAIL ❌ ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; });
