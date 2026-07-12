import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest, createTestApp, hasTestDb, truncateAll, type TestApp } from "./helpers/testApp.js";

describe.skipIf(!hasTestDb)("Internal spinner routes (requires TEST_DATABASE_URL)", () => {
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

  const zone = () => ({ authorization: `Bearer ${t.config.zoneSharedSecret}` });
  const status = (a: string) => t.app.inject({ method: "GET", url: `/internal/spinner/${a}`, headers: zone() });
  const spin = (a: string) => t.app.inject({ method: "POST", url: `/internal/spinner/${a}/spin`, headers: zone() });
  const walletBalance = async (a: string) =>
    (await t.app.inject({ method: "GET", url: `/internal/wallet/${a}`, headers: zone() })).json().balance;
  const stashOf = async (a: string) =>
    (await t.app.inject({ method: "GET", url: `/internal/stash/${a}`, headers: zone() })).json().items;

  it("first spin is free, awards a prize, and starts the 24h cooldown", async () => {
    const g = await createGuest(t.app);
    expect((await status(g.accountId)).json().cooldownRemaining).toBe(0);

    const res = await spin(g.accountId);
    expect(res.statusCode).toBe(200);
    const prize = res.json();
    expect(prize.count).toBeGreaterThan(0);
    // The prize is either gold (in the wallet) or an item (in the stash).
    if (prize.isGold) {
      expect(await walletBalance(g.accountId)).toBe(prize.count);
    } else {
      expect(await stashOf(g.accountId)).toContainEqual({ itemId: prize.itemId, count: prize.count });
    }
    expect(prize.cooldownRemaining).toBe(86400);
  });

  it("a second spin within 24h is rejected with the remaining cooldown", async () => {
    const g = await createGuest(t.app);
    await spin(g.accountId);
    const second = await spin(g.accountId);
    expect(second.statusCode).toBe(429);
    expect(second.json().error).toBe("on_cooldown");
    expect(second.json().cooldownRemaining).toBeGreaterThan(86000);
    expect((await status(g.accountId)).json().cooldownRemaining).toBeGreaterThan(0);
  });

  it("becomes free again once the cooldown has elapsed", async () => {
    const g = await createGuest(t.app);
    await spin(g.accountId);
    // Fast-forward the stored timestamp past the 24h window.
    await t.pool.query("UPDATE account_spins SET last_free_spin_at = now() - interval '25 hours' WHERE account_id = $1", [g.accountId]);
    expect((await status(g.accountId)).json().cooldownRemaining).toBe(0);
    expect((await spin(g.accountId)).statusCode).toBe(200);
  });

  it("404s for an unknown account", async () => {
    expect((await spin("00000000-0000-0000-0000-000000000000")).statusCode).toBe(404);
  });
});
