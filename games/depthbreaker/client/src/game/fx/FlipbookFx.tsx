// Flipbook VFX — textured sprite-sheet animations (the "real effects" layer).
// Sheets come from Higgsfield clips rendered on PURE BLACK and converted by
// tools/video_to_flipbook.mjs; additive blending makes black transparent, so
// no alpha work is ever needed. Pooled planes play the grid UVs over their
// lifetime; billboard mode for impact/cast bursts, flat mode for ground FX.
// Spawned from the SAME trigger sites as the procedural effects (SkillGroundFx
// / ImpactFx call spawnFlipbook when a spec carries a `sheet`), so dedup and
// anchoring logic is never duplicated.

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Mesh, MeshBasicMaterial, Texture } from "three";
import { AdditiveBlending, DoubleSide, TextureLoader, RepeatWrapping } from "three";
import type { SheetSpec } from "./skillVfx";

const POOL = 12;

interface Slot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  bornAt: number;
  spec: SheetSpec | null;
  texture: Texture | null;
  flat: boolean;
}

const slots: Slot[] = Array.from({ length: POOL }, () => ({ active: false, x: 0, y: 0, z: 0, bornAt: 0, spec: null, texture: null, flat: false }));
let cursor = 0;

const loader = new TextureLoader();
const textureCache = new Map<string, Texture>();

function sheetTexture(url: string): Texture {
  let tex = textureCache.get(url);
  if (!tex) {
    tex = loader.load(url);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    textureCache.set(url, tex);
  }
  return tex;
}

/** Play a sheet at a world position. `flat` lays it on the ground plane. */
export function spawnFlipbook(x: number, y: number, z: number, spec: SheetSpec, flat = false): void {
  const slot = slots.find((s) => !s.active) ?? slots[cursor];
  cursor = (cursor + 1) % POOL;
  slot.active = true;
  slot.x = x;
  slot.y = y;
  slot.z = z;
  slot.bornAt = performance.now();
  slot.spec = spec;
  // Clone so each active slot can own its UV offset independently.
  slot.texture = sheetTexture(spec.url).clone();
  slot.texture.needsUpdate = true;
  slot.flat = flat;
}

/** Pooled renderer — mount once in the Scene next to SkillGroundFx. */
export function FlipbookLayer() {
  const meshRefs = useRef<(Mesh | null)[]>([]);
  const { camera } = useThree();
  const indices = useMemo(() => Array.from({ length: POOL }, (_, i) => i), []);

  useFrame(() => {
    const now = performance.now();
    for (let i = 0; i < POOL; i++) {
      const slot = slots[i];
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      if (!slot.active || !slot.spec || !slot.texture) {
        mesh.visible = false;
        continue;
      }
      const { cols, rows, fps, size } = slot.spec;
      const frames = cols * rows;
      const frame = Math.floor(((now - slot.bornAt) / 1000) * fps);
      if (frame >= frames) {
        slot.active = false;
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(slot.x, slot.flat ? Math.max(0.07, slot.y) : slot.y, slot.z);
      const s = size ?? 2.2;
      mesh.scale.set(s, s, s);
      if (slot.flat) mesh.rotation.set(-Math.PI / 2, 0, 0);
      else mesh.quaternion.copy(camera.quaternion); // billboard
      const mat = mesh.material as MeshBasicMaterial;
      if (mat.map !== slot.texture) {
        mat.map = slot.texture;
        mat.needsUpdate = true;
      }
      slot.texture.repeat.set(1 / cols, 1 / rows);
      slot.texture.offset.set((frame % cols) / cols, 1 - 1 / rows - Math.floor(frame / cols) / rows);
    }
  });

  return (
    <group>
      {indices.map((i) => (
        <mesh key={i} ref={(m) => (meshRefs.current[i] = m)} visible={false} frustumCulled={false}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial transparent blending={AdditiveBlending} depthWrite={false} side={DoubleSide} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
