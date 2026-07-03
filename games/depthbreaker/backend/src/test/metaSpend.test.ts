import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest, createTestApp, hasTestDb, truncateAll, type TestApp } from "./helpers/testApp.js";

describe.skipIf(!hasTestDb)("Meta spend (requires TEST_DATABASE_URL)", () => {
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

  async function spend(accessToken: string, upgradeId: string) {
    return t.app.inject({
      method: "POST",
      url: "/api/meta/spend",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { upgradeId },
    });
  }

  async function grantCurrency(accountId: string, amount: number): Promise<void> {
    await t.pool.query("UPDATE meta_wallets SET currency = $2 WHERE account_id = $1", [
      accountId,
      amount,
    ]);
  }

  it("buys a rank, debits the wallet, and reports the new state", async () => {
    const guest = await createGuest(t.app);
    await grantCurrency(guest.accountId, 500);

    const res = await spend(guest.accessToken, "vitality");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ upgradeId: "vitality", rank: 1, currency: 450 });

    const meta = await t.app.inject({
      method: "GET",
      url: "/api/meta",
      headers: { authorization: `Bearer ${guest.accessToken}` },
    });
    const vitality = meta.json().upgrades.find((u: { id: string }) => u.id === "vitality");
    expect(vitality.rank).toBe(1);
  });

  it("rejects unknown upgrades, missing prereqs, and insufficient funds", async () => {
    const guest = await createGuest(t.app);
    await grantCurrency(guest.accountId, 5000);

    expect((await spend(guest.accessToken, "nonexistent")).statusCode).toBe(404);
    // death_defiance requires vitality rank >= 1.
    expect((await spend(guest.accessToken, "death_defiance")).statusCode).toBe(409);

    await grantCurrency(guest.accountId, 10);
    const poor = await spend(guest.accessToken, "swiftness"); // costs 150
    expect(poor.statusCode).toBe(402);
  });

  it("enforces max rank and escalating rank costs", async () => {
    const guest = await createGuest(t.app);
    await grantCurrency(guest.accountId, 10_000);

    // vitality costs 50,100,200,400,800 over 5 ranks = 1550 total.
    for (let rank = 1; rank <= 5; rank++) {
      const res = await spend(guest.accessToken, "vitality");
      expect(res.statusCode).toBe(200);
      expect(res.json().rank).toBe(rank);
    }
    expect((await spend(guest.accessToken, "vitality")).statusCode).toBe(409);

    const meta = await t.app.inject({
      method: "GET",
      url: "/api/meta",
      headers: { authorization: `Bearer ${guest.accessToken}` },
    });
    expect(meta.json().currency).toBe(10_000 - 1550);
  });

  it("prereq unlocks once the parent has a rank", async () => {
    const guest = await createGuest(t.app);
    await grantCurrency(guest.accountId, 5000);
    await spend(guest.accessToken, "vitality");
    const res = await spend(guest.accessToken, "death_defiance");
    expect(res.statusCode).toBe(200);
    expect(res.json().rank).toBe(1);
  });
});
