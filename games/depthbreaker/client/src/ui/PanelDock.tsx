// Right-edge vertical dock of icon buttons — one per openable panel. Each button
// calls the SAME external-store toggle the keyboard shortcut uses, so click and
// hotkey stay in sync, and subscribes to that store to highlight when its panel
// is open. Adding a future panel (e.g. Market) is one entry in DOCK_ITEMS.

import { toggleInventory, useInventoryOpen } from "./InventoryPanel";
import { toggleSkillBook, useSkillBookOpen } from "./SkillBookPanel";
import { toggleMarket, useMarketOpen } from "./MarketPanel";
import { toggleStash, useStashOpen } from "./StashPanel";
import { toggleDailies, useDailiesOpen } from "./DailyQuestPanel";
import { tooltipHandlers } from "./Tooltip";

interface DockItem {
  icon: string;
  label: string;
  hotkey: string;
  toggle: () => void;
  useOpen: () => boolean;
}

const DOCK_ITEMS: DockItem[] = [
  { icon: "🎒", label: "Bag", hotkey: "B", toggle: toggleInventory, useOpen: useInventoryOpen },
  { icon: "📖", label: "Skill Book", hotkey: "K", toggle: toggleSkillBook, useOpen: useSkillBookOpen },
  { icon: "🏪", label: "Market", hotkey: "M", toggle: toggleMarket, useOpen: useMarketOpen },
  { icon: "🏦", label: "Bank", hotkey: "N", toggle: toggleStash, useOpen: useStashOpen },
  { icon: "📜", label: "Daily Quests", hotkey: "J", toggle: toggleDailies, useOpen: useDailiesOpen },
];

function DockButton({ item }: { item: DockItem }) {
  const open = item.useOpen();
  return (
    <button
      onClick={item.toggle}
      {...tooltipHandlers(() => (
        <span>
          <b>{item.label}</b> <span style={{ opacity: 0.6 }}>({item.hotkey})</span>
        </span>
      ))}
      style={{
        position: "relative",
        width: 46,
        height: 46,
        borderRadius: 10,
        border: `1px solid ${open ? "rgba(147,197,253,0.9)" : "rgba(255,255,255,0.14)"}`,
        background: open ? "rgba(14,116,144,0.55)" : "rgba(11,13,18,0.82)",
        color: "#f8fafc",
        fontSize: 20,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(4px)",
        pointerEvents: "auto",
      }}
    >
      <span aria-hidden>{item.icon}</span>
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
        position: "absolute",
        right: 16,
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {DOCK_ITEMS.map((item) => (
        <DockButton key={item.label} item={item} />
      ))}
    </div>
  );
}
