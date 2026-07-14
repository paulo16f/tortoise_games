// Distil the raw Unity map export into a compact, typed TS module the shared
// @depthbreaker/protocol package imports. Re-run after every map re-export:
//   npm run sync:map
//
// Emits packages/protocol/src/officialMapData.ts with:
//   WALK_GRID   — per-cell walkability (raycast; only real blocks) + surface
//                 height, base64-packed (bitmask + uint8 height *4). Water/lava/
//                 gaps are excluded, and the player follows ramps/reliefs.
//   BOUND_RECTS — the floor-slab AABBs, used only for map bounds (minimap /
//                 click-plane sizing), NOT for walkability.
//   MAP_MARKERS — authored empties (Spawn/Zone/Boss/Node/Stall).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mapDir = resolve(root, "client/public/models/map");
const layout = JSON.parse(readFileSync(resolve(mapDir, "map1_layout.json"), "utf8"));
const grid = JSON.parse(readFileSync(resolve(mapDir, "map1_grid.json"), "utf8"));

// --- Bounding rects (floor slabs) — for map extent only ---
const isFloor = (name) => /Floor|Floo\b|Rock_Platform/i.test(name) && !/wall|door|cliff|lava/i.test(name);
const boundRects = layout.meshes
  .filter((m) => isFloor(m.name))
  .map((m) => ({
    minX: +(m.cx - m.sx / 2).toFixed(2),
    maxX: +(m.cx + m.sx / 2).toFixed(2),
    minZ: +(m.cz - m.sz / 2).toFixed(2),
    maxZ: +(m.cz + m.sz / 2).toFixed(2),
  }));

// --- Obstacle footprints — the player COLLIDES with these (footprint carved
// from walkability). ONLY solid, opening-free shapes go here (columns + compact
// buildings): a rectangular AABB fills the doorway of a wall and over-blocks an
// angled cliff, so WALLS and ROCKS are handled precisely per-cell by the Unity
// exporter's obstacle raycast instead (needs a re-export). Bridges/stairs are
// walkable. A small inset avoids nibbling the neighbouring floor. ---
// Solid columns/buildings (the exporter's per-cell capsule handles walls/rocks
// precisely) PLUS the rocks the exporter MISCLASSIFIES as floor: `Rock_Platform*`
// (has "platform") and grass-topped rock outcrops (has "grass") end up walkable
// with no collision — the huge north rock you walked through. Block their AABB.
const isObstacle = (name, top) =>
  top > 4 &&
  (/stone_pillar|dwarf_pillar|rubble_pillar|vegetablemarket|bakerymarket|weapon_market|blacksmith|dwarf_forge|smelter|anvil/i.test(name) ||
    /rock_platform|rock.*grassvariant|grassvariant.*rock/i.test(name)) &&
  !/floor|bridge|stair|path|alcove|wall/i.test(name);
const INSET = 0.35;
const blockRects = layout.meshes
  .filter((m) => isObstacle(m.name, m.cy + m.sy / 2))
  .map((m) => ({
    minX: +(m.cx - m.sx / 2 + INSET).toFixed(2),
    maxX: +(m.cx + m.sx / 2 - INSET).toFixed(2),
    minZ: +(m.cz - m.sz / 2 + INSET).toFixed(2),
    maxZ: +(m.cz + m.sz / 2 - INSET).toFixed(2),
  }))
  .filter((r) => r.maxX > r.minX && r.maxZ > r.minZ);

// --- Markers ---
const markers = {};
for (const mk of layout.markers) {
  if (/light|camera/i.test(mk.name)) continue;
  markers[mk.name] = { x: +mk.x.toFixed(2), z: +mk.z.toFixed(2) };
}

