// World chat: an always-on log + input in the bottom-left. Lines arrive via the
// broadcast ServerMessage.Chat (server rate-limits + length-caps). Pressing
// Enter or C focuses the input; while it's focused, useControls suppresses game
// keys (isTypingTarget), so typing "wasd" chats instead of moving. Focus also
// clears any held movement keys so the character stops when you start typing.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { controlState } from "../game/input/controls";

// Module-level handle so the keybind (useControls) can focus the input without
// prop drilling — mirrors the toggle-function pattern the panels use.
let inputEl: HTMLInputElement | null = null;
export function focusChat(): void {
  inputEl?.focus();
}

// Reactive focus flag so the panel dock can highlight the chat icon while the
// input is active (and so game keys stay suppressed — see isTypingTarget).
let chatFocused = false;
const focusListeners = new Set<() => void>();
function setChatFocused(v: boolean): void {
  if (chatFocused === v) return;
  chatFocused = v;
  for (const fn of focusListeners) fn();
}
export function useChatFocused(): boolean {
  return useSyncExternalStore(
    (fn) => {
      focusListeners.add(fn);
      return () => focusListeners.delete(fn);
    },
    () => chatFocused,
  );
}

export function ChatPanel() {
  const snap = useZoneState();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the log pinned to the newest line.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [snap.chat.length]);

  const send = () => {
    const t = text.trim();
    if (t) zoneStore.sendChat(t);
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // don't let game keybinds see typing
    if (e.key === "Enter") {
      send();
      inputEl?.blur();
    } else if (e.key === "Escape") {
      setText("");
      inputEl?.blur();
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        bottom: 196,
        width: 320,
        maxWidth: "40vw",
        fontFamily: "system-ui, sans-serif",
        color: "#e6e9ef",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <div
        ref={logRef}
        style={{
          maxHeight: 150,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          marginBottom: 6,
          padding: snap.chat.length ? "6px 8px" : 0,
          borderRadius: 8,
          background: snap.chat.length ? "rgba(11,13,18,0.55)" : "transparent",
          backdropFilter: snap.chat.length ? "blur(3px)" : undefined,
          // Log opts into pointer events only when focused so it never eats
          // world clicks during play, but you can scroll it while chatting.
          pointerEvents: focused ? "auto" : "none",
        }}
      >
        {snap.chat.map((line) => (
          <div key={line.id} style={{ fontSize: 12.5, lineHeight: 1.35, textShadow: "0 1px 2px #000" }}>
            <span style={{ color: "#7dd3fc", fontWeight: 700 }}>{line.from}:</span>{" "}
            <span style={{ opacity: 0.92 }}>{line.text}</span>
          </div>
        ))}
      </div>

      <input
        ref={(el) => {
          inputEl = el;
        }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true);
          setChatFocused(true);
          controlState.keys.clear(); // stop moving the moment you start typing
        }}
        onBlur={() => {
          setFocused(false);
          setChatFocused(false);
        }}
        maxLength={200}
        placeholder="Press Enter to chat…"
        aria-label="World chat"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "7px 10px",
          borderRadius: 8,
          border: `1px solid ${focused ? "rgba(147,197,253,0.9)" : "rgba(255,255,255,0.14)"}`,
          background: "rgba(11,13,18,0.82)",
          color: "#f8fafc",
          fontSize: 13,
          outline: "none",
          pointerEvents: "auto",
        }}
      />
    </div>
  );
}
