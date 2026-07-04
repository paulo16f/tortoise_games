// @depthbreaker/sim — deterministic game math shared by the backend, the
// Colyseus realtime server, and the R3F client. One TypeScript source of
// truth (the old C#/TS cross-language mirroring is gone with the web stack).
// Bound to shared-spec/GAME_MATH_SPEC.md + shared-spec/vectors/*.json.

export * from "./rng.js";
export * from "./combatMath.js";
export * from "./healing.js";
export * from "./xpCurve.js";
export * from "./threat.js";
export * from "./lootRoller.js";
export * from "./dungeonGraph.js";
export * from "./plausibility.js";
