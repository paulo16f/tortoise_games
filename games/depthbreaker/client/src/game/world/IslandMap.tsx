// The official hand-built island: one GLB exported from the Unity scene
// (map1.glb). The FBX→Blender→glTF chain RE-CENTRES the geometry to the origin
// AND mirrors the X axis (Unity is left-handed, glTF right-handed), so the raw
// GLB does NOT sit at the Unity world coordinates the walkable grid + markers
// use — the player would stand on the grid position while the matching floor is
// drawn tens of units away ("walking on air"). We fix it at load time by reading
// two marker empties baked into the GLB (Spawn_Town + Boss_Area1), comparing them
// to their known world coords, and solving the axis sign + offset. The transform
// is applied to a WRAPPER group (never mutating the useGLTF-cached scene, which
// would double-apply across hot reloads). Self-correcting across re-exports.

import { useEffect, useMemo, useState } from "react";
import { useGLTF, useTexture } from "@react-three/drei";
import { DoubleSide, FrontSide, SRGBColorSpace, Vector3, type Mesh, type MeshStandardMaterial } from "three";
import { buildDungeon, groundHeightAt } from "@depthbreaker/protocol";

const MAP_URL = "/models/map/map1.glb";
// The FBX→glTF chain dropped the base-colour link on a few Synty materials
// (the dwarven walls/pillars + the big HighLevelFloor render flat white/grey).
// We re-attach the source atlas by material name — the UVs are intact, so the
// texture maps correctly. Dwarven atlas is loaded here; the floor reuses the
// "Environment" atlas that IS embedded in the GLB.
const DWARF_ATLAS_URL = "/models/map/textures/Dungeons_2_Texture_01_A.png";

interface Align {
  scale: [number, number, number];
  position: [number, number, number];
  flipped: boolean;
}

