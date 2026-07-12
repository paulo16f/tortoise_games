import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import type { Group } from "three";
import { zoneStore, type CombatFloater } from "../../net/room";
import { useZoneState } from "../../net/useZone";
import { FLOATER_LIFETIME_MS, FLOATER_RISE } from "./fxConstants";
import { resolveEnemyModel, resolvePlayerModel } from "../actors/useModel";

const STYLE = {
  hit: { color: "#f8fafc", fontSize: 0.4 },
  crit: { color: "#fbbf24", fontSize: 0.6 },
  heal: { color: "#22c55e", fontSize: 0.45 },
} as const;

export function CombatFloaters() {
  const snap = useZoneState();
  return (
    <>
      {snap.combat
        .filter((f) => f.kind !== "death" && !(f.kind === "skill" && f.amount === 0))
        .map((f) => <Floater key={f.id} floater={f} />)}
    </>
  );
}

/** Ease-out-back overshoot for the birth pop (0 -> ~1.1 -> 1). */
function popScale(p: number): number {
  const s = 1.7;
  const q = p - 1;
  return 1 + (s + 1) * q * q * q + s * q * q;
}

function Floater({ floater }: { floater: CombatFloater }) {
  const group = useRef<Group>(null);
  const isCrit = floater.kind === "crit";
  const anchor = useMemo(() => {
    const st = zoneStore.state;
    const enemy = st?.enemies.get(floater.targetId);
    const player = st?.players.get(floater.targetId);
    const target = enemy ?? player;
    const model = enemy ? resolveEnemyModel(enemy.defId) : player ? resolvePlayerModel(player.classId) : undefined;
    // Deterministic per-id horizontal scatter so rapid hits fan out instead of
    // stacking into one unreadable pile.
    const jitter = (((floater.id * 2654435761) % 1000) / 1000 - 0.5) * 0.8;
    return { x: (target?.x ?? 0) + jitter, y: (target?.y ?? 0) + (model?.visualHeight ?? 1.5) + 0.35, z: target?.z ?? 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floater.id]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const age = performance.now() - floater.bornAt - floater.delayMs;
    if (age < 0 || age > FLOATER_LIFETIME_MS) {
      g.visible = false;
      return;
    }
    const t = age / FLOATER_LIFETIME_MS;
    g.visible = true;
    // Birth pop-in over the first ~120ms, then a shrink-fade in the last 25%.
    const pop = age < 120 ? popScale(age / 120) : 1;
    const fade = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
    const critBase = isCrit ? 1.15 : 1;
    // Crits jitter a touch for emphasis, easing off as they rise.
    const shakeX = isCrit ? Math.sin(age * 0.05) * 0.06 * (1 - t) : 0;
    g.position.set(anchor.x + shakeX, anchor.y + FLOATER_RISE * t, anchor.z);
    g.scale.setScalar(Math.max(0.001, pop * fade * critBase));
  });

  const style = STYLE[floater.kind as keyof typeof STYLE] ?? STYLE.hit;
  const label = floater.amount < 0 ? `+${-floater.amount}` : `${floater.amount}`;

  return (
    <group ref={group} visible={false}>
      <Billboard>
        <Text fontSize={style.fontSize} color={style.color} outlineWidth={0.03} outlineColor="#0b0d12" fontWeight={floater.kind === "crit" ? "bold" : "normal"}>
          {label}
        </Text>
      </Billboard>
    </group>
  );
}
