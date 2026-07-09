import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { controlState } from "../input/controls";
import { localPlayerPos } from "../entityRefs";
import { zoneStore } from "../../net/room";
import { resolvePlayerModel } from "../actors/useModel";
import { ARPG_CAMERA } from "./cameraPreset";

const desired = new Vector3();
const lookTarget = new Vector3();

export function CameraRig() {
  const camera = useThree((s) => s.camera);

  useFrame((_, delta) => {
    const o = controlState.orbit;
    const p = localPlayerPos;
    const self = zoneStore.state?.players.get(zoneStore.selfId);
    const targetHeight = (self ? resolvePlayerModel(self.classId)?.visualHeight : undefined) ?? 1.15;
    const lookHeight = targetHeight * 0.72;
    const cosPitch = Math.cos(o.pitch);
    const ox = Math.sin(o.yaw) * cosPitch * o.distance;
    const oz = Math.cos(o.yaw) * cosPitch * o.distance;
    const oy = Math.sin(o.pitch) * o.distance;
    desired.set(p.x + ox, p.y + oy + lookHeight, p.z + oz);
    camera.position.lerp(desired, Math.min(1, ARPG_CAMERA.targetLerp * delta));
    lookTarget.set(p.x, p.y + lookHeight, p.z);
    camera.lookAt(lookTarget);
  });

  return null;
}