export function IslandMap() {
  const { scene } = useGLTF(MAP_URL);
  const dwarfAtlas = useTexture(DWARF_ATLAS_URL);
  const [align, setAlign] = useState<Align | null>(null);

  // Solve the GLB→world transform from marker empties baked into the GLB, and
  // AVERAGE the offset over several so no single one skews it. CRITICAL: every
  // anchor's `world` must be the RAW marker position (playerSpawn/bossPortal/zone
  // centres are markers). Do NOT use d.marketStall/cookingStation here — those are
  // snapped to the CABIN meshes (~11u off the Stall_Market marker) and would shift
  // the whole visual map ~1–2u ("colliders sit right of the objects").
  const solved = useMemo<Align | null>(() => {
    const d = buildDungeon(1, 0);
    const roomCenter = (id: string) => {
      const r = d.rooms.find((rm) => rm.id === id)?.rect;
      return r ? { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 } : null;
    };
    const anchorDefs: { world: { x: number; z: number } | null; glb: string }[] = [
      { world: d.playerSpawn, glb: "Spawn_Town" },
      { world: d.bossPortal, glb: "Boss_Area1" },
      { world: roomCenter("normal"), glb: "Zone_Area1" },
      { world: roomCenter("elite"), glb: "Zone_Area2" },
      { world: roomCenter("boss"), glb: "Zone_Area3" },
    ];
    const anchors = anchorDefs
      .map((a) => {
        const o = a.world ? scene.getObjectByName(a.glb) : null;
        return o && a.world ? { world: a.world, glb: o.getWorldPosition(new Vector3()) } : null;
      })
      .filter((a): a is { world: { x: number; z: number }; glb: Vector3 } => a !== null);
    if (anchors.length < 2) {
      if (typeof console !== "undefined") console.warn("[IslandMap] <2 GLB alignment markers found — map will be offset", anchors.length);
      return null;
    }
    // Axis sign from the two most separated anchors (robust); offset averaged.
    let best = { d: -1, i: 0, j: 1 };
    for (let i = 0; i < anchors.length; i++)
      for (let j = i + 1; j < anchors.length; j++) {
        const dd = Math.hypot(anchors[i]!.glb.x - anchors[j]!.glb.x, anchors[i]!.glb.z - anchors[j]!.glb.z);
        if (dd > best.d) best = { d: dd, i, j };
      }
    const A = anchors[best.i]!, B = anchors[best.j]!;
    const sign = (dw: number, dg: number) => (Math.abs(dg) > 0.01 ? Math.sign(dw / dg) : 1);
    const sx = sign(B.world.x - A.world.x, B.glb.x - A.glb.x);
    const sz = sign(B.world.z - A.world.z, B.glb.z - A.glb.z);
    let tx = 0, tz = 0;
    for (const a of anchors) {
      tx += a.world.x - sx * a.glb.x;
      tz += a.world.z - sz * a.glb.z;
    }
    tx /= anchors.length; tz /= anchors.length;
    // Y comes from the SPAWN anchor only: its empty sits on the floor, so its
    // grid height ≈ its marker height. Other markers are authored at arbitrary
    // heights, so averaging Y would tilt the whole map off the ground.
    const spawnA = anchors.find((a) => a.world === d.playerSpawn) ?? anchors[0]!;
    const ty = groundHeightAt(spawnA.world.x, spawnA.world.z, d) - spawnA.glb.y;
    if (typeof console !== "undefined") console.info("[IslandMap] aligned GLB→world", { anchors: anchors.length, scale: [sx, 1, sz], position: [tx, ty, tz] });
    return { scale: [sx, 1, sz], position: [tx, ty, tz], flipped: sx * sz < 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  useEffect(() => setAlign(solved), [solved]);

  // Force front-side (double-side when a mirror flipped winding) + shadows, and
  // re-attach the dropped base-colour atlases so the map isn't flat white.
  useEffect(() => {
    const flipped = solved?.flipped ?? false;
    // Match the glTF texture convention (top-left origin) so the atlas UVs line up.
    dwarfAtlas.flipY = false;
    dwarfAtlas.colorSpace = SRGBColorSpace;
    dwarfAtlas.needsUpdate = true;

    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.receiveShadow = true;
      m.castShadow = false; // terrain doesn't self-shadow; cheaper
      const mat = m.material;
      if (!mat || Array.isArray(mat)) return;
      const sm = mat as MeshStandardMaterial;
      sm.side = flipped ? DoubleSide : FrontSide;
      // The Synty "Environment" atlas (grass/floors/paths/fences) is a very
      // saturated flat green that reads as neon under bright fill. Multiply it
      // down to a natural, slightly-desaturated tone and raise roughness so it
      // sits like ground, not plastic. (It keeps its texture — colour multiplies.)
      if (sm.name === "Environment") {
        sm.color?.setRGB(0.72, 0.78, 0.6);
        sm.roughness = Math.max(sm.roughness ?? 1, 0.95);
        sm.needsUpdate = true;
      }
      if (!sm.map) {
        // Re-link the atlas the FBX chain dropped, by material name. The dwarven
        // walls/pillars UV-map into the dungeon atlas, so it reads correctly.
        if (/PolygonDungeonRealms/i.test(sm.name)) {
          sm.map = dwarfAtlas;
          sm.color?.setRGB(1, 1, 1);
          sm.needsUpdate = true;
        } else if (sm.name === "Lit") {
          // HighLevelFloor's UVs DON'T match the Environment atlas (→ stripes), and
          // its real atlas didn't survive the export. Flat stone tint = never stripes.
          sm.map = null;
          sm.color?.setRGB(0.55, 0.52, 0.47);
          sm.roughness = 0.95;
          sm.needsUpdate = true;
        }
      }
    });
  }, [scene, solved, dwarfAtlas]);

  const a = align ?? { scale: [1, 1, 1] as [number, number, number], position: [0, 0, 0] as [number, number, number] };

  return (
    <group>
      {/* Wrapper carries the GLB→world alignment (see file header). */}
      <group scale={a.scale} position={a.position}>
        <primitive object={scene} />
      </group>
      {/* A single soft global fill to complement Scene's player-following SunLight
          across the large island — deliberately gentle (was a 0.85 ambient + 1.4
          directional on TOP of Scene's rig, which washed everything flat/neon). */}
      <ambientLight intensity={0.32} color="#c6d2e0" />
      <directionalLight position={[60, 120, 40]} intensity={0.7} color="#ffe9c8" />
    </group>
  );
}

useGLTF.preload(MAP_URL);
