import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dailyQuestsFor, dateKeyUTC } from "@depthbreaker/sim";
import { createGuest, createTestApp, hasTestDb, truncateAll, type TestApp } from "./helpers/testApp.js";

describe.skipIf(!hasTestDb)("Internal daily quest routes (requires TEST_DATABASE_URL)", () => {
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
  const todaysQuest = () => dailyQuestsFor(dateKeyUTC(new Date()))[0]!;

  function list(accountId: string) {
    return t.app.inject({ method: "GET", url: `/internal/dailies/${accountId}`, headers: zone() });
  }
  function progress(accountId: string, questId: string, delta: number) {
    return t.app.inject({ method: "POST", url: `/internal/dailies/${accountId}/progress`, headers: zone(), payload: { questId, delta } });
  }
  function claim(accountId: string, questId: string) {
    return t.app.inject({ method: "POST", url: `/internal/dailies/${accountId}/claim`, headers: zone(), payload: { questId } });
  }

  it("returns today's 3 quests with zero progress initially", async () => {
    const g = await createGuest(t.app);
    const res = await list(g.accountId);
    expect(res.statusCode).toBe(200);
    expect(res.json().quests).toHaveLength(3);
    expect(res.json().quests.every((q: { progress: number; claimed: boolean }) => q.progress === 0 && !q.claimed)).toBe(true);
  });

  it("caps progress at the target and cannot claim before completion", async () => {
    const g = await createGuest(t.app);
    const q = todaysQuest();
    expect((await progress(g.accountId, q.id, q.target - 1)).statusCode).toBe(200);
    expect((await claim(g.accountId, q.id)).statusCode).toBe(409); // not_complete
    // Over-report by a lot; progress must clamp to target, not exceed it.
    await progress(g.accountId, q.id, 999);
    const listed = (await list(g.accountId)).json().quests.find((x: { id: string }) => x.id === q.id);
    expect(listed.progress).toBe(q.target);
  });

  it("claims exactly once and credits the wallet by goldReward", async () => {
    const g = await createGuest(t.app);
    const q = todaysQuest();
    await progress(g.accountId, q.id, q.target);
    const first = await claim(g.accountId, q.id);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ balance: q.goldReward, gold: q.goldReward, xp: q.xpReward });

    const again = await claim(g.accountId, q.id);
    expect(again.statusCode).toBe(409); // already_claimed
    // Wallet only credited once.
    const meta = await t.app.inject({ method: "GET", url: "/api/meta", headers: { authorization: `Bearer ${g.accessToken}` } });
    expect(meta.json().currency).toBe(q.goldReward);
  });

  it("rejects progress/claim for a quest that is not active today", async () => {
    const g = await createGuest(t.app);
    expect((await progress(g.accountId, "definitely_not_a_quest", 1)).statusCode).toBe(404);
    expect((await claim(g.accountId, "definitely_not_a_quest")).statusCode).toBe(404);
  });
});
