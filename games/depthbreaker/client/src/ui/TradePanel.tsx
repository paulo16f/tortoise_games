// Player-to-player marketplace (Kintara-style trading post). Toggled by the dock
// 🤝 icon or T. Unlike the NPC Market (fixed prices, gold sink/faucet), this is
// a REST-backed order book: players list items OUT OF THEIR STASH at a chosen
// gold price, and other players buy them — the server settles atomically
// (escrow on list, gold+item swap on buy; see backend/routes/market.ts). After
// any op we call sendRefreshPrivate so the in-game gold/stash re-sync.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { itemDef } from "@depthbreaker/sim";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { withAuth } from "../net/session";
import { marketListings, marketMine, marketList, marketBuy, marketCancel, type MarketListing } from "../net/backend";
import { useDraggablePanel } from "./useDraggablePanel";
import { itemName, itemInitials, rarityColor } from "./itemDisplay";

let tradeOpen = false;
const openListeners = new Set<() => void>();
function emitOpen(): void {
  for (const fn of openListeners) fn();
}
export function toggleTrade(): void {
  tradeOpen = !tradeOpen;
  emitOpen();
}
export function closeTrade(): void {
  if (!tradeOpen) return;
  tradeOpen = false;
  emitOpen();
}
function subscribeOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}
export function useTradeOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, () => tradeOpen);
}

type Tab = "browse" | "sell" | "mine";

export function TradePanel() {
  const open = useTradeOpen();
  const snap = useZoneState();
  const { position, dragHandlers } = useDraggablePanel("trade", () => ({
    x: Math.max(16, window.innerWidth / 2 - 180),
    y: 80,
  }));

  const [tab, setTab] = useState<Tab>("browse");
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [mine, setMine] = useState<MarketListing[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const gold = snap.self?.gold ?? 0;

  const reload = useCallback(async () => {
    setError("");
    try {
      const [all, ours] = await withAuth(async (token) => Promise.all([marketListings(token), marketMine(token)]));
      setListings(all);
      setMine(ours);
    } catch {
      setError("Trading needs a signed-in account.");
    }
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const act = async (fn: (token: string) => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await withAuth(fn);
      zoneStore.sendRefreshPrivate(); // re-sync gold + stash in the live zone
      await reload();
    } catch {
      setError("That action was refused. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: 360,
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
        <b>Trading Post</b>
        <span style={{ color: "#fbbf24", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>🪙 {gold}</span>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["browse", "sell", "mine"] as const).map((t) => (
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
            {t === "browse" ? "Browse" : t === "sell" ? "Sell" : `Mine (${mine.length})`}
          </button>
        ))}
      </div>

      {error && <div style={{ color: "#fbbf24", fontSize: 12, marginBottom: 8 }}>{error}</div>}

      {tab === "browse" && <BrowseTab listings={listings} gold={gold} busy={busy} onBuy={(id) => act((token) => marketBuy(token, id))} />}
      {tab === "sell" && <SellTab stash={snap.stash.items} busy={busy} onList={(itemId, count, price) => act((token) => marketList(token, itemId, count, price))} />}
      {tab === "mine" && <MineTab mine={mine} busy={busy} onCancel={(id) => act((token) => marketCancel(token, id))} />}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "rgba(15,23,42,0.9)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 8,
        padding: "6px 8px",
      }}
    >
      {children}
    </div>
  );
}

function Icon({ itemId }: { itemId: string }) {
  const def = itemDef(itemId);
  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: 6,
        border: `1px solid ${rarityColor(def?.rarity ?? "")}`,
        display: "grid",
        placeItems: "center",
        fontSize: 12,
        fontWeight: 800,
        background: "rgba(11,13,18,0.85)",
        flexShrink: 0,
      }}
    >
      {itemInitials(itemId)}
    </div>
  );
}

function actionBtn(enabled: boolean): React.CSSProperties {
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

const listWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  maxHeight: "46vh",
  overflowY: "auto",
};