// --- Feature anchors (by MESH name) — the game's functional objects ARE the
// map's own buildings: market = weapon_market cabin, cooking = BakeryMarket
// cabin. We emit their footprint centre; the client hides its procedural model
// and puts the interaction there. (Fountain = the stone circle at Spawn_Town.) ---
const featureCentre = (re) => {
  const m = layout.meshes.find((mm) => re.test(mm.name));
  return m ? { x: +m.cx.toFixed(2), z: +m.cz.toFixed(2) } : null;
};
const features = {};
const market = featureCentre(/weapon_market/i);
const cooking = featureCentre(/bakerymarket/i);
if (market) features.market = market;
if (cooking) features.cooking = cooking;

// --- Lava hazard: the raycast hits a lava-BED floor (~1.5) under the plane, so
// those cells read walkable. Carve them out — but only the LOW cells (< 2.5),
// so a floor/bridge crossing above the lava stays walkable. ---
const lavaRects = layout.meshes
  .filter((m) => /lava/i.test(m.name))
  .map((m) => ({ minX: m.cx - m.sx / 2, maxX: m.cx + m.sx / 2, minZ: m.cz - m.sz / 2, maxZ: m.cz + m.sz / 2 }));
const inLava = (x, z) => lavaRects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
// The lava BED (raycast surface) sits at ~1.5, the lava plane at 1.8; real floor
// in the same region is 2.5+. Carve only cells at/below the lava (< 2.0) so the
// south floor inside the lava's big AABB is NOT removed.
const LAVA_MAX_Y = 2.0;

// --- Walkability + height grid → packed base64 ---
const cols = grid.cols, rows = grid.rows, n = cols * rows;
const walkStr = grid.walk;
const heightArr = grid.height.split(","); // "_" for non-walkable cells
const HEIGHT_Q = 4; // 0.25u resolution
// Walk bitmask: 1 bit per cell.
const bits = new Uint8Array(Math.ceil(n / 8));
// Height: uint8 = round(h * HEIGHT_Q), clamped. Non-walkable cells store 0.
const hbytes = new Uint8Array(n);
let walkCount = 0, lavaCarved = 0;
for (let i = 0; i < n; i++) {
  if (walkStr[i] === "1") {
    const h = parseFloat(heightArr[i]);
    const gx = i % cols, gz = (i - gx) / cols;
    const wx = grid.originX + gx * grid.cell, wz = grid.originZ + gz * grid.cell;
    if (Number.isFinite(h) && h < LAVA_MAX_Y && inLava(wx, wz)) { lavaCarved++; continue; } // walking on lava
    bits[i >> 3] |= 1 << (i & 7);
    hbytes[i] = Math.max(0, Math.min(255, Math.round((Number.isFinite(h) ? h : 0) * HEIGHT_Q)));
    walkCount++;
  }
}

// Fill pinprick pits: a non-walkable cell whose 4-neighbours are walkable at a
// near-equal height is a tile SEAM, not a real hole — it reads as an invisible
// wall in open floor. Flip it walkable (height = neighbour average). One pass;
// only fills cells fully enclosed by flat floor, so lava/void edges are safe.
const bitAt = (gx, gz) => (gx >= 0 && gx < cols && gz >= 0 && gz < rows) && (bits[(gz * cols + gx) >> 3] & (1 << ((gz * cols + gx) & 7))) !== 0;
let filled = 0;
for (let gz = 1; gz < rows - 1; gz++) {
  for (let gx = 1; gx < cols - 1; gx++) {
    const i = gz * cols + gx;
    if (bitAt(gx, gz)) continue;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => bitAt(gx + dx, gz + dz)).map(([dx, dz]) => hbytes[(gz + dz) * cols + (gx + dx)]);
    if (nb.length < 4) continue; // must be fully enclosed by floor
    if (Math.max(...nb) - Math.min(...nb) > 0.5 * HEIGHT_Q) continue; // neighbours must be ~level
    bits[i >> 3] |= 1 << (i & 7);
    hbytes[i] = Math.round(nb.reduce((a, b) => a + b, 0) / nb.length);
    walkCount++; filled++;
  }
}

