import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest, createTestApp, hasTestDb, truncateAll, type TestApp } from "./helpers/testApp.js";

describe.skipIf(!hasTestDb)("Character routes (requires TEST_DATABASE_URL)", () => {
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

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }
  function create(token: string, name: string, classId = "bruiser") {
    return t.app.inject({ method: "POST", url: "/api/characters", headers: auth(token), payload: { name, classId } });
  }

  it("lists empty, creates, and returns total_xp=0", async () => {
    const g = await createGuest(t.app);
    const empty = await t.app.inject({ method: "GET", url: "/api/characters", headers: auth(g.accessToken) });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().characters).toHaveLength(0);

    const made = await create(g.accessToken, "Grok", "bruiser");
    expect(made.statusCode).toBe(201);

    const list = await t.app.inject({ method: "GET", url: "/api/characters", headers: auth(g.accessToken) });
    expect(list.json().characters).toHaveLength(1);
    expect(list.json().characters[0]).toMatchObject({ name: "Grok", class_id: "bruiser", total_xp: 0 });
    // GET one also carries total_xp for the level display.
    const one = await t.app.inject({
      method: "GET",
      url: `/api/characters/${list.json().characters[0].id}`,
      headers: auth(g.accessToken),
    });
    expect(one.json().character.total_xp).toBe(0);
  });

  it("enforces the 5-character limit and frees a slot on delete", async () => {
    const g = await createGuest(t.app);
    for (let i = 0; i < 5; i++) expect((await create(g.accessToken, `Hero${i}`)).statusCode).toBe(201);
    expect((await create(g.accessToken, "Sixth")).statusCode).toBe(409); // limit reached

    const list = await t.app.inject({ method: "GET", url: "/api/characters", headers: auth(g.accessToken) });
    const victimId = list.json().characters[0].id as string;

    const del = await t.app.inject({ method: "DELETE", url: `/api/characters/${victimId}`, headers: auth(g.accessToken) });
    expect(del.statusCode).toBe(204);

    const after = await t.app.inject({ method: "GET", url: "/api/characters", headers: auth(g.accessToken) });
    expect(after.json().characters).toHaveLength(4);
    expect(after.json().characters.some((c: { id: string }) => c.id === victimId)).toBe(false);
    // Slot freed: a new create now succeeds again.
    expect((await create(g.accessToken, "Replacement")).statusCode).toBe(201);
  });

  it("isolates characters per account and refuses cross-account delete", async () => {
    const a = await createGuest(t.app);
    const b = await createGuest(t.app);
    const made = await create(a.accessToken, "AliceChar");
    const aCharId = made.json().character.id as string;

    // B cannot see or delete A's character.
    const bList = await t.app.inject({ method: "GET", url: "/api/characters", headers: auth(b.accessToken) });
    expect(bList.json().characters).toHaveLength(0);
    const bDel = await t.app.inject({ method: "DELETE", url: `/api/characters/${aCharId}`, headers: auth(b.accessToken) });
    expect(bDel.statusCode).toBe(404);

    // A's character is untouched.
    const aList = await t.app.inject({ method: "GET", url: "/api/characters", headers: auth(a.accessToken) });
    expect(aList.json().characters).toHaveLength(1);
  });

  it("deleting an already-deleted / unknown character is 404", async () => {
    const g = await createGuest(t.app);
    const made = await create(g.accessToken, "Ephemeral");
    const id = made.json().character.id as string;
    expect((await t.app.inject({ method: "DELETE", url: `/api/characters/${id}`, headers: auth(g.accessToken) })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "DELETE", url: `/api/characters/${id}`, headers: auth(g.accessToken) })).statusCode).toBe(404);
  });
});
