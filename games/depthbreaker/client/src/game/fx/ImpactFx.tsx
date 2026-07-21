// Pooled impact sparks — additive emissive bits that burst from the point of
// contact on every hit/crit/death (and reused by projectile impacts + gathering).
// Bloom (Effects.tsx) picks up the additive glow for free. Subscribed to the
// combat bus so bursts fire in time with the damage (using the same delayMs), and
// exposes spawnImpactBurst() for non-combat callers. Pure client cosmetic.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh, MeshBasicMaterial } from "three";
import { AdditiveBlending, Color } from "three";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";
import { resolveEnemyModel, resolvePlayerModel } from "../actors/useModel";
import { vfxFor } from "./skillVfx";
import { spawnFlipbook } from "./FlipbookFx";
import { onLevelUp } from "./worldEvents";
import { addShake } from "./cameraImpulse";
import { localPlayerPos } from "../entityRefs";

const POOL = 72;
const GRAVITY = 6;

interface Spark {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  bornAt: number;
  life: number;
  size: number;
  color: Color;
}

interface BurstOpts {
  count?: number;
  color?: string;
  speed?: number;
  size?: number;
  life?: number;
  up?: number;
}

const sparks: Spark[] = Array.from({ length: POOL }, () => ({
  active: false,
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  bornAt: 0,
  life: 0,
  size: 0.1,
  color: new Color("#ffffff"),
}));
let cursor = 0;

/** Spawn a burst of sparks at a world point. Safe to call from anywhere. */
export function spawnImpactBurst(x: number, y: number, z: number, opts: BurstOpts = {}): void {
  const count = opts.count ?? 6;
  const speed = opts.speed ?? 3.2;
  const size = opts.size ?? 0.12;
  const life = opts.life ?? 0.32;
  const up = opts.up ?? 1.4;
  const col = new Color(opts.color ?? "#ffffff");
  const now = performance.now();
  for (let i = 0; i < count; i++) {
    const s = sparks[cursor];
    cursor = (cursor + 1) % POOL;
    const ang = Math.random() * Math.PI * 2;
    const spd = speed * (0.5 + Math.random());
    s.active = true;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = Math.cos(ang) * spd;
    s.vz = Math.sin(ang) * spd;
    s.vy = up * (0.4 + Math.random());
    s.bornAt = now;
    s.life = life * (0.7 + Math.random() * 0.6);
    s.size = size * (0.7 + Math.random() * 0.6);
    s.color.copy(col);
  }
}

/** World anchor (roughly torso height) of a combat target for on-hit bursts. */
function targetAnchor(targetId: string): { x: number; y: number; z: number } | null {
  const st = zoneStore.state;
  const enemy = st?.enemies.get(targetId);
  const player = st?.players.get(targetId);
  const t = enemy ?? player;
  if (!t) return null;
  const model = enemy ? resolveEnemyModel(enemy.defId) : player ? resolvePlayerModel(player.classId) : undefined;
  return { x: t.x, y: t.y + (model?.visualHeight ?? 1.4) * 0.6, z: t.z };
}

