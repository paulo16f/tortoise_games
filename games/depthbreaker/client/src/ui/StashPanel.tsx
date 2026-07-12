// Persistent bank/stash panel (toggled by clicking the stall's bank, the dock
// icon, or the hotkey). Two grids: your run bag (left) and your persistent
// stash (right). Click an item to move one unit across. Stash contents are
// account-persistent and arrive via the targeted ServerMessage.Stash; the
// server range-checks the stall on every op. Same external-store + drag-hook +
// tooltip pattern as the other panels.

import { ItemGlyph } from "./ItemGlyph";
import { useSyncExternalStore } from "react";
import { itemDef } from "@depthbreaker/sim";
import type { ItemSlotView } from "@depthbreaker/protocol";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { rarityColor, itemInitials } from "./itemDisplay";
import { useDraggablePanel } from "./useDraggablePanel";
import { tooltipHandlers } from "./Tooltip";
import { ItemCard } from "./ItemCard";
import { PanelClose } from "./PanelClose";

let stashOpen = false;
const openListeners = new Set<() => void>();
function emitOpen(): void {
  for (const fn of openListeners) fn();
}
export function toggleStash(): void {
  stashOpen = !stashOpen;
  emitOpen();
}
export function closeStash(): void {
  if (!stashOpen) return;
  stashOpen = false;
  emitOpen();
}
function subscribeOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}
function useStashOpenInternal(): boolean {
  return useSyncExternalStore(subscribeOpen, () => stashOpen);
}
export const useStashOpen = useStashOpenInternal;

function SlotBox({
  itemId,
  count,
  rarity,
  action,
  onClick,
}: {
  itemId: string;
  count: number;
  rarity: string;
  action: string;
  onClick: () => void;
}) {
  const empty = !itemId || count <= 0;
  return (
    <div
      onClick={empty ? undefined : onClick}
      {...(empty ? {} : tooltipHandlers(() => <ItemCard itemId={itemId} count={count} action={action} />))}
      style={{
        position: "relative",
        width: 46,
        height: 46,
        borderRadius: 8,
        border: `1px solid ${empty ? "rgba(255,255,255,0.08)" : rarityColor(rarity)}`,
        background: empty ? "rgba(11,13,18,0.5)" : "rgba(15,23,42,0.9)",
        display: "grid",
        placeItems: "center",
        fontSize: 12,
        fontWeight: 800,
        color: "#f8fafc",
        cursor: empty ? "default" : "pointer",
      }}
    >
      {!empty && <ItemGlyph itemId={itemId} />}
      {!empty && count > 1 && (
        <span style={{ position: "absolute", right: 3, bottom: 1, fontSize: 10, fontWeight: 700, textShadow: "0 1px 2px #000" }}>
          {count}
        </span>
      )}
    </div>
  );
}

export function StashPanel() {
  const open = useStashOpenInternal();
  const snap = useZoneState();
  const { position, dragHandlers } = useDraggablePanel("stash", () => ({
    x: Math.max(16, window.innerWidth / 2 - 230),
    y: 90,
  }));
  if (!open || !snap.self) return null;

  const bag = snap.self.inventory;
  const stash = snap.stash.items;

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
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
        <b>Bank</b>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>click to move · persists</span>
          <PanelClose onClose={closeStash} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 14 }}>
        <div>
          <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6 }}>Bag → deposit</div>
          <Grid>
            {bag.map((slot: ItemSlotView, i) =>
              slot.itemId && slot.count > 0 ? (
                <SlotBox
                  key={i}
                  itemId={slot.itemId}
                  count={slot.count}
                  rarity={slot.rarity}
                  action="Click to deposit one"
                  onClick={() => zoneStore.sendStashDeposit(i)}
                />
              ) : (
                <SlotBox key={i} itemId="" count={0} rarity="" action="" onClick={() => {}} />
              ),
            )}
          </Grid>
        </div>

        <div>
          <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6 }}>
            Bank → withdraw <span style={{ opacity: 0.5 }}>({stash.length}/{snap.stash.slotCap})</span>
          </div>
          <Grid>
            {stash.map((entry) => {
              const def = itemDef(entry.itemId);
              return (
                <SlotBox
                  key={entry.itemId}
                  itemId={entry.itemId}
                  count={entry.count}
                  rarity={def?.rarity ?? ""}
                  action="Click to withdraw one"
                  onClick={() => zoneStore.sendStashWithdraw(entry.itemId)}
                />
              );
            })}
            {stash.length === 0 && <div style={{ opacity: 0.45, fontSize: 12, gridColumn: "1 / -1" }}>Empty.</div>}
          </Grid>
        </div>
      </div>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 46px)", gap: 6, minWidth: 4 * 46 + 3 * 6 }}>{children}</div>;
}
