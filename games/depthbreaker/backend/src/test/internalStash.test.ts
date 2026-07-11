import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest, createTestApp, hasTestDb, truncateAll, type TestApp } from "./helpers/testApp.js";

describe.skipIf(!hasTestDb)("Internal stash routes (requires TEST_DATABASE_URL)", () => {
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
  function deposit(accountId: string, itemId: string, count: number) {
    return t.app.inject({ method: "POST", url: `/internal/stash/${accountId}/deposit`, headers: zone(), payload: { itemId, count } });
  }
  function withdraw(accountId: string, itemId: string, count: number) {
    return t.app.inject({ method: "POST", url: `/internal/stash/${accountId}/withdraw`, headers: zone(), payload: { itemId, count } });
  }
  function list(accountId: string) {
    return t.app.inject({ method: "GET", url: `/internal/stash/${accountId}`, headers: zone() });
  }

  it("deposits stack and withdraws down to deletion", async () => {
    const g = await createGuest(t.app);
    expect((await deposit(g.accountId, "iron_ore", 5)).statusCode).toBe(200);
    expect((await deposit(g.accountId, "iron_ore", 3)).statusCode).toBe(200);
    expect((await list(g.accountId)).json().items).toEqual([{ itemId: "iron_ore", count: 8 }]);

    expect((await withdraw(g.accountId, "iron_ore", 6)).statusCode).toBe(200);
    expect((await list(g.accountId)).json().items).toEqual([{ itemId: "iron_ore", count: 2 }]);
    expect((await withdraw(g.accountId, "iron_ore", 2)).statusCode).toBe(200);
    expect((await list(g.accountId)).json().items).toEqual([]);
  });

  it("enforces the slot cap and the per-stack cap", async () => {
    const g = await createGuest(t.app);
    for (let i = 0; i < 24; i++) expect((await deposit(g.accountId, `item_${i}`, 1)).statusCode).toBe(200);
    const overflow = await deposit(g.accountId, "one_more", 1);
    expect(overflow.statusCode).toBe(409);
    expect(overflow.json().error).toBe("stash_full");
    // Topping up an EXISTING stack still works at the slot cap...
    expect((await deposit(g.accountId, "item_0", 500)).statusCode).toBe(200);
    // ...but never past 999 per stack.
    const stackFull = await deposit(g.accountId, "item_0", 999);
    expect(stackFull.statusCode).toBe(409);
    expect(stackFull.json().error).toBe("stack_full");
  });

  it("rejects over-withdrawal and unknown items/accounts", async () => {
    const g = await createGuest(t.app);
    await deposit(g.accountId, "crystal_shard", 2);
    expect((await withdraw(g.accountId, "crystal_shard", 3)).statusCode).toBe(409);
    expect((await withdraw(g.accountId, "never_deposited", 1)).statusCode).toBe(404);
    const ghost = "00000000-0000-0000-0000-000000000000";
    expect((await list(ghost)).statusCode).toBe(404);
    expect((await deposit(ghost, "iron_ore", 1)).statusCode).toBe(404);
  });

  it("isolates stashes per account", async () => {
    const a = await createGuest(t.app);
    const b = await createGuest(t.app);
    await deposit(a.accountId, "iron_ore", 9);
    expect((await list(b.accountId)).json().items).toEqual([]);
    expect((await withdraw(b.accountId, "iron_ore", 1)).statusCode).toBe(404);
    expect((await list(a.accountId)).json().items).toEqual([{ itemId: "iron_ore", count: 9 }]);
  });
});
