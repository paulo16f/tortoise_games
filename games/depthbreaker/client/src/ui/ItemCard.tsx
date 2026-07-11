// Shared item tooltip card, used by the bag and the market (and any future
// stash/vendor UI). Pure render helper for the singleton TooltipLayer.

import { itemDef } from "@depthbreaker/sim";
import { rarityColor } from "./itemDisplay";

export function ItemCard({ itemId, count, action }: { itemId: string; count?: number; action?: string }) {
  const def = itemDef(itemId);
  if (!def) return <span>{itemId}</span>;
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, color: rarityColor(def.rarity), marginBottom: 2 }}>
        {def.name}
        {count !== undefined && count > 1 && <span style={{ opacity: 0.6, fontWeight: 400 }}> ×{count}</span>}
      </div>
      <div style={{ opacity: 0.65 }}>
        {def.rarity} {def.kind}
      </div>
      {(def.attack ?? 0) > 0 && <div style={{ color: "#f87171" }}>+{def.attack} attack</div>}
      {(def.healFraction ?? 0) > 0 && <div style={{ color: "#4ade80" }}>Restores {Math.round(def.healFraction! * 100)}% health</div>}
      {(def.buyValue !== undefined || def.sellValue !== undefined) && (
        <div style={{ opacity: 0.7, marginTop: 4 }}>
          {def.buyValue !== undefined && <span>buy 🪙 {def.buyValue} </span>}
          {def.sellValue !== undefined && <span>sell 🪙 {def.sellValue}</span>}
        </div>
      )}
      {action && <div style={{ color: "#93c5fd", marginTop: 4 }}>{action}</div>}
    </div>
  );
}
