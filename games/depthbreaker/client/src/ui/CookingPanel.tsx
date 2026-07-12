// Cooking panel (toggled by clicking the station, the dock icon, or F). Lists the
// cooking recipes; each shows the output, its ingredients as have/need counts,
// and a Cook button enabled when you're in range and hold every ingredient. The
// server (ZoneRoom.craftRecipe) re-validates and does the bag math — this panel
// only sends the recipe intent. Same external-store + draggable pattern as
// MarketPanel; cooked food arrives via the existing loot-toast path.

import { useSyncExternalStore } from "react";
import { itemDef, countItem, COOKING_RECIPES } from "@depthbreaker/sim";
import { COOK_RANGE, buildDungeon } from "@depthbreaker/protocol";
import type { ItemSlotView } from "@depthbreaker/protocol";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { localPlayerPos } from "../game/entityRefs";
import { rarityColor, itemInitials, itemName } from "./itemDisplay";
import { useDraggablePanel } from "./useDraggablePanel";
import { tooltipHandlers } from "./Tooltip";
import { ItemCard } from "./ItemCard";
import { PanelClose } from "./PanelClose";

let cookingOpen = false;
const openListeners = new Set<() => void>();
function emitOpen(): void {
  for (const fn of openListeners) fn();
}
export function toggleCooking(): void {
  cookingOpen = !cookingOpen;
  emitOpen();
}
export function closeCooking(): void {
  if (!cookingOpen) return;
  cookingOpen = false;
  emitOpen();
}
function subscribeOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}
export function useCookingOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, () => cookingOpen);
}

/** Flatten the synced bag into an itemId->count map for have/need checks. */
function bagCounts(inventory: readonly ItemSlotView[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slot of inventory) {
    if (slot.itemId && slot.count > 0) out[slot.itemId] = (out[slot.itemId] ?? 0) + slot.count;
  }
  return out;
}

export function CookingPanel() {
  const open = useCookingOpen();
  const snap = useZoneState();
  const { position, dragHandlers } = useDraggablePanel("cooking", () => ({ x: 16, y: 72 }));
  if (!open || !snap.self) return null;
  const self = snap.self;

  const station = buildDungeon(snap.seed, snap.depth).cookingStation;
  const inRange = Math.hypot(localPlayerPos.x - station.x, localPlayerPos.z - station.z) <= COOK_RANGE;
  const have = bagCounts(self.inventory);

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: 320,
        background: "rgba(11,13,18,0.9)",
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
      <div {...dragHandlers} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, ...dragHandlers.style }}>
        <b>Cooking</b>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>turn raw fish into food</span>
          <PanelClose onClose={closeCooking} />
        </div>
      </div>

      {!inRange && <div style={{ color: "#fbbf24", fontSize: 12, marginBottom: 8 }}>Walk to the cooking station to cook.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "50vh", overflowY: "auto" }}>
        {COOKING_RECIPES.map((recipe) => {
          const out = itemDef(recipe.output);
          const canCook = recipe.inputs.every((i) => (have[i.itemId] ?? 0) >= i.count);
          const enabled = inRange && canCook;
          return (
            <div key={recipe.id} style={rowStyle}>
              <div {...tooltipHandlers(() => <ItemCard itemId={recipe.output} action={`Heals ${Math.round((out?.healFraction ?? 0) * 100)}% HP`} />)} style={{ ...iconStyle, borderColor: rarityColor(out?.rarity ?? "") }}>
                {itemInitials(recipe.output)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{itemName(recipe.output)}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                  {recipe.inputs.map((i) => {
                    const held = have[i.itemId] ?? 0;
                    const ok = held >= i.count;
                    return (
                      <span key={i.itemId} style={{ fontSize: 11, color: ok ? "#94a3b8" : "#f87171" }}>
                        {itemName(i.itemId)} {held}/{i.count}
                      </span>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={() => zoneStore.sendCraft(recipe.id)}
                disabled={!enabled}
                title={canCook ? undefined : "Missing ingredients"}
                style={cookBtn(enabled)}
              >
                Cook
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "rgba(15,23,42,0.9)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 8,
  padding: "6px 8px",
};
const iconStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 6,
  border: "1px solid",
  display: "grid",
  placeItems: "center",
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(11,13,18,0.85)",
  flexShrink: 0,
};
function cookBtn(enabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.14)",
    background: enabled ? "#c2410c" : "#1f2937",
    color: enabled ? "#fff" : "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontWeight: 700,
    cursor: enabled ? "pointer" : "default",
    whiteSpace: "nowrap",
  };
}