// Safeguard: flood from the spawn over the walkable bitmask. A tiny reachable
// fraction means the collision walled the spawn in (e.g. a decorative ring of
// low fences) — fail LOUD at sync time instead of shipping a trapped map.
{
  const sm = markers["Spawn_Town"] ?? { x: 0, z: 0 };
  const sgx = Math.round((sm.x - grid.originX) / grid.cell), sgz = Math.round((sm.z - grid.originZ) / grid.cell);
  const bit = (gx, gz) => gx >= 0 && gx < cols && gz >= 0 && gz < rows && (bits[(gz * cols + gx) >> 3] & (1 << ((gz * cols + gx) & 7))) !== 0;
  const seen = new Set([sgz * cols + sgx]); const q = [[sgx, sgz]];
  for (let hd = 0; hd < q.length; hd++) {
    const [gx, gz] = q[hd];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx, nz = gz + dz, k = nz * cols + nx;
      if (seen.has(k) || !bit(nx, nz)) continue;
      seen.add(k); q.push([nx, nz]);
    }
  }
  const pct = Math.round((100 * seen.size) / walkCount);
  if (seen.size < walkCount * 0.5)
    console.warn(`\n⚠️  SPAWN TRAP: only ${seen.size}/${walkCount} (${pct}%) walkable cells reach the spawn — collision likely walled the plaza in (check the exporter capsule / low decor).\n`);
  else console.log(`spawn reaches ${seen.size}/${walkCount} (${pct}%) walkable cells — OK`);
}

// Bridge floor SEAMS: the decorative tile plazas are individual raised tiles
// with GAPS between them — the floor raycast misses the gaps, so they read as
// non-walkable = invisible walls across open ground. Fill a non-walkable cell
// when it is NOT under a real obstacle footprint AND is ringed by walkable floor
// at a near-equal height. Two dilation passes bridge 1–2 cell seams; real
// obstacles (inside a footprint) and the off-map void (few walkable neighbours)
// are left blocked.
const isObstacleName = (name) => {
  const n = name.toLowerCase();
  if (/floor|path|platform|bridge|stair|water|grass/.test(n)) return false;
  if (/lava/.test(n) && /plane/.test(n)) return false;
  return /wall|pillar|rock|cliff|balustrade|rubble|market|forge|smelter|anvil|fence|boulder|building|gate|duct|tree|birch|trunk|bramble|bush|crystal|well|statue|brazier|chest|barrel|crate|column|obelisk|lava/.test(n);
};
const obsFoot = layout.meshes.filter((m) => isObstacleName(m.name)).map((m) => ({ minX: m.cx - m.sx / 2 + 0.2, maxX: m.cx + m.sx / 2 - 0.2, minZ: m.cz - m.sz / 2 + 0.2, maxZ: m.cz + m.sz / 2 - 0.2 }));
const inObsFoot = (wx, wz) => obsFoot.some((r) => wx >= r.minX && wx <= r.maxX && wz >= r.minZ && wz <= r.maxZ);
// A cell is over a floor SLAB (walkable tile plaza) if inside a floor-mesh AABB.
const inFloorSlab = (wx, wz) => boundRects.some((r) => wx >= r.minX && wx <= r.maxX && wz >= r.minZ && wz <= r.maxZ);
const gbit = (gx, gz) => gx >= 0 && gx < cols && gz >= 0 && gz < rows && (bits[(gz * cols + gx) >> 3] & (1 << ((gz * cols + gx) & 7))) !== 0;
let seams = 0;
// Fill holes INSIDE floor slabs (the decorative tiles have gaps the raycast
// misses). Constrained to slab interiors so the off-map void is never grown;
// obstacle footprints stay blocked. Several passes close wide (5–7 cell) gaps
// from the edges inward.
for (let pass = 0; pass < 6; pass++) {
  const add = [];
  for (let gz = 1; gz < rows - 1; gz++) {
    for (let gx = 1; gx < cols - 1; gx++) {
      if (gbit(gx, gz)) continue;
      const wx = grid.originX + gx * grid.cell, wz = grid.originZ + gz * grid.cell;
      if (!inFloorSlab(wx, wz) || inObsFoot(wx, wz)) continue; // only slab interior, never obstacles
      const hs = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (gbit(gx + dx, gz + dz)) hs.push(hbytes[(gz + dz) * cols + (gx + dx)]);
      if (hs.length < 3) continue; // needs a floor ring around it
      if (Math.max(...hs) - Math.min(...hs) > 1.0 * HEIGHT_Q) continue; // roughly level (allows a tile step)
      add.push({ i: gz * cols + gx, h: Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) });
    }
  }
  if (!add.length) break;
  for (const { i, h } of add) { bits[i >> 3] |= 1 << (i & 7); hbytes[i] = h; walkCount++; seams++; }
}
if (seams) console.log(`bridged ${seams} floor-seam cells (tile-plaza gaps)`);

