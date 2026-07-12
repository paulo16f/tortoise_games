// Character select / create screen. Lists the account's characters (up to 5)
// with their persistent level, lets you create or delete, and enters the game
// by starting a run for the chosen character. All backend calls go through
// withAuth so an expired access token is silently refreshed.

import { useEffect, useState } from "react";
import { levelForTotalXp } from "@depthbreaker/sim";
import { CLASS_META, type ClassId } from "@depthbreaker/protocol";
import { REALTIME_URL } from "../config";
import {
  createCharacter,
  deleteCharacter,
  listCharacters,
  startRun,
  type CharacterSummary,
} from "../net/backend";
import { connectToZone } from "../net/room";
import { clearSession, useSession, withAuth } from "../net/session";
import { logout as apiLogout } from "../net/backend";

const CLASSES: { id: ClassId; label: string; blurb: string }[] = (
  ["knight", "reaper", "cleric", "necromancer"] as ClassId[]
).map((id) => ({ id, label: CLASS_META[id].label, blurb: `${CLASS_META[id].role} — ${CLASS_META[id].blurb}` }));
const MAX_CHARACTERS = 5;

export function CharacterSelect({ onEnterGame }: { onEnterGame: () => void }) {
  const session = useSession();
  const [chars, setChars] = useState<CharacterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newClass, setNewClass] = useState<ClassId>("knight");

  const refreshList = async () => {
    try {
      setChars(await withAuth(listCharacters));
    } catch (e) {
      setError(msg(e));
    }
  };

  useEffect(() => {
    void refreshList();
  }, []);

  const nameValid = /^[A-Za-z][A-Za-z0-9 _-]*$/.test(newName.trim()) && newName.trim().length >= 3 && newName.trim().length <= 20;

  const doCreate = async () => {
    if (!nameValid) return;
    setBusy(true);
    setError(null);
    try {
      await withAuth((t) => createCharacter(t, newName.trim(), newClass));
      setCreating(false);
      setNewName("");
      await refreshList();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (c: CharacterSummary) => {
    if (!window.confirm(`Delete ${c.name}? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await withAuth((t) => deleteCharacter(t, c.id));
      await refreshList();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const play = async (c: CharacterSummary) => {
    setBusy(true);
    setError(null);
    try {
      const run = await withAuth((t) => startRun(t, c.id));
      await connectToZone({
        url: run.wsUrl || REALTIME_URL,
        ticket: run.joinTicket,
        name: c.name,
        classId: c.class_id as ClassId,
      });
      onEnterGame();
    } catch (e) {
      setError(msg(e));
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await apiLogout();
    } catch {
      /* best effort */
    }
    clearSession();
  };

  const atLimit = (chars?.length ?? 0) >= MAX_CHARACTERS;

  return (
    <div style={screen}>
      <div style={{ width: 460 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 26 }}>Your Characters</h1>
          <button onClick={signOut} style={linkBtn} title={session?.kind === "guest" ? "Guest session" : session?.accountId}>
            {session?.kind === "guest" ? "Guest — sign out" : "Sign out"}
          </button>
        </div>

        {error && <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {chars === null && !error && <div style={{ opacity: 0.6 }}>Loading…</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {chars?.map((c) => (
            <div key={c.id} style={row}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{c.name}</div>
                <div style={{ opacity: 0.65, fontSize: 12 }}>
                  {c.class_id} · Lv {levelForTotalXp(c.total_xp ?? 0)}
                </div>
              </div>
              <button onClick={() => play(c)} disabled={busy} style={playBtn}>
                Play
              </button>
              <button onClick={() => doDelete(c)} disabled={busy} title="Delete" style={deleteBtn}>
                ✕
              </button>
            </div>
          ))}

          {chars && !atLimit && !creating && (
            <button onClick={() => setCreating(true)} style={newBtn}>
              ＋ New character
            </button>
          )}
          {atLimit && !creating && <div style={{ opacity: 0.5, fontSize: 12 }}>Character slots full ({MAX_CHARACTERS}).</div>}
        </div>

        {creating && (
          <div style={{ ...row, flexDirection: "column", alignItems: "stretch", gap: 10, marginTop: 10 }}>
            <input
              placeholder="name (3–20)"
              value={newName}
              maxLength={20}
              onChange={(e) => setNewName(e.target.value)}
              style={field}
            />
            <div style={{ display: "flex", gap: 8 }}>
              {CLASSES.map((cl) => {
                const active = cl.id === newClass;
                return (
                  <button
                    key={cl.id}
                    onClick={() => setNewClass(cl.id)}
                    title={cl.blurb}
                    style={{
                      flex: 1,
                      padding: "9px 6px",
                      borderRadius: 8,
                      border: active ? "1px solid #3b82f6" : "1px solid rgba(255,255,255,0.12)",
                      background: active ? "rgba(59,130,246,0.18)" : "#0b0d12",
                      color: "#e6e9ef",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    {cl.label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={doCreate} disabled={!nameValid || busy} style={{ ...playBtn, flex: 1 }}>
                Create
              </button>
              <button onClick={() => setCreating(false)} style={{ ...deleteBtn, width: "auto", padding: "0 14px" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const screen: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "radial-gradient(circle at 50% 30%, #131722, #0b0d12)",
  color: "#e6e9ef",
  fontFamily: "system-ui, sans-serif",
};
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "rgba(17,21,28,0.9)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 10,
  padding: "12px 14px",
};
const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "#0b0d12",
  color: "#e6e9ef",
  fontSize: 14,
};
const playBtn: React.CSSProperties = {
  padding: "9px 18px",
  borderRadius: 8,
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
const deleteBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "#0b0d12",
  color: "#fca5a5",
  cursor: "pointer",
};
const newBtn: React.CSSProperties = {
  padding: "12px",
  borderRadius: 10,
  border: "1px dashed rgba(255,255,255,0.2)",
  background: "transparent",
  color: "#93c5fd",
  cursor: "pointer",
  fontSize: 14,
};
const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#93c5fd",
  fontSize: 13,
  cursor: "pointer",
};

function msg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("character_limit_reached")) return "You already have 5 characters.";
  if (m.includes("not_authenticated") || m.includes("401")) return "Session expired — please sign in again.";
  if (m.includes("Failed to fetch")) return "Can't reach the server. Is the backend running?";
  return "Something went wrong. Try again.";
}
