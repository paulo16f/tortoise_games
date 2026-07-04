import { useEffect } from "react";
import { INPUT_SEND_HZ } from "@depthbreaker/protocol";
import {
  controlState,
  isMoveKey,
  computeMove,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./controls";
import { zoneStore } from "../../net/room";
import { localPlayerPos } from "../entityRefs";

function targetNearestEnemy(): void {
  const st = zoneStore.state;
  if (!st) return;
  const px = localPlayerPos.x;
  const pz = localPlayerPos.z;
  const alive: { id: string; d: number }[] = [];
  st.enemies.forEach((e, id) => {
    if (e.alive) alive.push({ id, d: Math.hypot(e.x - px, e.z - pz) });
  });
  if (alive.length === 0) return;
  alive.sort((a, b) => a.d - b.d);
  const current = st.players.get(zoneStore.selfId)?.targetId ?? "";
  const idx = alive.findIndex((a) => a.id === current);
  const next = idx === -1 ? alive[0] : alive[(idx + 1) % alive.length];
  zoneStore.sendTarget(next.id);
}

export function useControls(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isMoveKey(e.code)) controlState.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === "KeyQ") zoneStore.sendSkill(0);
      if (e.code === "KeyE") zoneStore.sendSkill(2);
      if (e.code === "Digit2") zoneStore.sendSkill(1);
      if (e.code === "Tab") {
        e.preventDefault();
        targetNearestEnemy();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isMoveKey(e.code)) controlState.keys.delete(e.code);
    };
    const onBlur = () => controlState.keys.clear();
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) controlState.dragging = true;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 2) controlState.dragging = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!controlState.dragging) return;
      const o = controlState.orbit;
      o.panX = Math.max(-1.2, Math.min(1.2, o.panX - e.movementX * 0.012));
      o.panZ = Math.max(-1.2, Math.min(1.2, o.panZ + e.movementY * 0.012));
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
      const { moveX, moveZ } = computeMove(controlState);
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
    };
  }, []);
}
