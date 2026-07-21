import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { controlState } from "../input/controls";
import { localPlayerPos } from "../entityRefs";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";
import { resolvePlayerModel } from "../actors/useModel";
import { addShake, sampleShake } from "../fx/cameraImpulse";
import { ARPG_CAMERA } from "./cameraPreset";

const desired = new Vector3();
const lookTarget = new Vector3();

export function CameraRig() {
  const camera = useThree((s) => s.camera);

  // Kick the camera on crits (anyone) and whenever the LOCAL player is hit, so
  // impacts have a physical punch. Scaled by damage, clamped in cameraImpulse.
  useEffect(
    () =>
      combatBus.subscribe((f) => {
        const selfId = zoneStore.selfId;
        const kick = () => {
          if (f.kind === "crit") addShake(0.14 + Math.min(0.18, f.amount / 200));
          else if ((f.kind === "hit" || f.kind === "skill") && f.targetId === selfId && f.amount > 0) {
            addShake(0.1 + Math.min(0.22, f.amount / 90));
          } else if (f.kind === "death" && f.targetId === selfId) addShake(0.3);
        };
        if (f.delayMs > 0) window.setTimeout(kick, f.delayMs);
        else kick();
      }),
    [],
  );

  useFrame((_, delta) => {
    const o = controlState.orbit;
    const p = localPlayerPos;
    const self = zoneStore.state?.players.get(zoneStore.selfId);
    // Fixed Diablo camera: pin yaw/pitch to the preset every frame so the view
    // never rotates behind the player (no chase cam). Only distance (zoom) is
    // player-controlled.
    o.yaw = ARPG_CAMERA.yaw;
    o.pitch = ARPG_CAMERA.pitch;
    const targetHeight = (self ? resolvePlayerModel(self.classId)?.visualHeight : undefined) ?? 1.15;
    const lookHeight = targetHeight * 0.72;
    const cosPitch = Math.cos(o.pitch);
    const ox = Math.sin(o.yaw) * cosPitch * o.distance;
    const oz = Math.cos(o.yaw) * cosPitch * o.distance;
    const oy = Math.sin(o.pitch) * o.distance;
    desired.set(p.x + ox, p.y + oy + lookHeight, p.z + oz);
    camera.position.lerp(desired, 1 - Math.exp(-ARPG_CAMERA.targetLerp * delta));
    // Additive combat shake on top of the follow target (never fights the cam).
    const s = sampleShake(delta);
    camera.position.x += s.x;
    camera.position.y += s.y;
    camera.position.z += s.z;
    lookTarget.set(p.x, p.y + lookHeight, p.z);
    camera.lookAt(lookTarget);
  });

  return null;
}
