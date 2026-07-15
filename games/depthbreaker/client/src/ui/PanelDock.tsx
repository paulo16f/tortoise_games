// Right-edge vertical dock of icon buttons — one per openable panel. Each button
// calls the SAME external-store toggle the keyboard shortcut uses, so click and
// hotkey stay in sync, and subscribes to that store to highlight when its panel
// is open. Adding a future panel (e.g. Market) is one entry in DOCK_ITEMS.

import { toggleInventory, useInventoryOpen } from "./InventoryPanel";
import { toggleSkillBook, useSkillBookOpen } from "./SkillBookPanel";
import { toggleMarket, useMarketOpen } from "./MarketPanel";
import { toggleStash, useStashOpen } from "./StashPanel";
import { toggleDailies, useDailiesOpen } from "./DailyQuestPanel";
import { toggleTrade, useTradeOpen } from "./TradePanel";
import { toggleSpinner, useSpinnerOpen } from "./SpinnerPanel";
import { toggleCooking, useCookingOpen } from "./CookingPanel";
import { tooltipHandlers } from "./Tooltip";

interface DockItem {
  icon: string;
  label: string;
  hotkey: string;
  toggle: () => void;
  useOpen: () => boolean;
}

// icon: a Dark Fantasy pack sprite under /ui/synty/icons/ (leading slash);
// anything else renders as text (emoji fallback while a sprite is unmapped).
const DOCK_ITEMS: DockItem[] = [
  { icon: "/ui/synty/icons/dock_bag.png", label: "Inventory", hotkey: "B", toggle: toggleInventory, useOpen: useInventoryOpen },
  { icon: "/ui/synty/icons/dock_skillbook.png", label: "Skill Book", hotkey: "K", toggle: toggleSkillBook, useOpen: useSkillBookOpen },
  { icon: "/ui/synty/icons/dock_market.png", label: "Market", hotkey: "M", toggle: toggleMarket, useOpen: useMarketOpen },
  { icon: "/ui/synty/icons/dock_trade.png", label: "Trading Post", hotkey: "T", toggle: toggleTrade, useOpen: useTradeOpen },
  { icon: "/ui/synty/icons/dock_bank.png", label: "Bank", hotkey: "N", toggle: toggleStash, useOpen: useStashOpen },
  { icon: "/ui/synty/icons/dock_cooking.png", label: "Cooking", hotkey: "F", toggle: toggleCooking, useOpen: useCookingOpen },
  { icon: "/ui/synty/icons/dock_dailies.png", label: "Daily Quests", hotkey: "J", toggle: toggleDailies, useOpen: useDailiesOpen },
  { icon: "/ui/synty/icons/dock_spinner.png", label: "Fortune Wheel", hotkey: "G", toggle: toggleSpinner, useOpen: useSpinnerOpen },
];

function DockButton({ item }: { item: DockItem }) {
  const open = item.useOpen();
  return (
    <button
      onClick={item.toggle}
      aria-label={`${item.label} (${item.hotkey})`}
      {...tooltipHandlers(() => (
        <span>
          <b>{item.label}</b> <span style={{ opacity: 0.6 }}>({item.hotkey})</span>
        </span>
      ))}
      style={{
        // Diablo-themed dock button: dark well, gold rim that lights on open.
        position: "relative",
        width: 44,
        height: 44,
        borderRadius: 8,
        border: `1px solid ${open ? "#e8c874" : "rgba(201,165,74,0.4)"}`,
        background: open
          ? "linear-gradient(180deg, rgba(201,165,74,0.28), rgba(10,11,15,0.92))"
          : "linear-gradient(180deg, rgba(30,34,44,0.92), rgba(8,9,13,0.95))",
        boxShadow: open ? "0 0 8px rgba(201,165,74,0.45)" : "inset 0 1px 0 rgba(255,255,255,0.05)",
        color: "#f1e9d0",
        fontSize: 20,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        pointerEvents: "auto",
      }}
    >
      {item.icon.startsWith("/") ? (
        <img src={item.icon} alt="" draggable={false} style={{ width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))", pointerEvents: "none" }} />
      ) : (
        <span aria-hidden>{item.icon}</span>
      )}
      <span
        style={{
          position: "absolute",
          right: 3,
          bottom: 1,
          fontSize: 9,
          fontWeight: 700,
          opacity: 0.75,
          textShadow: "0 1px 2px #000",
        }}
      >
        {item.hotkey}
      </span>
    </button>
  );
}

export function PanelDock() {
  return (
    <div
      style={{
        // A cohesive themed tray down the right edge, hanging below the minimap
        // (wireframe: map top-right, icons column under it).
        position: "absolute",
        right: 12,
        top: 204,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 7px",
        borderRadius: 12,
        background: "linear-gradient(180deg, rgba(16,18,24,0.72), rgba(6,7,10,0.78))",
        border: "1px solid rgba(201,165,74,0.28)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
        backdropFilter: "blur(3px)",
        pointerEvents: "none",
      }}
    >
      {DOCK_ITEMS.map((item) => (
        <DockButton key={item.label} item={item} />
      ))}
    </div>
  );
}
