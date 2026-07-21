import { useMemo } from "react";
import { buildDungeon } from "@depthbreaker/protocol";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { useZoneState } from "../../net/useZone";

// A single dark-stone floor generated once as a CanvasTexture (no image files,
// matching world-of-claudecraft's procedural-texture convention). Tiled across
// a large plane that underlies the whole seeded dungeon so the room/corridor
// tiles sit on continuous ground instead of floating over black void.
let sharedGroundTexture: CanvasTexture | null = null;

function groundTexture(): CanvasTexture {
  if (sharedGroundTexture) return sharedGroundTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Base dark stone.
  ctx.fillStyle = "#22242a";
  ctx.fillRect(0, 0, size, size);

  // Mottled noise for grain (deterministic-ish; purely cosmetic).
  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    data[i] = Math.max(0, Math.min(255, data[i]! + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1]! + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2]! + n * 0.8));
  }
  ctx.putImageData(img, 0, 0);

  // A few darker cracks so tiling reads as flagstones, not flat noise.
  ctx.strokeStyle = "rgba(10,11,14,0.55)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * size, Math.random() * size);
    for (let s = 0; s < 3; s++) ctx.lineTo(Math.random() * size, Math.random() * size);
    ctx.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  sharedGroundTexture = texture;
  return texture;
}

const TILE_WORLD_PERIOD = 2.5; // world units per texture repeat

export function DungeonGround() {
  const snap = useZoneState();

  const { centerX, centerZ, size } = useMemo(() => {
    const dungeon = buildDungeon(snap.seed, snap.depth);
    const minX = Math.min(...dungeon.walkable.map((r) => r.minX));
    const maxX = Math.max(...dungeon.walkable.map((r) => r.maxX));
    const minZ = Math.min(...dungeon.walkable.map((r) => r.minZ));
    const maxZ = Math.max(...dungeon.walkable.map((r) => r.maxZ));
    const margin = 60; // extend well past the rooms so the edge dissolves into fog
    const span = Math.max(maxX - minX, maxZ - minZ) + margin * 2;
    return { centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2, size: span };
  }, [snap.seed, snap.depth]);

  const texture = useMemo(() => {
    const tex = groundTexture();
    // Clone the shared texture so each map's repeat can differ without mutating
    // the others.
    const clone = tex.clone();
    clone.wrapS = RepeatWrapping;
    clone.wrapT = RepeatWrapping;
    clone.needsUpdate = true;
    clone.repeat.set(size / TILE_WORLD_PERIOD, size / TILE_WORLD_PERIOD);
    return clone;
  }, [size]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, -0.08, centerZ]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={texture} color="#3a3d45" roughness={0.96} metalness={0} />
    </mesh>
  );
}
