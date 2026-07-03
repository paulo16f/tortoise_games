import { describe, expect, it } from "vitest";
import { signJoinTicket, verifyJoinTicket } from "../auth/joinTicket.js";

const SECRET = "test-zone-secret";
const CLAIMS = {
  accountId: "acct-1",
  characterId: "char-1",
  runId: "run-1",
  seed: 3735928559,
};

describe("Join tickets (design doc §3)", () => {
  it("roundtrips claims", async () => {
    const ticket = await signJoinTicket(CLAIMS, SECRET, 60);
    expect(await verifyJoinTicket(ticket, SECRET)).toEqual(CLAIMS);
  });

  it("rejects the wrong secret", async () => {
    const ticket = await signJoinTicket(CLAIMS, SECRET, 60);
    expect(await verifyJoinTicket(ticket, "other-secret")).toBeNull();
  });

  it("rejects expired tickets", async () => {
    const ticket = await signJoinTicket(CLAIMS, SECRET, -1);
    expect(await verifyJoinTicket(ticket, SECRET)).toBeNull();
  });

  it("rejects tampered payloads", async () => {
    const ticket = await signJoinTicket(CLAIMS, SECRET, 60);
    const [header, payload, sig] = ticket.split(".");
    const forged = JSON.parse(Buffer.from(payload!, "base64url").toString());
    forged.seed = 1;
    const forgedPayload = Buffer.from(JSON.stringify(forged)).toString("base64url");
    expect(await verifyJoinTicket(`${header}.${forgedPayload}.${sig}`, SECRET)).toBeNull();
  });

  it("is a three-part compact JWT (zone server splits on dots)", async () => {
    const ticket = await signJoinTicket(CLAIMS, SECRET, 60);
    expect(ticket.split(".")).toHaveLength(3);
  });
});
