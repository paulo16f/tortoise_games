// @depthbreaker/sim Ã¢â‚¬â€ deterministic game math shared by the backend, the
// Colyseus realtime server, and the R3F client. One TypeScript source of
// truth (the old C#/TS cross-language mirroring is gone with the web stack).
// Bound to shared-spec/GAME_MATH_SPEC.md + shared-spec/vectors/*.json.

export * from "./rng.js";
export * from "./combatMath.js";
export * from "./combatTimeline.js";
export * from "./healing.js";
export * from "./xpCurve.js";
export * from "./threat.js";
export * from "./lootRoller.js";
export * from "./lootTables.js";
export * from "./items.js";
export * from "./inventory.js";
export * from "./dungeonGraph.js";
export * from "./plausibility.js";
export * from "./dailyQuests.js";
export * from "./skins.js";
export * from "./spinner.js";
export * from "./cooking.js";
export * from "./forge.js";
export * from "./depthScaling.js";
export * from "./tokenSplit.js";
