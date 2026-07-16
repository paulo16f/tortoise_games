// Forge panel (toggled with O or the dock icon). Smithing hub of the Economy v2
// treadmill: craft weapons/tools/trial keys from combat materials + a gold fee,
// and repair the equipped weapon. The server (ZoneRoom.craftForge) re-validates
// everything — this panel only sends recipe intents. Clone of CookingPanel.

import { framedPanel, frameTitle } from "./frames";
import { ItemGlyph } from "./ItemGlyph";
import { useSyncExternalStore } from "react";
import { itemDef, FORGE_RECIPES, REPAIR_WEAPON_ID, repairCost, itemMaxUses } from "@depthbreaker/sim";
import { COOK_RANGE, buildDungeon } from "@depthbreaker/protocol";
import type { ItemSlotView } from "@depthbreaker/protocol";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { localPlayerPos } from "../game/entityRefs";
import { rarityColor, itemName } from "./itemDisplay";
import { useDraggablePanel } from "./useDraggablePanel";
import { tooltipHandlers } from "./Tooltip";
import { ItemCard } from "./ItemCard";
import { PanelClose } from "./PanelClose";

let forgeOpen = false;
const openListeners = new Set<() => void>();
function emitOpen(): void {
  for (const fn of openListeners) fn();
}
export function toggleForge(): void {
  forgeOpen = !forgeOpen;
  emitOpen();
}
export function closeForge(): void {
  if (!forgeOpen) return;
  forgeOpen = false;
  emitOpen();
}
export function useForgeOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      openListeners.add(fn);
      return () => openListeners.delete(fn);
    },
    () => forgeOpen,
  );
}

function bagCounts(inventory: readonly ItemSlotView[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slot of inventory) {
    if (slot.itemId && slot.count > 0) out[slot.itemId] = (out[slot.itemId] ?? 0) + slot.count;
  }
  return out;
}

export function ForgePanel() {
  const open = useForgeOpen();
  const snap = useZoneState();
  const { position, dragHandlers } = useDraggablePanel("forge", () => ({ x: 16, y: 72 }));
  if (!open || !snap.self) return null;
  const self = snap.self;

  const spot = buildDungeon(snap.seed, snap.depth).forge ?? buildDungeon(snap.seed, snap.depth).marketStall;
  const inRange = Math.hypot(localPlayerPos.x - spot.x, localPlayerPos.z - spot.z) <= COOK_RANGE;
  const have = bagCounts(self.inventory);
  const gold = self.gold ?? 0;

  const weaponMax = self.weaponId ? itemMaxUses(self.weaponId) : undefined;
  const repairGold = self.weaponId ? repairCost(self.weaponId) : undefined;

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: 360,
        ...framedPanel,
        padding: 12,
        color: "#e6e9ef",
        fontFamily: "system-ui, sans-serif",
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <div {...dragHandlers} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, ...dragHandlers.style }}>
        <span style={frameTitle}>Forge</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>craft · repair</span>
          <PanelClose onClose={closeForge} />
        </div>
      </div>

      {!inRange && <div style={{ color: "#fbbf24", fontSize: 12, marginBottom: 8 }}>Walk to the forge to smith.</div>}

      {/* Repair the equipped weapon (durability drains on death). */}
      {weaponMax !== undefined && repairGold !== undefined && (
        <div style={{ ...rowStyle, marginBottom: 8, borderColor: "rgba(201,165,74,0.4)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Repair {itemName(self.weaponId)}</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Restores full durability (drains when you die)</div>
          </div>
          <button onClick={() => zoneStore.sendCraft(REPAIR_WEAPON_ID)} disabled={!inRange || gold < repairGold} style={forgeBtn(inRange && gold >= repairGold)}>
            🪙 {repairGold}
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "50vh", overflowY: "auto" }}>
        {FORGE_RECIPES.map((recipe) => {
          const out = itemDef(recipe.output);
          const haveMats = recipe.inputs.every((i) => (have[i.itemId] ?? 0) >= i.count);
          const enabled = inRange && haveMats && gold >= recipe.goldCost;
          return (
            <div key={recipe.id} style={rowStyle}>
              <div {...tooltipHandlers(() => <ItemCard itemId={recipe.output} />)} style={{ ...iconStyle, borderColor: rarityColor(out?.rarity ?? "") }}>
                <ItemGlyph itemId={recipe.output} size={22} />
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
              <button onClick={() => zoneStore.sendCraft(recipe.id)} disabled={!enabled} title={haveMats ? undefined : "Missing materials"} style={forgeBtn(enabled)}>
                🪙 {recipe.goldCost}
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
function forgeBtn(enabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.14)",
    background: enabled ? "#b45309" : "#1f2937",
    color: enabled ? "#fff" : "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontWeight: 700,
    cursor: enabled ? "pointer" : "default",
    whiteSpace: "nowrap",
  };
}
