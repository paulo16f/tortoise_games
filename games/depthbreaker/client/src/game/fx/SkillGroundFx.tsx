// Per-skill GROUND effects + cast flashes — the flat, additive rings/pools/novas
// that sell an ability's footprint (frost-nova ring, fireball scorch, holy nova,
// cleave/whirlwind arc, taunt shout) plus a quick flash at the caster. Pooled and
// Bloom-lit like ImpactFx, driven by the combat bus and the per-skill VFX registry
// (skillVfx.ts) keyed on the server's `skillId`. Pure client cosmetic.
//
// Trigger rules (see skillVfx GroundSpec.at):
//  - "caster" ground / cast flash fire on a self-anchored cast event
//    (sourceId === targetId); deduped per skill+caster so double emits don't stack.
//  - "target" ground fires on the amount-0 launch/apply event (or a heal), timed by
//    delayMs and anchored at the target's live position; deduped per actionId so
//    DoT ticks (amount > 0) and multi-hit AoEs don't spawn a pool each.

import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh, MeshBasicMaterial } from "three";
import { AdditiveBlending, DoubleSide } from "three";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";
import { resolveEnemyModel, resolvePlayerModel } from "../actors/useModel";
import { spawnImpactBurst } from "./ImpactFx";
import { vfxFor, type GroundKind, type GroundSpec } from "./skillVfx";

const POOL = 16;
const GROUND_Y = 0.06;
const DEDUP_MS = 200;

const DEFAULT_LIFE: Record<GroundKind, number> = { ring: 0.7, nova: 0.5, pool: 0.9, arc: 0.45, shout: 0.6 };

interface Ground {
  active: boolean;
  kind: GroundKind;
  x: number;
  z: number;
  color: string;
  radius: number;
  bornAt: number;
  life: number;
}

const grounds: Ground[] = Array.from({ length: POOL }, () => ({ active: false, kind: "ring", x: 0, z: 0, color: "#ffffff", radius: 1, bornAt: 0, life: 0.6 }));
let cursor = 0;
// key -> last spawn time (ms), so redundant/duplicate events don't stack effects.
const recent = new Map<string, number>();

function spawnGround(x: number, z: number, g: GroundSpec, key: string): void {
  const now = performance.now();
  const last = recent.get(key) ?? 0;
  if (now - last < DEDUP_MS) return;
  recent.set(key, now);
  const slot = grounds.find((s) => !s.active) ?? grounds[cursor];
  cursor = (cursor + 1) % POOL;
  slot.active = true;
  slot.kind = g.kind;
  slot.x = x;
  slot.z = z;
  slot.color = g.color;
  slot.radius = g.radius;
  slot.bornAt = now;
  slot.life = g.life ?? DEFAULT_LIFE[g.kind];
}

function playerPos(id: string): { x: number; z: number } | null {
  const p = zoneStore.state?.players.get(id);
  return p ? { x: p.x, z: p.z } : null;
}
function entityPos(id: string): { x: number; z: number } | null {
  const st = zoneStore.state;
  const e = st?.enemies.get(id) ?? st?.players.get(id);
  return e ? { x: e.x, z: e.z } : null;
}
function torsoAnchor(id: string): { x: number; y: number; z: number } | null {
  const p = zoneStore.state?.players.get(id);
  if (!p) return null;
  const h = resolvePlayerModel(p.classId)?.visualHeight ?? 1.7;
  return { x: p.x, y: p.y + h * 0.55, z: p.z };
}
// (enemy model import kept so target novas could later scale to the mob's size)
void resolveEnemyModel;

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export function SkillGroundFx() {
  const meshes = useRef<(Mesh | null)[]>(Array(POOL).fill(null));
  const slots = useMemo(() => Array.from({ length: POOL }, (_, i) => i), []);

  useEffect(
    () =>
      combatBus.subscribe((f) => {
        const vfx = vfxFor(f.skillId);
        if (!vfx) return;
        const isSelf = f.sourceId === f.targetId;
        const g = vfx.ground;
        if (g) {
          if (g.at === "caster" && isSelf && f.kind === "skill") {
            const src = playerPos(f.sourceId);
            if (src) spawnGround(src.x, src.z, g, `c:${f.skillId}:${f.sourceId}`);
          } else if (g.at === "target" && (f.amount === 0 || f.kind === "heal")) {
            const key = `t:${f.actionId || `${f.skillId}:${f.sourceId}:${f.targetId}`}`;
            const fire = () => {
              const pos = entityPos(f.targetId);
              if (pos) spawnGround(pos.x, pos.z, g, key);
            };
            if (f.delayMs > 0) window.setTimeout(fire, f.delayMs);
            else fire();
          }
        }
        if (vfx.cast && isSelf && (f.kind === "skill" || f.kind === "heal")) {
          const a = torsoAnchor(f.sourceId);
          const key = `f:${f.skillId}:${f.sourceId}`;
          if (a && performance.now() - (recent.get(key) ?? 0) >= DEDUP_MS) {
            recent.set(key, performance.now());
            spawnImpactBurst(a.x, a.y, a.z, { count: 10, color: vfx.cast.color, speed: 2.4, size: 0.13, life: 0.36, up: 1.3 });
          }
        }
      }),
    [],
  );

  useFrame(() => {
    const now = performance.now();
    for (let i = 0; i < POOL; i++) {
      const s = grounds[i];
      const mesh = meshes.current[i];
      if (!mesh) continue;
      if (!s.active) {
        if (mesh.visible) mesh.visible = false;
        continue;
      }
      const t = (now - s.bornAt) / 1000 / s.life;
      if (t >= 1) {
        s.active = false;
        mesh.visible = false;
        continue;
      }
      let scale = s.radius;
      let opacity = 1 - t;
      let y = GROUND_Y;
      switch (s.kind) {
        case "ring":
          scale = s.radius * (0.15 + 0.85 * easeOut(t));
          opacity = (1 - t) * 0.75;
          break;
        case "nova": {
          const grow = Math.min(1, t / 0.35);
          scale = s.radius * grow;
          y = GROUND_Y + 0.05 + t * 0.5;
          opacity = (1 - t) * 0.9;
          break;
        }
        case "pool":
          scale = s.radius;
          opacity = (t < 0.15 ? t / 0.15 : (1 - t) / 0.85) * 0.55;
          break;
        case "arc":
          scale = s.radius * (0.2 + 0.8 * easeOut(Math.min(1, t * 1.6)));
          opacity = (1 - t) * 0.8;
          break;
        case "shout":
          scale = s.radius * (0.1 + 0.9 * easeOut(t));
          opacity = (1 - t) * 0.6;
          break;
      }
      mesh.visible = true;
      mesh.position.set(s.x, y, s.z);
      mesh.scale.setScalar(Math.max(0.001, scale));
      const mat = mesh.material as MeshBasicMaterial;
      mat.color.set(s.color);
      mat.opacity = Math.max(0, opacity);
    }
  });

  return (
    <>
      {slots.map((i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} visible={false} ref={(m) => { meshes.current[i] = m; }}>
          {/* Unit annulus scaled to the effect radius; reads as ring/arc/nova/pool. */}
          <ringGeometry args={[0.62, 1, 44]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} side={DoubleSide} blending={AdditiveBlending} />
        </mesh>
      ))}
    </>
  );
}
