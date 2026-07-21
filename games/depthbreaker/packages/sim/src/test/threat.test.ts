import { describe, expect, it } from "vitest";
import {
  DAMAGE_THREAT_PER_POINT,
  HEAL_THREAT_PER_POINT,
  MELEE_SWAP_THRESHOLD,
  RANGED_SWAP_THRESHOLD,
  ThreatTable,
} from "../threat.js";
import { loadVector } from "./helpers/vectors.js";

interface ThreatVectors {
  scenarios: {
    name: string;
    melee: string[];
    events: {
      op: "damage" | "heal" | "select";
      id?: string;
      amount?: number;
      current?: string | null;
      expectedTarget?: string | null;
    }[];
  }[];
}

const vectors = loadVector<ThreatVectors>("threat.json");

describe("Threat table (GAME_MATH_SPEC §4)", () => {
  it("replays all frozen scenarios", () => {
    for (const scenario of vectors.scenarios) {
      const table = new ThreatTable();
      const inMelee = (id: string) => scenario.melee.includes(id);
      for (const e of scenario.events) {
        if (e.op === "damage") table.addDamage(e.id!, e.amount!);
        else if (e.op === "heal") table.addHeal(e.id!, e.amount!);
        else {
          expect(
            table.selectTarget(e.current ?? null, inMelee),
            `${scenario.name}: select(current=${e.current})`,
          ).toBe(e.expectedTarget);
        }
      }
    }
  });

  it("uses 1.0 damage / 0.5 heal coefficients", () => {
    const table = new ThreatTable();
    table.addDamage("a", 80);
    table.addHeal("b", 80);
    expect(table.getThreat("a")).toBe(80 * DAMAGE_THREAT_PER_POINT);
    expect(table.getThreat("b")).toBe(80 * HEAL_THREAT_PER_POINT);
  });

  it("swap thresholds are exactly 110% melee / 130% ranged (boundary inclusive)", () => {
    const table = new ThreatTable();
    table.addDamage("current", 100);
    table.addDamage("melee", 100 * MELEE_SWAP_THRESHOLD);
    expect(table.selectTarget("current", (id) => id === "melee")).toBe("melee");

    const t2 = new ThreatTable();
    t2.addDamage("current", 100);
    t2.addDamage("ranged", 100 * RANGED_SWAP_THRESHOLD - 0.01);
    expect(t2.selectTarget("current", () => false)).toBe("current");
  });

  it("handles empty table, unknown current, removal and wipe", () => {
    const table = new ThreatTable();
    expect(table.selectTarget(null, () => true)).toBeNull();
    table.addDamage("a", 10);
    expect(table.selectTarget("ghost", () => true)).toBe("a");
    table.remove("a");
    expect(table.selectTarget("a", () => true)).toBeNull();
    table.addDamage("x", 5);
    table.clear();
    expect(table.size).toBe(0);
  });

  it("breaks threat ties by ascending entity id", () => {
    const table = new ThreatTable();
    table.addDamage("zed", 100);
    table.addDamage("abe", 100);
    expect(table.selectTarget(null, () => true)).toBe("abe");
  });

  it("forceTarget (taunt) pulls aggro past any swap threshold", () => {
    const table = new ThreatTable();
    table.addDamage("dps", 1000); // a raging damage dealer holds aggro
    table.addDamage("tank", 10);
    expect(table.selectTarget(null, () => true)).toBe("dps");
    table.forceTarget("tank");
    // Tank is now clear top; ranged threshold (the hardest to clear) still swaps.
    expect(table.getThreat("tank")).toBeGreaterThan(table.getThreat("dps") * RANGED_SWAP_THRESHOLD);
    expect(table.selectTarget("dps", () => false)).toBe("tank");
  });

  it("forceTarget wins even from an empty table", () => {
    const table = new ThreatTable();
    table.forceTarget("tank");
    expect(table.getThreat("tank")).toBeGreaterThan(0);
    expect(table.selectTarget(null, () => true)).toBe("tank");
  });
});
