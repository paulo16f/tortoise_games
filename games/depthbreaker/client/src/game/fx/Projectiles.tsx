import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";
import { PROJECTILE_SPEED } from "./fxConstants";
import { spawnImpactBurst } from "./ImpactFx";

const POOL_SIZE = 8;
const HIT_RADIUS = 0.4;
const MAX_AGE_MS = 1800;
const BOLT_COLOR = "#a78bfa";

interface Bolt {
  active: boolean;
  x: number;
  y: number;
  z: number;
  targetId: string;
  actionId: string;
  bornAt: number;
}

export function Projectiles() {
  const bolts = useRef<Bolt[]>(Array.from({ length: POOL_SIZE }, () => ({ active: false, x: 0, y: 0, z: 0, targetId: "", actionId: "", bornAt: 0 })));
  const meshes = useRef<(Mesh | null)[]>(Array(POOL_SIZE).fill(null));
  const slots = useMemo(() => Array.from({ length: POOL_SIZE }, (_, i) => i), []);

  useEffect(
    () =>
      combatBus.subscribe((f) => {
        if (f.kind !== "skill" || f.amount !== 0) {
          if (f.actionId) {
            for (const bolt of bolts.current) {
              if (bolt.active && bolt.actionId === f.actionId) bolt.active = false;
            }
          }
          return;
        }
        if (f.delayMs <= 0) return;
        const source = zoneStore.state?.players.get(f.sourceId);
        if (!source) return;
        const bolt = bolts.current.find((b) => !b.active) ?? bolts.current.reduce((a, b) => (a.bornAt <= b.bornAt ? a : b));
        bolt.active = true;
        bolt.x = source.x;
        bolt.y = source.y + 1.2;
        bolt.z = source.z;
        bolt.targetId = f.targetId;
        bolt.actionId = f.actionId;
        bolt.bornAt = performance.now();
        // Muzzle flash at the caster.
        spawnImpactBurst(bolt.x, bolt.y, bolt.z, { count: 5, color: BOLT_COLOR, speed: 2, size: 0.1, life: 0.2, up: 0.6 });
      }),
    [],
  );

  useFrame((_, delta) => {
    const st = zoneStore.state;
    const now = performance.now();
    bolts.current.forEach((bolt, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      if (!bolt.active) {
        mesh.visible = false;
        return;
      }
      const target = st?.enemies.get(bolt.targetId) ?? st?.players.get(bolt.targetId);
      const tx = target?.x ?? bolt.x;
      const ty = (target?.y ?? bolt.y) + 1.0;
      const tz = target?.z ?? bolt.z;
      const dx = tx - bolt.x;
      const dy = ty - bolt.y;
      const dz = tz - bolt.z;
      const dist = Math.hypot(dx, dy, dz);
      const step = PROJECTILE_SPEED * delta;
      if (dist <= Math.max(HIT_RADIUS, step)) {
        // Reached the target — impact burst (the bolt no longer just vanishes).
        spawnImpactBurst(tx, ty, tz, { count: 10, color: BOLT_COLOR, speed: 3.6, size: 0.14, life: 0.32 });
        bolt.active = false;
        mesh.visible = false;
        return;
      }
      if (now - bolt.bornAt > MAX_AGE_MS) {
        bolt.active = false;
        mesh.visible = false;
        return;
      }
      bolt.x += (dx / dist) * step;
      bolt.y += (dy / dist) * step;
      bolt.z += (dz / dist) * step;
      mesh.visible = true;
      mesh.position.set(bolt.x, bolt.y, bolt.z);
    });
  });

  return (
    <>
      {slots.map((i) => (
        <mesh key={i} visible={false} ref={(m) => { meshes.current[i] = m; }}>
          <sphereGeometry args={[0.15, 12, 12]} />
          <meshStandardMaterial color={BOLT_COLOR} emissive={BOLT_COLOR} emissiveIntensity={2} />
        </mesh>
      ))}
    </>
  );
}
