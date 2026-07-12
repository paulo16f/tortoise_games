// Bag panel (toggled with B). Reads the server-authoritative inventory off the
// local player and issues equip/use commands. The bag is a fixed grid; empty
// slots have itemId "". Weapons equip on click; potions/food are consumed.

import { ItemGlyph } from "./ItemGlyph";
import { useSyncExternalStore } from "react";
import { itemDef } from "@depthbreaker/sim";
import type { ItemSlotView } from "@depthbreaker/protocol";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { rarityColor, itemInitials } from "./itemDisplay";
import { useDraggablePanel } from "./useDraggablePanel";
import { tooltipHandlers } from "./Tooltip";
import { PanelClose } from "./PanelClose";
import { ItemCard } from "./ItemCard";

// Minimal external store for the open/closed flag so the input layer (window
// keydown in useControls) and this component agree without prop drilling.
let bagOpen = false;
const openListeners = new Set<() => void>();
function emitOpen(): void {
  for (const fn of openListeners) fn();
}
export function toggleInventory(): void {
  bagOpen = !bagOpen;
  emitOpen();
}
export function closeInventory(): void {
  if (!bagOpen) return;
  bagOpen = false;
  emitOpen();
}
function subscribeOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}
function useBagOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, () => bagOpen);
}
/** Read-only subscription for other UI (e.g. the panel dock highlight). */
export const useInventoryOpen = useBagOpen;

function BagSlot({ slot, index }: { slot: ItemSlotView; index: number }) {
  const def = slot.itemId ? itemDef(slot.itemId) : undefined;
  const empty = !slot.itemId || slot.count <= 0;
  const isWeapon = def?.kind === "weapon";
  const isConsumable = def?.kind === "potion" || def?.kind === "food";
  const border = empty ? "rgba(255,255,255,0.08)" : rarityColor(slot.rarity);

  const onClick = () => {
    if (empty) return;
    if (isWeapon) zoneStore.sendEquipWeapon(slot.itemId);
    else if (isConsumable) zoneStore.sendUseItem(index);
  };

  const clickable = !empty && (isWeapon || isConsumable);
  const action = clickable ? (isWeapon ? "Click to equip" : "Click to use") : undefined;

  return (
    <div
      onClick={onClick}
      {...(empty ? {} : tooltipHandlers(() => <ItemCard itemId={slot.itemId} count={slot.count} action={action} />))}
      style={{
        position: "relative",
        width: 52,
        height: 52,
        borderRadius: 8,
        border: `1px solid ${border}`,
        background: empty ? "rgba(11,13,18,0.5)" : "rgba(15,23,42,0.9)",
        display: "grid",
        placeItems: "center",
        fontSize: 13,
        fontWeight: 800,
        color: "#f8fafc",
        cursor: clickable ? "pointer" : "default",
        pointerEvents: "auto",
      }}
    >
      {!empty && <ItemGlyph itemId={slot.itemId} />}
      {!empty && slot.count > 1 && (
        <span
          style={{
            position: "absolute",
            right: 3,
            bottom: 1,
            fontSize: 11,
            fontWeight: 700,
            textShadow: "0 1px 2px #000",
          }}
        >
          {slot.count}
        </span>
      )}
    </div>
  );
}

export function InventoryPanel() {
  const open = useBagOpen();
  const snap = useZoneState();
  const { position, dragHandlers } = useDraggablePanel("bag", () => ({
    x: window.innerWidth - 260,
    y: 16,
  }));
  if (!open) return null;
  const inventory = snap.self?.inventory ?? [];

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        background: "rgba(11,13,18,0.82)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        padding: 12,
        backdropFilter: "blur(4px)",
        color: "#e6e9ef",
        fontFamily: "system-ui, sans-serif",
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <div
        {...dragHandlers}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, ...dragHandlers.style }}
      >
        <b>Bag</b>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>B / Esc</span>
          <PanelClose onClose={closeInventory} />
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 52px)",
          gap: 6,
        }}
      >
        {inventory.map((slot, i) => (
          <BagSlot key={i} slot={slot} index={i} />
        ))}
      </div>
    </div>
  );
}
