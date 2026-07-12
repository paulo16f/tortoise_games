// Ground telegraphs for enemy AoE slams. A pooled set of danger discs: on a
// ServerMessage.Telegraph, a red disc fills from the center out to the slam
// radius over the wind-up, then flashes and fades at impact — so a boss/elite
// stomp is read-and-dodge, not a surprise. Subscribed to telegraphBus (bypasses
// React), mirroring the Projectiles/ImpactFx pools.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh, MeshBasicMaterial } from "three";
import { telegraphBus } from "../../net/telegraphBus";

const POOL = 8;
const FLASH_MS = 220;

interface Slot {
  active: boolean;
  x: number;
  z: number;
  radius: number;
  windupMs: number;
  bornAt: number;
}

const slots: Slot[] = Array.from({ length: POOL }, () => ({ active: false, x: 0, z: 0, radius: 1, windupMs: 800, bornAt: 0 }));
let cursor = 0;

export function Telegraphs() {
  const discs = useRef<(Mesh | null)[]>(Array(POOL).fill(null));
  const rings = useRef<(Mesh | null)[]>(Array(POOL).fill(null));
  const ids = useMemo(() => Array.from({ length: POOL }, (_, i) => i), []);

  useEffect(
    () =>
      telegraphBus.subscribe((msg) => {
        const s = slots[cursor];
        cursor = (cursor + 1) % POOL;
        s.active = true;
        s.x = msg.x;
        s.z = msg.z;
        s.radius = msg.radius;
        s.windupMs = Math.max(1, msg.windupMs);
        s.bornAt = performance.now();
      }),
    [],
  );

  useFrame(() => {
    const now = performance.now();
    for (let i = 0; i < POOL; i++) {
      const s = slots[i];
      const disc = discs.current[i];
      const ring = rings.current[i];
      if (!disc || !ring) continue;
      if (!s.active) {
        if (disc.visible) { disc.visible = false; ring.visible = false; }
        continue;
      }
      const age = now - s.bornAt;
      const total = s.windupMs + FLASH_MS;
      if (age >= total) {
        s.active = false;
        disc.visible = false;
        ring.visible = false;
        continue;
      }
      disc.visible = true;
      ring.visible = true;
      disc.position.set(s.x, 0.04, s.z);
      ring.position.set(s.x, 0.05, s.z);
      const fill = Math.min(1, age / s.windupMs);
      const discMat = disc.material as MeshBasicMaterial;
      const ringMat = ring.material as MeshBasicMaterial;
      // The outline shows the full danger footprint the whole time.
      ring.scale.set(s.radius, s.radius, s.radius);
      if (age < s.windupMs) {
        // Filling up toward the strike.
        disc.scale.set(s.radius * fill, s.radius * fill, s.radius * fill);
        discMat.opacity = 0.3;
        ringMat.opacity = 0.55;
      } else {
        // Impact flash → fade.
        const f = 1 - (age - s.windupMs) / FLASH_MS;
        disc.scale.set(s.radius, s.radius, s.radius);
        discMat.opacity = 0.65 * f;
        ringMat.opacity = 0.7 * f;
      }
    }
  });

  return (
    <>
      {ids.map((i) => (
        <group key={i}>
          <mesh ref={(m) => { discs.current[i] = m; }} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <circleGeometry args={[1, 40]} />
            <meshBasicMaterial color="#ef4444" transparent opacity={0} depthWrite={false} />
          </mesh>
          <mesh ref={(m) => { rings.current[i] = m; }} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <ringGeometry args={[0.93, 1.0, 44]} />
            <meshBasicMaterial color="#f97316" transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}
