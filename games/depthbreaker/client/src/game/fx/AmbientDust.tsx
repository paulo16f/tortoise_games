// Camera-anchored dust motes so the air always has gentle motion — the dungeon
// felt inert between fights. A single additive Points cloud of slow-drifting
// specks that follows the local player; motes that drift out of the box wrap back
// in. One draw call, low opacity, purely atmospheric.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, type Points } from "three";
import { localPlayerPos } from "../entityRefs";

const COUNT = 160;
const SPREAD = 26; // box half-extent around the player (X/Z)
const HEIGHT = 7;

export function AmbientDust() {
  const points = useRef<Points>(null);
  const vel = useMemo(() => new Float32Array(COUNT * 3), []);

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * SPREAD;
      pos[i * 3 + 1] = Math.random() * HEIGHT;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * SPREAD;
      vel[i * 3] = (Math.random() * 2 - 1) * 0.15;
      vel[i * 3 + 1] = 0.05 + Math.random() * 0.12;
      vel[i * 3 + 2] = (Math.random() * 2 - 1) * 0.15;
    }
    g.setAttribute("position", new BufferAttribute(pos, 3));
    return g;
  }, [vel]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(0.05, rawDelta);
    const p = points.current;
    if (!p) return;
    p.position.set(localPlayerPos.x, 0, localPlayerPos.z);
    const attr = geometry.getAttribute("position") as BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3] += vel[i * 3] * delta;
      arr[i * 3 + 1] += vel[i * 3 + 1] * delta;
      arr[i * 3 + 2] += vel[i * 3 + 2] * delta;
      // Wrap motes that leave the box (relative to the player-anchored origin).
      if (arr[i * 3 + 1] > HEIGHT) arr[i * 3 + 1] = 0;
      if (arr[i * 3] > SPREAD) arr[i * 3] -= SPREAD * 2;
      else if (arr[i * 3] < -SPREAD) arr[i * 3] += SPREAD * 2;
      if (arr[i * 3 + 2] > SPREAD) arr[i * 3 + 2] -= SPREAD * 2;
      else if (arr[i * 3 + 2] < -SPREAD) arr[i * 3 + 2] += SPREAD * 2;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={0.06}
        color="#9fb4c8"
        transparent
        opacity={0.22}
        depthWrite={false}
        blending={AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}
