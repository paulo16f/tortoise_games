// Diablo-style click-to-move marker: a brief expanding, fading ring at the
// ground point the player clicked. Watches controlState.clickDestination
// imperatively (it's mutable non-React state) — a new destination restarts
// the pulse; nothing renders while idle.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh, MeshBasicMaterial } from "three";
import { controlState } from "../input/controls";

const PULSE_SECONDS = 0.6;

export function ClickMarker() {
  const mesh = useRef<Mesh>(null);
  // Track the destination OBJECT (setClickDestination allocates a new one per
  // click), so re-clicking the same spot still restarts the pulse.
  const lastDest = useRef<object | null>(null);
  const bornAt = useRef(0);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const dest = controlState.clickDestination;

    if (dest && lastDest.current !== dest) {
      lastDest.current = dest;
      bornAt.current = performance.now();
      m.position.set(dest.x, 0.06, dest.z);
    }
    if (!lastDest.current) {
      m.visible = false;
      return;
    }

    const age = (performance.now() - bornAt.current) / 1000;
    if (age > PULSE_SECONDS) {
      m.visible = false;
      return;
    }
    const t = age / PULSE_SECONDS;
    m.visible = true;
    m.scale.setScalar(0.5 + t * 1.1);
    (m.material as MeshBasicMaterial).opacity = 0.85 * (1 - t);
  });

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.42, 0.55, 32]} />
      <meshBasicMaterial color="#93c5fd" transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