export function ImpactFx() {
  const meshes = useRef<(Mesh | null)[]>(Array(POOL).fill(null));
  const slots = useMemo(() => Array.from({ length: POOL }, (_, i) => i), []);

  useEffect(
    () =>
      combatBus.subscribe((f) => {
        const spawn = () => {
          const a = targetAnchor(f.targetId);
          if (!a) return;
          const damaging = f.kind === "hit" || f.kind === "crit" || (f.kind === "skill" && f.amount > 0);
          const spec = damaging ? vfxFor(f.skillId)?.impact : undefined;
          if (spec) {
            // Real-VFX layer: billboard flipbook at the impact point.
            if (spec.sheet) spawnFlipbook(a.x, a.y, a.z, spec.sheet);
            // Per-skill impact; a crit reads bigger/faster while keeping the skill colour.
            const critK = f.kind === "crit" ? 1.4 : 1;
            spawnImpactBurst(a.x, a.y, a.z, {
              count: Math.round((spec.count ?? 8) * critK),
              color: spec.color ?? "#93c5fd",
              speed: (spec.speed ?? 3.6) * (f.kind === "crit" ? 1.15 : 1),
              size: (spec.size ?? 0.13) * (f.kind === "crit" ? 1.25 : 1),
              life: spec.life ?? 0.34,
              up: spec.up,
            });
            return;
          }
          if (f.kind === "crit") spawnImpactBurst(a.x, a.y, a.z, { count: 12, color: "#fbbf24", speed: 4.2, size: 0.16, life: 0.4 });
          else if (f.kind === "hit") spawnImpactBurst(a.x, a.y, a.z, { count: 6, color: "#fef3c7", speed: 3.2, size: 0.11 });
          else if (f.kind === "skill" && f.amount > 0) spawnImpactBurst(a.x, a.y, a.z, { count: 8, color: "#93c5fd", speed: 3.6, size: 0.13 });
          else if (f.kind === "death") {
            // Bosses go out with spectacle: double golden burst + camera shake.
            const defId = zoneStore.state?.enemies.get(f.targetId)?.defId ?? "";
            if (/boss|coliseum_champion/i.test(defId)) {
              spawnImpactBurst(a.x, a.y, a.z, { count: 26, color: "#fbbf24", speed: 6.4, size: 0.24, life: 0.8, up: 3.6 });
              spawnImpactBurst(a.x, a.y + 0.5, a.z, { count: 18, color: "#f97316", speed: 4.2, size: 0.18, life: 0.6, up: 2.2 });
              addShake(0.5);
            } else {
              spawnImpactBurst(a.x, a.y, a.z, { count: 16, color: "#f97316", speed: 4.6, size: 0.17, life: 0.55, up: 2.6 });
            }
          }
        };
        if (f.delayMs > 0) window.setTimeout(spawn, f.delayMs);
        else spawn();
      }),
    [],
  );

  // Level-up: a golden fountain around the local player (sound plays in room.ts).
  useEffect(
    () =>
      onLevelUp(() => {
        const { x, y, z } = localPlayerPos;
        spawnImpactBurst(x, y + 0.9, z, { count: 24, color: "#fde047", speed: 3.2, size: 0.16, life: 0.85, up: 4.2 });
        spawnImpactBurst(x, y + 0.3, z, { count: 14, color: "#fef3c7", speed: 2.0, size: 0.12, life: 0.7, up: 3.0 });
      }),
    [],
  );

  useFrame((_, rawDelta) => {
    const delta = Math.min(0.05, rawDelta);
    const now = performance.now();
    for (let i = 0; i < POOL; i++) {
      const s = sparks[i];
      const mesh = meshes.current[i];
      if (!mesh) continue;
      if (!s.active) {
        if (mesh.visible) mesh.visible = false;
        continue;
      }
      const age = (now - s.bornAt) / 1000;
      const t = age / s.life;
      if (t >= 1) {
        s.active = false;
        mesh.visible = false;
        continue;
      }
      s.vy -= GRAVITY * delta;
      s.x += s.vx * delta;
      s.y += s.vy * delta;
      s.z += s.vz * delta;
      mesh.visible = true;
      mesh.position.set(s.x, Math.max(0.05, s.y), s.z);
      const scale = s.size * (1 - t);
      mesh.scale.setScalar(Math.max(0.001, scale));
      const mat = mesh.material as MeshBasicMaterial;
      mat.color.copy(s.color);
      mat.opacity = 1 - t;
    }
  });

  return (
    <>
      {slots.map((i) => (
        <mesh key={i} visible={false} ref={(m) => { meshes.current[i] = m; }}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} blending={AdditiveBlending} />
        </mesh>
      ))}
    </>
  );
}
