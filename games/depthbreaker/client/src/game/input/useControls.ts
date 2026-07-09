import { useEffect } from "react";
import { INPUT_SEND_HZ } from "@depthbreaker/protocol";
import {
  controlState,
  isMoveKey,
  computeMove,
  MIN_ZOOM,
  MAX_ZOOM,
  clearClickDestination,
  resetCameraOrbit,
} from "./controls";
import { ARPG_CAMERA } from "../world/cameraPreset";
import { zoneStore } from "../../net/room";
import { localPlayerPos } from "../entityRefs";

const TARGET_SELECTION_RANGE = 18;
const CLICK_STOP_DISTANCE = 0.35;

function targetNextEnemyInRange(): void {
  const st = zoneStore.state;
  if (!st) return;
  const px = localPlayerPos.x;
  const pz = localPlayerPos.z;
  const alive: { id: string; d: number }[] = [];
  st.enemies.forEach((e, id) => {
    if (!e.alive) return;
    const d = Math.hypot(e.x - px, e.z - pz);
    if (d <= TARGET_SELECTION_RANGE) alive.push({ id, d });
  });
  if (alive.length === 0) {
    clearClickDestination();
    zoneStore.sendTarget("");
    return;
  }
  alive.sort((a, b) => a.d - b.d);
  const current = st.players.get(zoneStore.selfId)?.targetId ?? "";
  const idx = alive.findIndex((a) => a.id === current);
  const next = idx === -1 ? alive[0] : alive[(idx + 1) % alive.length];
  clearClickDestination();
  zoneStore.sendTarget(next.id, false);
}

export function useControls(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isMoveKey(e.code)) controlState.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === "Digit1") {
        const self = zoneStore.state?.players.get(zoneStore.selfId);
        if (self?.targetId) {
          clearClickDestination();
          zoneStore.sendAutoAttack(!self.autoAttack);
        }
      }
      if (e.code === "Digit2") zoneStore.sendSkill(0);
      if (e.code === "Digit3") zoneStore.sendSkill(2);
      if (e.code === "Digit4") zoneStore.sendSkill(0);
      if (e.code === "Digit5") zoneStore.sendSkill(2);
      if (e.code === "KeyV") {
        const self = zoneStore.state?.players.get(zoneStore.selfId);
        if (self) zoneStore.sendToggleWeapon(!self.weaponId);
      }
      if (e.code === "KeyR") resetCameraOrbit();
      if (e.code === "Tab") {
        e.preventDefault();
        targetNextEnemyInRange();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isMoveKey(e.code)) controlState.keys.delete(e.code);
    };
    const onBlur = () => controlState.keys.clear();
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      e.preventDefault();
      controlState.dragging = true;
      controlState.dragPointerId = e.pointerId;
      const target = e.target instanceof Element ? e.target : null;
      target?.setPointerCapture?.(e.pointerId);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 2 && e.pointerId !== controlState.dragPointerId) return;
      controlState.dragging = false;
      controlState.dragPointerId = undefined;
      const target = e.target instanceof Element ? e.target : null;
      target?.releasePointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!controlState.dragging) return;
      if (controlState.dragPointerId !== undefined && e.pointerId !== controlState.dragPointerId) return;
      e.preventDefault();
      const o = controlState.orbit;
      o.yaw -= e.movementX * ARPG_CAMERA.yawSpeed;
      o.pitch = clamp(o.pitch + e.movementY * ARPG_CAMERA.pitchSpeed, ARPG_CAMERA.minPitch, ARPG_CAMERA.maxPitch);
    };
    const onWheel = (e: WheelEvent) => {
      const o = controlState.orbit;
      o.distance += e.deltaY * 0.006;
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

    let seq = 0;
    const interval = window.setInterval(() => {
      const { moveX, moveZ } = computeMoveWithClickDestination();
      zoneStore.sendInput({ seq: seq++, moveX, moveZ, yaw: controlState.orbit.yaw });
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
      controlState.clickDestination = undefined;
      controlState.dragging = false;
      controlState.dragPointerId = undefined;
    };
  }, []);
}

function computeMoveWithClickDestination(): { moveX: number; moveZ: number } {
  const held = computeMove(controlState);
  if (Math.hypot(held.moveX, held.moveZ) > 0.01) return held;

  const dest = controlState.clickDestination;
  if (!dest) return held;

  const dx = dest.x - localPlayerPos.x;
  const dz = dest.z - localPlayerPos.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= CLICK_STOP_DISTANCE) {
    controlState.clickDestination = undefined;
    return { moveX: 0, moveZ: 0 };
  }
  return { moveX: dx / distance, moveZ: dz / distance };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
