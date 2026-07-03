import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest, createTestApp, hasTestDb, truncateAll, type TestApp } from "./helpers/testApp.js";

describe.skipIf(!hasTestDb)("Auth flow (requires TEST_DATABASE_URL)", () => {
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

  it("guest account works end-to-end: create -> authorized request", async () => {
    const guest = await createGuest(t.app);
    const meta = await t.app.inject({
      method: "GET",
      url: "/api/meta",
      headers: { authorization: `Bearer ${guest.accessToken}` },
    });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().currency).toBe(0);
    expect(meta.json().upgrades.length).toBeGreaterThanOrEqual(5);
  });

  it("rejects requests without or with garbage tokens", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/meta" })).statusCode).toBe(401);
    const bad = await t.app.inject({
      method: "GET",
      url: "/api/meta",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("rotates refresh tokens and revokes the family on replay", async () => {
    const guest = await createGuest(t.app);

    const first = await t.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { db_refresh: guest.refreshCookie },
    });
    expect(first.statusCode).toBe(200);
    const rotatedCookie = first.cookies.find((c) => c.name === "db_refresh")!.value;
    expect(rotatedCookie).not.toBe(guest.refreshCookie);

    // Replaying the ORIGINAL (already-rotated) token must fail AND poison the family.
    const replay = await t.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { db_refresh: guest.refreshCookie },
    });
    expect(replay.statusCode).toBe(401);

    const afterPoison = await t.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { db_refresh: rotatedCookie },
    });
    expect(afterPoison.statusCode).toBe(401);
  });

  it("logout revokes the refresh family", async () => {
    const guest = await createGuest(t.app);
    const out = await t.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { db_refresh: guest.refreshCookie },
    });
    expect(out.statusCode).toBe(204);
    const refresh = await t.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { db_refresh: guest.refreshCookie },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it("upgrades a guest to an email account in place, keeping the account id", async () => {
    const guest = await createGuest(t.app);
    const register = await t.app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { authorization: `Bearer ${guest.accessToken}` },
      payload: { email: "player@example.com", password: "hunter2hunter2" },
    });
    expect(register.statusCode).toBe(201);
    expect(register.json().accountId).toBe(guest.accountId);

    const login = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "player@example.com", password: "hunter2hunter2" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().accountId).toBe(guest.accountId);

    const badLogin = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "player@example.com", password: "wrong-password" },
    });
    expect(badLogin.statusCode).toBe(401);
  });

  it("rejects duplicate email registration", async () => {
    await t.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "dupe@example.com", password: "hunter2hunter2" },
    });
    const second = await t.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "DUPE@example.com", password: "hunter2hunter2" },
    });
    expect(second.statusCode).toBe(409);
  });
});
