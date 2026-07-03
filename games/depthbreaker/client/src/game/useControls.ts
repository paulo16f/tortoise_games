// Wires window keyboard + pointer listeners into the controlState singleton.
// Mount once inside the App while "playing". Also periodically sends held
// input to the server at INPUT_SEND_HZ.

import { useEffect } from "react";
import { INPUT_SEND_HZ } from "@depthbreaker/protocol";
import {
  controlState,
  isMoveKey,
  computeMove,
  MIN_ZOOM,
  MAX_ZOOM,
  MIN_PITCH,
  MAX_PITCH,
} from "./controls";
import { zoneStore } from "../net/room";

export function useControls(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isMoveKey(e.code)) {
        controlState.keys.add(e.code);
      }
      // Skill keybinds: 1 -> slot 0, 2 -> slot 1. Server handling is minimal in
      // Phase 0; we still wire the send so the contract is exercised.
      if (e.code === "Digit1") zoneStore.sendSkill(0);
      if (e.code === "Digit2") zoneStore.sendSkill(1);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isMoveKey(e.code)) controlState.keys.delete(e.code);
    };
    const onBlur = () => controlState.keys.clear();

    // Right-drag to orbit.
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) {
        controlState.dragging = true;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 2) controlState.dragging = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!controlState.dragging) return;
      const o = controlState.orbit;
      o.yaw -= e.movementX * 0.005;
      o.pitch -= e.movementY * 0.005;
      if (o.pitch < MIN_PITCH) o.pitch = MIN_PITCH;
      if (o.pitch > MAX_PITCH) o.pitch = MAX_PITCH;
    };
    const onWheel = (e: WheelEvent) => {
      const o = controlState.orbit;
      o.distance += e.deltaY * 0.01;
      if (o.distance < MIN_ZOOM) o.distance = MIN_ZOOM;
      if (o.distance > MAX_ZOOM) o.distance = MAX_ZOOM;
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("contextmenu", onContextMenu);

    // Input send loop at INPUT_SEND_HZ.
    let seq = 0;
    const interval = window.setInterval(() => {
      const { moveX, moveZ } = computeMove(controlState);
      zoneStore.sendInput({
        seq: seq++,
        moveX,
        moveZ,
        yaw: controlState.orbit.yaw,
      });
    }, 1000 / INPUT_SEND_HZ);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("contextmenu", onContextMenu);
      window.clearInterval(interval);
      controlState.keys.clear();
    };
  }, []);
}
