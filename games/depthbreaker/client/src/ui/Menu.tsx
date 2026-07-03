// HTML menu overlay: name input, class picker, Play button, dev note.

import { useState } from "react";
import type { ClassId } from "@depthbreaker/protocol";

const CLASSES: { id: ClassId; label: string; blurb: string }[] = [
  { id: "bruiser", label: "Bruiser", blurb: "Melee. High HP." },
  { id: "mage", label: "Mage", blurb: "Ranged burst." },
  { id: "warden", label: "Warden", blurb: "Sustain / support." },
];

interface MenuProps {
  connecting: boolean;
  error: string | null;
  onPlay: (name: string, classId: ClassId) => void;
}

export function Menu({ connecting, error, onPlay }: MenuProps) {
  const [name, setName] = useState("Adventurer");
  const [classId, setClassId] = useState<ClassId>("bruiser");

  const trimmed = name.trim();
  const nameValid = /^[A-Za-z][A-Za-z0-9 _-]*$/.test(trimmed) && trimmed.length >= 3 && trimmed.length <= 20;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 50% 30%, #131722, #0b0d12)",
        color: "#e6e9ef",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: 380,
          background: "rgba(17,21,28,0.9)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        <h1 style={{ margin: "0 0 4px", fontSize: 28, letterSpacing: 0.5 }}>
          Depthbreaker
        </h1>
        <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 20 }}>
          Dev build — Phase 0 vertical slice
        </div>

        <label style={{ display: "block", fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${nameValid ? "rgba(255,255,255,0.15)" : "#b91c1c"}`,
            background: "#0b0d12",
            color: "#e6e9ef",
            fontSize: 14,
            marginBottom: 6,
          }}
        />
        <div style={{ fontSize: 11, opacity: 0.55, minHeight: 14, marginBottom: 14 }}>
          {nameValid ? "" : "3–20 chars, start with a letter"}
        </div>

        <label style={{ display: "block", fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
          Class
        </label>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {CLASSES.map((c) => {
            const active = c.id === classId;
            return (
              <button
                key={c.id}
                onClick={() => setClassId(c.id)}
                title={c.blurb}
                style={{
                  flex: 1,
                  padding: "10px 6px",
                  borderRadius: 8,
                  border: active ? "1px solid #3b82f6" : "1px solid rgba(255,255,255,0.12)",
                  background: active ? "rgba(59,130,246,0.18)" : "#0b0d12",
                  color: "#e6e9ef",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {error && (
          <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}

        <button
          disabled={connecting || !nameValid}
          onClick={() => onPlay(trimmed, classId)}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 8,
            border: "none",
            background: connecting || !nameValid ? "#334155" : "#3b82f6",
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: connecting || !nameValid ? "default" : "pointer",
          }}
        >
          {connecting ? "Connecting…" : "Play"}
        </button>
      </div>
    </div>
  );
}
