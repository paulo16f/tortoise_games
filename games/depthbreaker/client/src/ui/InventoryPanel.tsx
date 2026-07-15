// Inventory panel (toggled with B). Reads the server-authoritative inventory off
// the local player and issues equip/use commands. Shows a live 3D bust of the
// character + the equipped-weapon slot, then the bag grid. Empty bag slots have
// itemId ""; weapons equip on click, potions/food are consumed.

import { framedPanel, frameTitle } from "./frames";
import { ItemGlyph } from "./ItemGlyph";
import { useSyncExternalStore } from "react";
import { itemDef } from "@depthbreaker/sim";
import type { ItemSlotView } from "@depthbreaker/protocol";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { rarityColor } from "./itemDisplay";
import { useDraggablePanel } from "./useDraggablePanel";
import { tooltipHandlers } from "./Tooltip";
import { PanelClose } from "./PanelClose";
import { ItemCard } from "./ItemCard";
import { CharacterPreview3D } from "./menu/CharacterPreview3D";

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

/** The single equipped-weapon slot (click to unequip). Empty when unarmed. */
function WeaponSlot({ weaponId }: { weaponId: string }) {
  const def = weaponId ? itemDef(weaponId) : undefined;
  const empty = !weaponId || !def;
  return (
    <div
      onClick={() => weaponId && zoneStore.sendEquipWeapon(weaponId)}
      {...(empty ? {} : tooltipHandlers(() => <ItemCard itemId={weaponId} count={1} action="Click to unequip" />))}
      style={{
        position: "relative",
        width: 52,
        height: 52,
        borderRadius: 8,
        border: `1px solid ${empty ? "rgba(201,165,74,0.35)" : rarityColor(def!.rarity)}`,
        background: empty ? "rgba(11,13,18,0.5)" : "rgba(15,23,42,0.9)",
        display: "grid",
        placeItems: "center",
        cursor: empty ? "default" : "pointer",
        pointerEvents: "auto",
      }}
    >
      {empty ? <span style={{ fontSize: 18, opacity: 0.4 }}>⚔️</span> : <ItemGlyph itemId={weaponId} />}
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
        ...framedPanel,
        padding: 12,
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
        <span style={frameTitle}>Inventory</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>B / Esc</span>
          <PanelClose onClose={closeInventory} />
        </div>
      </div>

      {/* Character bust (left) + equipped weapon (right). */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 118,
            height: 150,
            borderRadius: 8,
            border: "1px solid rgba(201,165,74,0.3)",
            background: "radial-gradient(circle at 50% 35%, rgba(30,34,44,0.9), rgba(6,7,10,0.95))",
            overflow: "hidden",
          }}
        >
          <CharacterPreview3D classId={snap.self?.classId ?? "knight"} skinId={snap.self?.skinId} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "#c9a54a", textTransform: "uppercase" }}>Weapon</span>
          <WeaponSlot weaponId={snap.self?.weaponId ?? ""} />
          <span style={{ fontSize: 11, opacity: 0.65, textTransform: "capitalize" }}>{snap.self?.classId ?? ""}</span>
          <span style={{ fontSize: 11, opacity: 0.65 }}>Lv {snap.self?.level ?? 1}</span>
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
