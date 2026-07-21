import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyJoinTicket } from "../auth/joinTicket.js";
import { createGuest, createTestApp, hasTestDb, truncateAll, type TestApp } from "./helpers/testApp.js";

describe.skipIf(!hasTestDb)("Runs + internal reporting (requires TEST_DATABASE_URL)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll(t.pool);
  });

  async function setupRun() {
    const guest = await createGuest(t.app);
    const auth = { authorization: `Bearer ${guest.accessToken}` };
    const charRes = await t.app.inject({
      method: "POST",
      url: "/api/characters",
      headers: auth,
      payload: { name: "Testa", classId: "necromancer" },
    });
    expect(charRes.statusCode).toBe(201);
    const characterId = charRes.json().character.id as string;
    const runRes = await t.app.inject({
      method: "POST",
      url: "/api/runs/start",
      headers: auth,
      payload: { characterId },
    });
    expect(runRes.statusCode).toBe(201);
    return { guest, auth, characterId, run: runRes.json() as { runId: string; seed: number; wsUrl: string; joinTicket: string } };
  }

  function finish(runId: string, secret: string, body: Record<string, unknown>) {
    return t.app.inject({
      method: "POST",
      url: `/internal/runs/${runId}/finish`,
      headers: { authorization: `Bearer ${secret}` },
      payload: body,
    });
  }

  it("run start issues a verifiable join ticket bound to the run", async () => {
    const { run, characterId, guest } = await setupRun();
    expect(run.seed).toBeGreaterThanOrEqual(0);
    expect(run.seed).toBeLessThan(4294967296);
    const claims = await verifyJoinTicket(run.joinTicket, t.config.zoneSharedSecret);
    expect(claims).toMatchObject({
      accountId: guest.accountId,
      characterId,
      runId: run.runId,
      seed: run.seed,
      totalXp: 0, // fresh character has no persistent XP yet
      skinId: "", // fresh character wears the class default
    });
  });

  it("starting a new run abandons the previous active one", async () => {
    const { auth, characterId, run } = await setupRun();
    const second = await t.app.inject({
      method: "POST",
      url: "/api/runs/start",
      headers: auth,
      payload: { characterId },
    });
    expect(second.statusCode).toBe(201);
    const old = await t.pool.query<{ status: string }>("SELECT status FROM runs WHERE id = $1", [
      run.runId,
    ]);
    expect(old.rows[0]!.status).toBe("abandoned");
  });

  it("rejects a bad zone secret", async () => {
    const { run } = await setupRun();
    const res = await finish(run.runId, "wrong-secret", {
      outcome: "dead",
      depthReached: 1,
      xpEarned: 100,
      currencyEarned: 10,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects implausible reports with 422", async () => {
    const { run } = await setupRun();
    const tooMuchXp = await finish(run.runId, t.config.zoneSharedSecret, {
      outcome: "dead",
      depthReached: 1,
      xpEarned: 999_999, // maxXpForDepth(1) = 5000
      currencyEarned: 10,
    });
    expect(tooMuchXp.statusCode).toBe(422);

    const tooMuchCurrency = await finish(run.runId, t.config.zoneSharedSecret, {
      outcome: "dead",
      depthReached: 2,
      xpEarned: 100,
      currencyEarned: 100_000, // maxCurrencyForDepth(2) = 220
    });
    expect(tooMuchCurrency.statusCode).toBe(422);
  });

  it("finishes a run once (idempotent), credits the wallet, records history", async () => {
    const { guest, auth, characterId, run } = await setupRun();

    const ok = await finish(run.runId, t.config.zoneSharedSecret, {
      outcome: "dead",
      depthReached: 2,
      xpEarned: 4000,
      currencyEarned: 150,
      loot: [{ baseItemId: "rusty_blade", rarity: "common", stats: { attack: 3 } }],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ credited: 150, balance: 150 });

    // Persistent progression: the finish credited the character's total_xp...
    const xpRow = await t.pool.query<{ total_xp: string }>(
      "SELECT total_xp FROM characters WHERE id = $1",
      [characterId],
    );
    expect(Number(xpRow.rows[0]!.total_xp)).toBe(4000);

    const again = await finish(run.runId, t.config.zoneSharedSecret, {
      outcome: "dead",
      depthReached: 2,
      xpEarned: 4000,
      currencyEarned: 150,
    });
    expect(again.statusCode).toBe(409);

    // ...exactly once — the 409 replay must not double-credit it.
    const xpAfterReplay = await t.pool.query<{ total_xp: string }>(
      "SELECT total_xp FROM characters WHERE id = $1",
      [characterId],
    );
    expect(Number(xpAfterReplay.rows[0]!.total_xp)).toBe(4000);

    // A new run's ticket now carries the accumulated XP as the base level.
    const nextRun = await t.app.inject({
      method: "POST",
      url: "/api/runs/start",
      headers: auth,
      payload: { characterId },
    });
    expect(nextRun.statusCode).toBe(201);
    const nextClaims = await verifyJoinTicket(nextRun.json().joinTicket, t.config.zoneSharedSecret);
    expect(nextClaims?.totalXp).toBe(4000);

    const meta = await t.app.inject({ method: "GET", url: "/api/meta", headers: auth });
    expect(meta.json().currency).toBe(150);
    void guest;

    const history = await t.app.inject({
      method: "GET",
      url: `/api/runs/history?characterId=${characterId}`,
      headers: auth,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().runs).toHaveLength(1);
    expect(history.json().runs[0]).toMatchObject({ status: "dead", depth_reached: 2 });
  });

  it("checkpoint raises depth monotonically for the active run", async () => {
    const { characterId, run } = await setupRun();
    const checkpoint = (depth: number) =>
      t.app.inject({
        method: "POST",
        url: `/internal/characters/${characterId}/checkpoint`,
        headers: { authorization: `Bearer ${t.config.zoneSharedSecret}` },
        payload: { depthReached: depth },
      });

    expect((await checkpoint(3)).statusCode).toBe(200);
    expect((await checkpoint(1)).statusCode).toBe(200); // lower value must not regress
    const row = await t.pool.query<{ depth_reached: number }>(
      "SELECT depth_reached FROM runs WHERE id = $1",
      [run.runId],
    );
    expect(row.rows[0]!.depth_reached).toBe(3);
  });
});
