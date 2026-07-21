// Context-sensitive game cursors: ⚔️ over enemies, ⛏️ over mining nodes,
// 🪙 over the market stall. Emoji rendered inside an SVG data URI — no image
// assets, works in every Chromium/Firefox build. The current kind is tracked
// so hover churn doesn't rewrite document.body.style every frame.

export type GameCursor = "default" | "attack" | "mine" | "trade";

function emojiCursor(emoji: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><text y='24' font-size='24'>${emoji}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 6 6, pointer`;
}

const CURSORS: Record<GameCursor, string> = {
  default: "auto",
  attack: emojiCursor("⚔️"),
  mine: emojiCursor("⛏️"),
  trade: emojiCursor("🪙"),
};

let current: GameCursor = "default";

export function setGameCursor(kind: GameCursor): void {
  if (kind === current) return;
  current = kind;
  document.body.style.cursor = CURSORS[kind];
}
