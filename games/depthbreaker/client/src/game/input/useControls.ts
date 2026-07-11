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
import { zoneStore } from "../../net/room";
import { closeInventory, toggleInventory } from "../../ui/InventoryPanel";
import { closeSkillBook, toggleSkillBook } from "../../ui/SkillBookPanel";
import { closeMarket, toggleMarket } from "../../ui/MarketPanel";
import { closeStash, toggleStash } from "../../ui/StashPanel";
import { closeDailies, toggleDailies } from "../../ui/DailyQuestPanel";
import { localPlayerPos } from "../entityRefs";

/** Keys 1-9,0 map to hotbar slots 0-9. */
const HOTBAR_KEY_SLOTS: Record<string, number> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Digit5: 4,
  Digit6: 5,
  Digit7: 6,
  Digit8: 7,
  Digit9: 8,
  Digit0: 9,
};

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
      const hotbarSlot = HOTBAR_KEY_SLOTS[e.code];
      if (hotbarSlot !== undefined) {
        // Slot 0 is the auto-attack toggle; stop click-to-move so the server's
        // auto-follow takes over, same as the old Digit1 behavior.
        if (hotbarSlot === 0) clearClickDestination();
        zoneStore.sendSkill(hotbarSlot);
      }
      if (e.code === "KeyV") {
        const self = zoneStore.state?.players.get(zoneStore.selfId);
        if (self) zoneStore.sendToggleWeapon(!self.weaponId);
      }
      if (e.code === "KeyB") toggleInventory();
      if (e.code === "KeyK") toggleSkillBook();
      if (e.code === "KeyM") toggleMarket();
      if (e.code === "KeyN") toggleStash();
      if (e.code === "KeyJ") toggleDailies();
      if (e.code === "Escape") {
        closeInventory();
        closeSkillBook();
        closeMarket();
        closeStash();
        closeDailies();
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
    // Fixed Diablo camera: right-drag no longer rotates the view (yaw/pitch are
    // pinned in CameraRig). The handler stays a no-op so right-click still
    // suppresses the context menu without moving the camera.
    const onPointerMove = (e: PointerEvent) => {
      if (!controlState.dragging) return;
      if (controlState.dragPointerId !== undefined && e.pointerId !== controlState.dragPointerId) return;
      e.preventDefault();
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
