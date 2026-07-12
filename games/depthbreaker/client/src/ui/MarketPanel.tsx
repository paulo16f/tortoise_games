// Market panel (toggled by clicking the stall, the dock icon, or M). Buy tab
// sells the shared MARKET_STOCK at item-def prices; Sell tab lists bag items
// with a sellValue. All prices are display-only — the server re-derives them
// and range-checks the stall, so this panel can never set a price. Same
// external-store pattern as InventoryPanel.

import { framedPanel, frameTitle } from "./frames";
import { ItemGlyph } from "./ItemGlyph";
import { useState, useSyncExternalStore } from "react";
import { itemDef, SKIN_CATALOG } from "@depthbreaker/sim";
import { MARKET_STOCK, MARKET_RANGE, buildDungeon } from "@depthbreaker/protocol";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { localPlayerPos } from "../game/entityRefs";
import { rarityColor, itemInitials } from "./itemDisplay";
import { useDraggablePanel } from "./useDraggablePanel";
import { tooltipHandlers } from "./Tooltip";
import { ItemCard } from "./ItemCard";
import { PanelClose } from "./PanelClose";

let marketOpen = false;
const openListeners = new Set<() => void>();
function emitOpen(): void {
  for (const fn of openListeners) fn();
}
export function toggleMarket(): void {
  marketOpen = !marketOpen;
  emitOpen();
}
export function closeMarket(): void {
  if (!marketOpen) return;
  marketOpen = false;
  emitOpen();
}
function subscribeOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}
function useMarketOpenInternal(): boolean {
  return useSyncExternalStore(subscribeOpen, () => marketOpen);
}
/** Read-only subscription for other UI (e.g. the panel dock highlight). */
export const useMarketOpen = useMarketOpenInternal;

function GoldChip({ amount }: { amount: number }) {
  return (
    <span style={{ color: "#fbbf24", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>🪙 {amount}</span>
  );
}

export function MarketPanel() {
  const open = useMarketOpenInternal();
  const snap = useZoneState();
  const [tab, setTab] = useState<"buy" | "sell" | "skins">("buy");
  const { position, dragHandlers } = useDraggablePanel("market", () => ({ x: 16, y: 72 }));
  if (!open || !snap.self) return null;
  const self = snap.self;
  const gold = self.gold ?? 0;

  // Distance hint — the stall position is deterministic from the synced seed.
  const stall = buildDungeon(snap.seed, snap.depth).marketStall;
  const distance = Math.hypot(localPlayerPos.x - stall.x, localPlayerPos.z - stall.z);
  const inRange = distance <= MARKET_RANGE;

  const sellables = self.inventory
    .map((slot, index) => ({ slot, index, def: slot.itemId ? itemDef(slot.itemId) : undefined }))
    .filter((e) => e.slot.count > 0 && (e.def?.sellValue ?? 0) > 0);

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: 300,
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
        <span style={frameTitle}>Market</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GoldChip amount={gold} />
          <PanelClose onClose={closeMarket} />
        </div>
      </div>

      {!inRange && (
        <div style={{ color: "#fbbf24", fontSize: 12, marginBottom: 8 }}>
          Walk to the market stall to trade.
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["buy", "sell", "skins"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "7px 0",
              borderRadius: 8,
              border: tab === t ? "1px solid #3b82f6" : "1px solid rgba(255,255,255,0.12)",
              background: tab === t ? "rgba(59,130,246,0.18)" : "#0b0d12",
              color: "#e6e9ef",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t === "buy" ? "Buy" : t === "sell" ? "Sell" : "Skins"}
          </button>
        ))}
      </div>

      {tab === "skins" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "48vh", overflowY: "auto" }}>
          <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 2 }}>Cosmetic only — no combat effect.</div>
          {SKIN_CATALOG.map((skin) => {
            const owned = snap.skins.owned.includes(skin.id);
            const equipped = snap.skins.equipped === skin.id;
            const affordable = gold >= skin.price;
            return (
              <div key={skin.id} style={rowStyle}>
                <div style={{ ...iconStyle, borderColor: "rgba(147,197,253,0.6)" }}>🎭</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{skin.name}</div>
                  <div style={{ opacity: 0.6, fontSize: 11 }}>{owned ? "owned" : "cosmetic skin"}</div>
                </div>
                {equipped ? (
                  <span style={{ color: "#4ade80", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>Equipped</span>
                ) : owned ? (
                  <button onClick={() => zoneStore.sendEquipSkin(skin.id)} disabled={!inRange} style={tradeBtn(inRange)}>
                    Equip
                  </button>
                ) : (
                  <button
                    onClick={() => zoneStore.sendBuySkin(skin.id)}
                    disabled={!inRange || !affordable}
                    title={affordable ? undefined : "Not enough gold"}
                    style={tradeBtn(inRange && affordable)}
                  >
                    🪙 {skin.price}
                  </button>
                )}
              </div>
            );
          })}
          {snap.skins.equipped !== "" && (
            <button onClick={() => zoneStore.sendEquipSkin("")} disabled={!inRange} style={{ ...tradeBtn(inRange), alignSelf: "flex-start" }}>
              Revert to default
            </button>
          )}
        </div>
      ) : tab === "buy" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "48vh", overflowY: "auto" }}>
          {MARKET_STOCK.map((itemId) => {
            const def = itemDef(itemId);
            if (!def?.buyValue) return null;
            const affordable = gold >= def.buyValue;
            const enabled = inRange && affordable;
            return (
              <div key={itemId} style={rowStyle} {...tooltipHandlers(() => (
                <ItemCard itemId={itemId} action={affordable ? "Click the price to buy" : "Not enough gold"} />
              ))}>
                <div style={{ ...iconStyle, borderColor: rarityColor(def.rarity) }}><ItemGlyph itemId={itemId} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{def.name}</div>
                  <div style={{ opacity: 0.6, fontSize: 11 }}>
                    {def.kind}
                    {def.attack ? ` · +${def.attack} atk` : ""}
                  </div>
                </div>
                <button onClick={() => zoneStore.sendBuy(itemId)} disabled={!enabled} style={tradeBtn(enabled)}>
                  🪙 {def.buyValue}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "48vh", overflowY: "auto" }}>
          {sellables.length === 0 && <div style={{ opacity: 0.55, fontSize: 12 }}>Nothing sellable in your bag.</div>}
          {sellables.map(({ slot, index, def }) => (
            <div key={index} style={rowStyle} {...tooltipHandlers(() => (
              <ItemCard itemId={slot.itemId} count={slot.count} action="Click the price to sell one" />
            ))}>
              <div style={{ ...iconStyle, borderColor: rarityColor(slot.rarity) }}><ItemGlyph itemId={slot.itemId} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {def!.name}
                  {slot.count > 1 && <span style={{ opacity: 0.6, fontWeight: 400 }}> ×{slot.count}</span>}
                </div>
                <div style={{ opacity: 0.6, fontSize: 11 }}>{def!.kind}</div>
              </div>
              <button onClick={() => zoneStore.sendSell(index)} disabled={!inRange} style={tradeBtn(inRange)}>
                +🪙 {def!.sellValue}
              </button>
            </div>
          ))}
        </div>
      )}
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
function tradeBtn(enabled: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.14)",
    background: enabled ? "#1d4ed8" : "#1f2937",
    color: enabled ? "#fff" : "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontWeight: 700,
    cursor: enabled ? "pointer" : "default",
    whiteSpace: "nowrap",
  };
}