// Seal 1-cell gaps in obstacle rows: a walkable cell pinched between blocked
// cells on BOTH sides (left+right OR up+down) is a slit in a wall you can slip
// through when running along it. Block it. 2+ cell passages (real doorways) have
// no opposite-side block, so they stay open.
let sealed = 0;
{
  const close = [];
  for (let gz = 1; gz < rows - 1; gz++) {
    for (let gx = 1; gx < cols - 1; gx++) {
      if (!gbit(gx, gz)) continue;
      const wx = grid.originX + gx * grid.cell, wz = grid.originZ + gz * grid.cell;
      if (inFloorSlab(wx, wz) && !inObsFoot(wx, wz)) continue; // never seal open plaza floor
      const pinchH = !gbit(gx - 1, gz) && !gbit(gx + 1, gz);
      const pinchV = !gbit(gx, gz - 1) && !gbit(gx, gz + 1);
      if (pinchH || pinchV) close.push(gz * cols + gx);
    }
  }
  for (const i of close) { bits[i >> 3] &= ~(1 << (i & 7)); walkCount--; sealed++; }
}
if (sealed) console.log(`sealed ${sealed} 1-cell wall slits`);

const b64 = (u8) => Buffer.from(u8).toString("base64");

const out = `// AUTO-GENERATED by tools/build_official_map.mjs — do not edit by hand.
// Re-run \`npm run sync:map\` after re-exporting the map from games/map.
import type { Rect, Vec2 } from "./map.js";

/** Floor-slab AABBs — used only to compute the map's extent (minimap / click
 *  plane). Walkability comes from WALK_GRID, not these. */
export const BOUND_RECTS: readonly Rect[] = ${JSON.stringify(boundRects)};

/** Obstacle footprints (walls, pillars, buildings, railings) subtracted from
 *  walkability — the player collides with these instead of walking through. */
export const BLOCK_RECTS: readonly Rect[] = ${JSON.stringify(blockRects)};

/** Authored scene markers (spawn, zones, bosses, node anchors, stall). */
export const MAP_MARKERS: Readonly<Record<string, Vec2>> = ${JSON.stringify(markers)};

/** Feature anchors keyed off the map's own building meshes — the functional
 *  market/cooking objects sit on these (client hides its procedural model). */
export const MAP_FEATURES: Readonly<Record<string, Vec2>> = ${JSON.stringify(features)};

/** Raycast walkability + surface height. \`bits\` is a 1-bit-per-cell walkable
 *  mask; \`height\` is uint8 = surfaceY * ${HEIGHT_Q} (0.25u steps) per walkable
 *  cell. Cell (gx,gz) → index gz*cols+gx; world x = originX + gx*cell. */
export const WALK_GRID = {
  originX: ${grid.originX},
  originZ: ${grid.originZ},
  cell: ${grid.cell},
  cols: ${cols},
  rows: ${rows},
  heightQ: ${HEIGHT_Q},
  bits: "${b64(bits)}",
  height: "${b64(hbytes)}",
} as const;
`;

writeFileSync(resolve(root, "packages/protocol/src/officialMapData.ts"), out);
console.log(`officialMapData.ts: ${boundRects.length} bound rects, ${blockRects.length} block rects, ${Object.keys(markers).length} markers, grid ${cols}x${rows} (${walkCount} walkable, ${lavaCarved} lava-carved, ${filled} seams filled)`);
