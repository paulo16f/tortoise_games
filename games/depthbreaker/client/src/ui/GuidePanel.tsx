// "How it works" guide (toggled with H). New players — and playtesters — kept
// missing what the game IS: what to do, how gold works, and where the token
// fits. One always-available panel answers that in plain language. Same
// external-store toggle pattern as the other panels.

import { useState, useSyncExternalStore } from "react";
import { framedPanel, frameTitle } from "./frames";
import { useDraggablePanel } from "./useDraggablePanel";
import { PanelClose } from "./PanelClose";

let guideOpen = false;
const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}
export function toggleGuide(): void {
  guideOpen = !guideOpen;
  emit();
}
export function closeGuide(): void {
  if (!guideOpen) return;
  guideOpen = false;
  emit();
}
export function useGuideOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => guideOpen,
  );
}

type Section = "play" | "gold" | "token";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "play", label: "How to Play" },
  { id: "gold", label: "Gold" },
  { id: "token", label: "Token" },
];

const CONTENT: Record<Section, { title: string; lines: string[] }[]> = {
  play: [
    {
      title: "Goal",
      lines: [
        "Fight through three leveled zones — Goblin Warrens (Lv 1–10), The Bonefields (10–20), Infernal Reach (20–40) — and take on the Coliseum champion, which grows stronger every time it's slain.",
      ],
    },
    {
      title: "Basics",
      lines: [
        "Click the ground to move · click an enemy to attack.",
        "Keys 1–0 use your skill bar (press K for the full skill book).",
        "Rest inside the stone circle at spawn to heal.",
        "Mine crystal/iron nodes; click open water from the shore to fish; cook food at the Bakery.",
        "Dying is cheap: you respawn at the fountain after a few seconds.",
      ],
    },
    {
      title: "Progression",
      lines: [
        "Kills grant XP → levels unlock skills. The banner when entering an area shows its level range — red warning means the monsters out-level you.",
        "Endgame: the Coliseum champion. Every time it's slain its TIER rises and it re-forms stronger — how high your party pushes the tier is the real bragging metric.",
        "Beyond Tier 5 the champion demands a TRIAL KEY: forge one from champion materials and carry it into the arena.",
      ],
    },
    {
      title: "Gear wears out",
      lines: [
        "Mining needs a pickaxe, fishing a rod — each use drains the tool until it breaks (you start with both).",
        "Dying chips your weapon's durability. Repair at the Forge (O) before it shatters!",
      ],
    },
  ],
  gold: [
    {
      title: "Kills pay MATERIALS, quests pay gold",
      lines: [
        "Enemies drop their zone's materials — goblin hides, bone shards, demon essences. Bosses drop the rare tiers.",
        "Gold is scarce: Daily Quests (J), the daily Fortune Wheel (G), and selling materials at the Market (M).",
      ],
    },
    {
      title: "The Forge (O) — where materials become power",
      lines: [
        "Smith weapons, better tools and Trial Keys from materials + a gold fee.",
        "Repair your worn weapon there — worn gear can't be banked or traded.",
      ],
    },
    {
      title: "Spending gold",
      lines: [
        "Market (M): potions, food, starter tools, weapons, skins.",
        "Trading Post (T): buy items other players listed — and list yours.",
        "Bank (N): stash items between runs (pristine gear only).",
      ],
    },
  ],
  token: [
    {
      title: "The one rule",
      lines: [
        "The game only ever creates GOLD. It never creates or pays out tokens — that keeps the economy safe from exploits.",
      ],
    },
    {
      title: "How gold becomes token",
      lines: [
        "Trading Post (T) → Gold Exchange tab: list your gold at your own price.",
        "Another PLAYER buys it, paying tokens from their own wallet: 95% goes to you, 5% to the game treasury.",
        "So your playtime → gold → token, with the price set by players, not by the game.",
      ],
    },
    {
      title: "Status in this test build",
      lines: [
        "Listing and cancelling gold works today. The on-chain BUY side is disabled until the Solana launch — so in this playtest, treat the Gold Exchange as a preview.",
      ],
    },
  ],
};

export function GuidePanel() {
  const open = useGuideOpen();
  const [section, setSection] = useState<Section>("play");
  const { position, dragHandlers } = useDraggablePanel("guide", () => ({
    x: Math.max(16, window.innerWidth / 2 - 240),
    y: 80,
  }));
  if (!open) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        ...framedPanel,
        width: 480,
        maxWidth: "92vw",
        padding: 14,
        color: "#e6e9ef",
        fontFamily: "system-ui, sans-serif",
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <div
        {...dragHandlers}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, ...dragHandlers.style }}
      >
        <span style={frameTitle}>Guide</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>H / Esc</span>
          <PanelClose onClose={closeGuide} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              padding: "5px 12px",
              borderRadius: 7,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              border: `1px solid ${section === s.id ? "#e8c874" : "rgba(201,165,74,0.35)"}`,
              background: section === s.id ? "linear-gradient(180deg, rgba(201,165,74,0.25), rgba(10,11,15,0.9))" : "rgba(11,13,18,0.6)",
              color: section === s.id ? "#f6e7bd" : "#cbd5e1",
              pointerEvents: "auto",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 380, overflowY: "auto", paddingRight: 4 }}>
        {CONTENT[section].map((block) => (
          <div key={block.title}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: "#c9a54a", textTransform: "uppercase", marginBottom: 4 }}>
              {block.title}
            </div>
            {block.lines.map((line, i) => (
              <div key={i} style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.92, marginBottom: 3 }}>
                • {line}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
