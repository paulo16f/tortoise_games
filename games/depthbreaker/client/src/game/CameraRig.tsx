// Third-person follow camera. Reads the local player's live mesh position (via
// a shared ref registry) and the orbit state, then smoothly moves the camera
// behind/above the player each frame. Purely client-side.

import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { controlState } from "./controls";
import { localPlayerPos } from "./entityRefs";

const desired = new Vector3();
const lookTarget = new Vector3();

export function CameraRig() {
  const camera = useThree((s) => s.camera);

  useFrame((_, delta) => {
    const o = controlState.orbit;
    const p = localPlayerPos; // updated by the local Player mesh each frame

    // Spherical offset from the player based on orbit yaw/pitch/distance.
    const cosPitch = Math.cos(o.pitch);
    const ox = Math.sin(o.yaw) * cosPitch * o.distance;
    const oz = Math.cos(o.yaw) * cosPitch * o.distance;
    const oy = Math.sin(o.pitch) * o.distance;

    desired.set(p.x + ox, p.y + oy + 1.2, p.z + oz);

    // Smooth follow.
    const t = Math.min(1, 8 * delta);
    camera.position.lerp(desired, t);

    lookTarget.set(p.x, p.y + 1.2, p.z);
    camera.lookAt(lookTarget);
  });

  return null;
}
