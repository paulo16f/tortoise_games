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

function Floater({ floater }: { floater: CombatFloater }) {
  const group = useRef<Group>(null);
  const anchor = useMemo(() => {
    const st = zoneStore.state;
    const enemy = st?.enemies.get(floater.targetId);
    const player = st?.players.get(floater.targetId);
    const target = enemy ?? player;
    const model = enemy ? resolveEnemyModel(enemy.defId) : player ? resolvePlayerModel(player.classId) : undefined;
    return { x: target?.x ?? 0, y: (target?.y ?? 0) + (model?.visualHeight ?? 1.5) + 0.35, z: target?.z ?? 0 };
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
    g.position.set(anchor.x, anchor.y + FLOATER_RISE * t, anchor.z);
    const s = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    g.scale.setScalar(Math.max(0.001, s));
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