function BrowseTab({
  listings,
  gold,
  busy,
  onBuy,
}: {
  listings: MarketListing[];
  gold: number;
  busy: boolean;
  onBuy: (id: string) => void;
}) {
  const others = listings.filter((l) => !l.mine);
  return (
    <div style={listWrap}>
      {others.length === 0 && <div style={{ opacity: 0.55, fontSize: 12 }}>No listings right now. Be the first to sell!</div>}
      {others.map((l) => {
        const affordable = gold >= l.price;
        return (
          <Row key={l.id}>
            <Icon itemId={l.itemId} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {itemName(l.itemId)}
                {l.count > 1 && <span style={{ opacity: 0.6, fontWeight: 400 }}> ×{l.count}</span>}
              </div>
              <div style={{ opacity: 0.6, fontSize: 11 }}>from {l.seller}</div>
            </div>
            <button onClick={() => onBuy(l.id)} disabled={busy || !affordable} title={affordable ? undefined : "Not enough gold"} style={actionBtn(!busy && affordable)}>
              🪙 {l.price}
            </button>
          </Row>
        );
      })}
    </div>
  );
}

function SellTab({
  stash,
  busy,
  onList,
}: {
  stash: { itemId: string; count: number }[];
  busy: boolean;
  onList: (itemId: string, count: number, price: number) => void;
}) {
  return (
    <div style={listWrap}>
      <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 2 }}>List items from your bank for other players to buy.</div>
      {stash.length === 0 && <div style={{ opacity: 0.55, fontSize: 12 }}>Your bank is empty — deposit items at the bank first.</div>}
      {stash.map((entry) => (
        <SellRow key={entry.itemId} itemId={entry.itemId} available={entry.count} busy={busy} onList={onList} />
      ))}
    </div>
  );
}

function SellRow({
  itemId,
  available,
  busy,
  onList,
}: {
  itemId: string;
  available: number;
  busy: boolean;
  onList: (itemId: string, count: number, price: number) => void;
}) {
  const suggested = Math.max(1, (itemDef(itemId)?.sellValue ?? 1) * 2);
  const [count, setCount] = useState(1);
  const [price, setPrice] = useState(suggested);
  const validCount = count >= 1 && count <= available;
  const validPrice = price >= 1;
  const enabled = !busy && validCount && validPrice;
  return (
    <Row>
      <Icon itemId={itemId} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          {itemName(itemId)} <span style={{ opacity: 0.6, fontWeight: 400 }}>({available} in bank)</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <label style={{ fontSize: 11, opacity: 0.7 }}>
            qty
            <input
              type="number"
              min={1}
              max={available}
              value={count}
              onChange={(e) => setCount(Math.floor(Number(e.target.value) || 1))}
              style={numInput}
            />
          </label>
          <label style={{ fontSize: 11, opacity: 0.7 }}>
            🪙 price
            <input type="number" min={1} value={price} onChange={(e) => setPrice(Math.floor(Number(e.target.value) || 1))} style={numInput} />
          </label>
        </div>
      </div>
      <button onClick={() => onList(itemId, count, price)} disabled={!enabled} style={actionBtn(enabled)}>
        List
      </button>
    </Row>
  );
}

function MineTab({ mine, busy, onCancel }: { mine: MarketListing[]; busy: boolean; onCancel: (id: string) => void }) {
  return (
    <div style={listWrap}>
      {mine.length === 0 && <div style={{ opacity: 0.55, fontSize: 12 }}>You have no active listings.</div>}
      {mine.map((l) => (
        <Row key={l.id}>
          <Icon itemId={l.itemId} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {itemName(l.itemId)}
              {l.count > 1 && <span style={{ opacity: 0.6, fontWeight: 400 }}> ×{l.count}</span>}
            </div>
            <div style={{ opacity: 0.6, fontSize: 11 }}>listed for 🪙 {l.price}</div>
          </div>
          <button onClick={() => onCancel(l.id)} disabled={busy} style={actionBtn(!busy)}>
            Cancel
          </button>
        </Row>
      ))}
    </div>
  );
}

const numInput: React.CSSProperties = {
  width: 64,
  marginLeft: 4,
  padding: "3px 6px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(11,13,18,0.85)",
  color: "#f8fafc",
  fontSize: 12,
};
