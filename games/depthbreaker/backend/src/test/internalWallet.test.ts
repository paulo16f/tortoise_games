import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest, createTestApp, hasTestDb, truncateAll, type TestApp } from "./helpers/testApp.js";

describe.skipIf(!hasTestDb)("Internal wallet routes (requires TEST_DATABASE_URL)", () => {
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

  function zone() {
    return { authorization: `Bearer ${t.config.zoneSharedSecret}` };
  }
  function credit(accountId: string, amount: number) {
    return t.app.inject({ method: "POST", url: `/internal/wallet/${accountId}/credit`, headers: zone(), payload: { amount, reason: "test" } });
  }
  function debit(accountId: string, amount: number) {
    return t.app.inject({ method: "POST", url: `/internal/wallet/${accountId}/debit`, headers: zone(), payload: { amount, reason: "test" } });
  }
  function balance(accountId: string) {
    return t.app.inject({ method: "GET", url: `/internal/wallet/${accountId}`, headers: zone() });
  }

  it("credits and debits round-trip with the running balance", async () => {
    const g = await createGuest(t.app);
    expect((await balance(g.accountId)).json().balance).toBe(0);

    const c = await credit(g.accountId, 120);
    expect(c.statusCode).toBe(200);
    expect(c.json().balance).toBe(120);

    const d = await debit(g.accountId, 45);
    expect(d.statusCode).toBe(200);
    expect(d.json().balance).toBe(75);
    expect((await balance(g.accountId)).json().balance).toBe(75);
  });

  it("rejects a debit beyond the balance with 402 and leaves the balance unchanged", async () => {
    const g = await createGuest(t.app);
    await credit(g.accountId, 30);
    const d = await debit(g.accountId, 31);
    expect(d.statusCode).toBe(402);
    expect(d.json().error).toBe("insufficient_currency");
    expect((await balance(g.accountId)).json().balance).toBe(30);
  });

  it("404s for unknown wallets on all three routes", async () => {
    const ghost = "00000000-0000-0000-0000-000000000000";
    expect((await balance(ghost)).statusCode).toBe(404);
    expect((await debit(ghost, 10)).statusCode).toBe(404);
    expect((await credit(ghost, 10)).statusCode).toBe(404);
  });

  it("rejects implausible credits and schema-invalid amounts", async () => {
    const g = await createGuest(t.app);
    expect((await credit(g.accountId, 2001)).statusCode).toBe(422); // over per-call cap
    expect((await credit(g.accountId, 0)).statusCode).toBe(400); // schema minimum 1
    expect((await debit(g.accountId, -5)).statusCode).toBe(400);
    expect((await balance(g.accountId)).json().balance).toBe(0);
  });

  it("requires the zone secret", async () => {
    const g = await createGuest(t.app);
    const res = await t.app.inject({
      method: "POST",
      url: `/internal/wallet/${g.accountId}/credit`,
      headers: { authorization: "Bearer wrong-secret" },
      payload: { amount: 10 },
    });
    expect(res.statusCode).toBe(401);
  });
});
