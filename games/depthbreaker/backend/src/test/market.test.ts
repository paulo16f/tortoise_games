import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest, createTestApp, hasTestDb, truncateAll, type TestApp } from "./helpers/testApp.js";

describe.skipIf(!hasTestDb)("P2P marketplace (requires TEST_DATABASE_URL)", () => {
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
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  // Zone-side helpers to set up preconditions the game normally produces.
  const stashDeposit = (accountId: string, itemId: string, count: number) =>
    t.app.inject({ method: "POST", url: `/internal/stash/${accountId}/deposit`, headers: zone(), payload: { itemId, count } });
  const credit = (accountId: string, amount: number) =>
    t.app.inject({ method: "POST", url: `/internal/wallet/${accountId}/credit`, headers: zone(), payload: { amount } });
  const walletBalance = async (accountId: string) =>
    (await t.app.inject({ method: "GET", url: `/internal/wallet/${accountId}`, headers: zone() })).json().balance;
  const stashOf = async (accountId: string) =>
    (await t.app.inject({ method: "GET", url: `/internal/stash/${accountId}`, headers: zone() })).json().items;

  const list = (token: string, itemId: string, count: number, price: number) =>
    t.app.inject({ method: "POST", url: "/api/market/list", headers: auth(token), payload: { itemId, count, price } });
  const browse = (token: string) => t.app.inject({ method: "GET", url: "/api/market/listings", headers: auth(token) });
  const buy = (token: string, listingId: string) =>
    t.app.inject({ method: "POST", url: "/api/market/buy", headers: auth(token), payload: { listingId } });
  const cancel = (token: string, listingId: string) =>
    t.app.inject({ method: "POST", url: "/api/market/cancel", headers: auth(token), payload: { listingId } });

  it("listing escrows items out of the seller's stash and appears in browse", async () => {
    const seller = await createGuest(t.app);
    await stashDeposit(seller.accountId, "iron_ore", 5);
    const res = await list(seller.accessToken, "iron_ore", 5, 100);
    expect(res.statusCode).toBe(201);

    expect(await stashOf(seller.accountId)).toEqual([]); // escrowed out
    const listings = (await browse(seller.accessToken)).json().listings;
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({ itemId: "iron_ore", count: 5, price: 100, status: "open", mine: true });
  });

  it("refuses to list items the seller does not have in stash", async () => {
    const seller = await createGuest(t.app);
    await stashDeposit(seller.accountId, "iron_ore", 2);
    expect((await list(seller.accessToken, "iron_ore", 5, 100)).statusCode).toBe(409); // not_in_stash
    expect((await list(seller.accessToken, "crystal_shard", 1, 100)).statusCode).toBe(409);
    expect((await list(seller.accessToken, "not_an_item", 1, 100)).statusCode).toBe(404);
  });

  it("buy settles gold buyer->seller and items into the buyer's stash atomically", async () => {
    const seller = await createGuest(t.app);
    const buyer = await createGuest(t.app);
    await stashDeposit(seller.accountId, "crystal_shard", 3);
    await credit(buyer.accountId, 500);
    const listingId = (await list(seller.accessToken, "crystal_shard", 3, 180)).json().id;

    const res = await buy(buyer.accessToken, listingId);
    expect(res.statusCode).toBe(200);
    expect(res.json().balance).toBe(320); // 500 - 180

    expect(await walletBalance(seller.accountId)).toBe(180); // seller paid in full (gold listing, no fee)
    expect(await walletBalance(buyer.accountId)).toBe(320);
    expect(await stashOf(buyer.accountId)).toEqual([{ itemId: "crystal_shard", count: 3 }]);
    // Listing is closed and no longer browsable.
    expect((await browse(buyer.accessToken)).json().listings).toHaveLength(0);
    expect((await buy(buyer.accessToken, listingId)).statusCode).toBe(409); // not_open
  });

  it("rejects a buy the buyer cannot afford, changing nothing", async () => {
    const seller = await createGuest(t.app);
    const buyer = await createGuest(t.app);
    await stashDeposit(seller.accountId, "iron_ore", 1);
    await credit(buyer.accountId, 50);
    const listingId = (await list(seller.accessToken, "iron_ore", 1, 100)).json().id;

    const res = await buy(buyer.accessToken, listingId);
    expect(res.statusCode).toBe(402);
    expect(await walletBalance(buyer.accountId)).toBe(50); // unchanged
    expect(await walletBalance(seller.accountId)).toBe(0); // seller not paid
    expect(await stashOf(buyer.accountId)).toEqual([]); // no item moved
    expect((await browse(buyer.accessToken)).json().listings).toHaveLength(1); // still open
  });

  it("forbids buying your own listing", async () => {
    const seller = await createGuest(t.app);
    await stashDeposit(seller.accountId, "iron_ore", 1);
    await credit(seller.accountId, 1000);
    const listingId = (await list(seller.accessToken, "iron_ore", 1, 100)).json().id;
    expect((await buy(seller.accessToken, listingId)).statusCode).toBe(409); // own_listing
  });

  it("cancel returns escrowed items to the seller's stash; non-owners cannot cancel", async () => {
    const seller = await createGuest(t.app);
    const other = await createGuest(t.app);
    await stashDeposit(seller.accountId, "iron_ore", 4);
    const listingId = (await list(seller.accessToken, "iron_ore", 4, 60)).json().id;

    expect((await cancel(other.accessToken, listingId)).statusCode).toBe(404); // not your listing
    expect((await cancel(seller.accessToken, listingId)).statusCode).toBe(200);
    expect(await stashOf(seller.accountId)).toEqual([{ itemId: "iron_ore", count: 4 }]); // returned
    expect((await cancel(seller.accessToken, listingId)).statusCode).toBe(409); // not_open (already cancelled)
  });

  it("enforces the open-listing cap per account", async () => {
    const seller = await createGuest(t.app);
    await stashDeposit(seller.accountId, "iron_ore", 20);
    for (let i = 0; i < 8; i++) expect((await list(seller.accessToken, "iron_ore", 1, 10)).statusCode).toBe(201);
    expect((await list(seller.accessToken, "iron_ore", 1, 10)).statusCode).toBe(409); // listing_limit_reached
  });
});
