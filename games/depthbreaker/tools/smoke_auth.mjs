// Headless verification of the account + character flow against the running
// backend (http://localhost:3100). Exercises: guest → create/list/delete,
// per-account isolation, guest→email register upgrade keeps the accountId,
// email login, run-start ticket, and refresh-cookie reload persistence.
const BASE = process.env.BACKEND_URL ?? "http://localhost:3100";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

async function call(path, { method = "GET", token, body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const refreshCookie = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("db_refresh="));
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 204 / empty */
  }
  return { status: res.status, json, refreshCookie };
}

const uniq = process.pid.toString(36) + Math.floor((Date.now ? 0 : 0)); // Date.now unused; keep deterministic per-run via pid
const email = `smoke_${process.pid}_${Math.floor(performance.now())}@example.com`;

async function main() {
  console.log(`--- Account + character flow @ ${BASE} ---`);

  // Guest login → wallet exists, no characters yet.
  const guest = await call("/api/auth/guest", { method: "POST", body: {} });
  check("guest login 201 + token", guest.status === 201 && !!guest.json?.accessToken, `status=${guest.status}`);
  const gToken = guest.json.accessToken;
  const gAccount = guest.json.accountId;

  const empty = await call("/api/characters", { token: gToken });
  check("new account has no characters", empty.status === 200 && empty.json.characters.length === 0);

  // Create → list shows it with total_xp (number, not bigint string).
  const made = await call("/api/characters", { method: "POST", token: gToken, body: { name: "SmokeHero", classId: "bruiser" } });
  check("create character 201", made.status === 201, `status=${made.status}`);
  const charId = made.json.character.id;
  const list = await call("/api/characters", { token: gToken });
  check("list shows the new character with numeric total_xp",
    list.json.characters.length === 1 && list.json.characters[0].total_xp === 0 && typeof list.json.characters[0].total_xp === "number");

  // Start a run → signed join ticket bound to the run.
  const run = await call("/api/runs/start", { method: "POST", token: gToken, body: { characterId: charId } });
  check("run start 201 + join ticket + seed", run.status === 201 && !!run.json.joinTicket && Number.isInteger(run.json.seed));

  // Guest → email register UPGRADE keeps the same accountId (and its character).
  const reg = await call("/api/auth/register", { method: "POST", token: gToken, body: { email, password: "supersecret1" } });
  check("guest→email register 201", reg.status === 201, `status=${reg.status} ${JSON.stringify(reg.json)}`);
  check("register keeps the same accountId (upgrade in place)", reg.json?.accountId === gAccount, `${reg.json?.accountId} vs ${gAccount}`);
  const emailToken = reg.json.accessToken;
  const afterUpgrade = await call("/api/characters", { token: emailToken });
  check("upgraded account still owns its character", afterUpgrade.json.characters.some((c) => c.id === charId));

  // Email login (fresh token) works and sees the same character.
  const login = await call("/api/auth/login", { method: "POST", body: { email, password: "supersecret1" } });
  check("email login 200", login.status === 200 && !!login.json?.accessToken, `status=${login.status}`);
  check("login same account", login.json.accountId === gAccount);

  // Per-account isolation: a second guest cannot see or delete the first's char.
  const other = await call("/api/auth/guest", { method: "POST", body: {} });
  const otherList = await call("/api/characters", { token: other.json.accessToken });
  check("second account is isolated (0 characters)", otherList.json.characters.length === 0);
  const crossDelete = await call(`/api/characters/${charId}`, { method: "DELETE", token: other.json.accessToken });
  check("cross-account delete refused (404)", crossDelete.status === 404, `status=${crossDelete.status}`);

  // Delete frees the slot.
  const del = await call(`/api/characters/${charId}`, { method: "DELETE", token: login.json.accessToken });
  check("owner delete 204", del.status === 204, `status=${del.status}`);
  const afterDelete = await call("/api/characters", { token: login.json.accessToken });
  check("character gone after delete", afterDelete.json.characters.length === 0);

  // Reload persistence: the refresh cookie mints a fresh access token.
  check("login set a db_refresh cookie", !!login.refreshCookie);
  const refreshed = await call("/api/auth/refresh", { method: "POST", cookie: login.refreshCookie });
  check("refresh mints a new access token for the same account",
    refreshed.status === 200 && refreshed.json?.accountId === gAccount, `status=${refreshed.status}`);

  console.log(failures === 0 ? "\nRESULT: PASS ✅ account + character flow green" : `\nRESULT: FAIL ❌ ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
  void uniq;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; });
