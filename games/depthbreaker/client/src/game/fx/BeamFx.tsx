// Pooled caster→target beams (drain_life's soul siphon). A stretched additive
// cylinder re-oriented each frame between the two entities' torsos, fading over
// its short life. Same React-free pooled pattern as Projectiles/Telegraphs.

import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh, MeshBasicMaterial } from "three";
import { AdditiveBlending, Vector3, Quaternion } from "three";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";

const POOL = 4;
const BEAM_LIFE_MS = 450;
/** skillId → beam colour; only these skills draw a beam. */
const BEAM_SKILLS: Record<string, string> = { drain_life: "#a855f7" };

interface Beam {
  active: boolean;
  sourceId: string;
  targetId: string;
  color: string;
  bornAt: number;
}

const beams: Beam[] = Array.from({ length: POOL }, () => ({ active: false, sourceId: "", targetId: "", color: "#fff", bornAt: 0 }));
let cursor = 0;

const UP = new Vector3(0, 1, 0);
const from = new Vector3();
const to = new Vector3();
const mid = new Vector3();
const dir = new Vector3();
const quat = new Quaternion();

function anchor(id: string, out: Vector3): boolean {
  const st = zoneStore.state;
  const e = st?.enemies.get(id) ?? st?.players.get(id);
  if (!e || !e.alive) return false;
  out.set(e.x, e.y + 1.0, e.z);
  return true;
}

export function BeamFx() {
  const meshes = useRef<(Mesh | null)[]>(Array(POOL).fill(null));
  const slots = useMemo(() => Array.from({ length: POOL }, (_, i) => i), []);

  useEffect(
    () =>
      combatBus.subscribe((f) => {
        if (f.kind !== "skill") return;
        const color = BEAM_SKILLS[f.skillId];
        if (!color || !f.sourceId || !f.targetId) return;
        const b = beams[cursor];
        cursor = (cursor + 1) % POOL;
        b.active = true;
        b.sourceId = f.sourceId;
        b.targetId = f.targetId;
        b.color = color;
        b.bornAt = performance.now() + f.delayMs;
      }),
    [],
  );

  useFrame(() => {
    const now = performance.now();
    for (let i = 0; i < POOL; i++) {
      const b = beams[i];
      const mesh = meshes.current[i];
      if (!mesh) continue;
      const age = now - b.bornAt;
      if (!b.active || age < 0 || age > BEAM_LIFE_MS || !anchor(b.sourceId, from) || !anchor(b.targetId, to)) {
        if (age > BEAM_LIFE_MS) b.active = false;
        if (mesh.visible) mesh.visible = false;
        continue;
      }
      const t = age / BEAM_LIFE_MS;
      mid.addVectors(from, to).multiplyScalar(0.5);
      dir.subVectors(to, from);
      const len = dir.length();
      if (len < 0.01) {
        mesh.visible = false;
        continue;
      }
      quat.setFromUnitVectors(UP, dir.normalize());
      mesh.visible = true;
      mesh.position.copy(mid);
      mesh.quaternion.copy(quat);
      // Cylinder geometry is unit-height along Y; squeeze as it fades.
      mesh.scale.set(0.09 * (1 - t * 0.5), len, 0.09 * (1 - t * 0.5));
      const mat = mesh.material as MeshBasicMaterial;
      mat.color.set(b.color);
      mat.opacity = 0.75 * (1 - t);
    }
  });

  return (
    <>
      {slots.map((i) => (
        <mesh key={i} visible={false} ref={(m) => { meshes.current[i] = m; }}>
          <cylinderGeometry args={[1, 1, 1, 6, 1, true]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} blending={AdditiveBlending} />
        </mesh>
      ))}
    </>
  );
}
