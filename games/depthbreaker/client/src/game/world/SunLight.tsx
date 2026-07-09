import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { DirectionalLight } from "three";
import { localPlayerPos } from "../entityRefs";

// Warm directional key light whose position + shadow target follow the local
// player, so a tight orthographic frustum gives crisp soft shadows anywhere on
// the large (~140u) seeded map instead of the default unbounded 5-unit frustum
// (the reason shadows barely showed before). Ported from world-of-claudecraft,
// which re-centers its sun shadow camera on the player every frame the same way.
const SUN_OFFSET: [number, number, number] = [34, 52, 22]; // direction/height of the key light

export function SunLight() {
  const light = useRef<DirectionalLight>(null);

  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const px = localPlayerPos.x;
    const pz = localPlayerPos.z;
    l.position.set(px + SUN_OFFSET[0], SUN_OFFSET[1], pz + SUN_OFFSET[2]);
    // The light's built-in target has no parent; updating its local position and
    // world matrix directly is enough for the shadow camera to track the player.
    l.target.position.set(px, 0, pz);
    l.target.updateMatrixWorld();
  });

  return (
    <directionalLight
      ref={light}
      color="#ffe6c0"
      intensity={2.2}
      castShadow
      shadow-mapSize-width={4096}
      shadow-mapSize-height={4096}
      shadow-camera-near={10}
      shadow-camera-far={200}
      shadow-camera-left={-40}
      shadow-camera-right={40}
      shadow-camera-top={40}
      shadow-camera-bottom={-40}
      shadow-bias={-0.0006}
      shadow-normalBias={0.05}
      shadow-radius={4}
    />
  );
}
