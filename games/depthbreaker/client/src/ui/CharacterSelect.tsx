// Character select / create — the WoW-style roster screen. A champions list on
// the left, a rotating 3D hero showcase on the right, and a weighty ENTER WORLD
// call-to-action. Creation swaps the showcase footer for a class picker whose
// preview updates live. All backend calls go through withAuth so an expired
// access token is silently refreshed.

import { useEffect, useMemo, useState } from "react";
import { levelForTotalXp } from "@depthbreaker/sim";
import { CLASS_META, type ClassId } from "@depthbreaker/protocol";
import { REALTIME_URL } from "../config";
import {
  createCharacter,
  deleteCharacter,
  listCharacters,
  startRun,
  logout as apiLogout,
  type CharacterSummary,
} from "../net/backend";
import { connectToZone } from "../net/room";
import { clearSession, useSession, withAuth } from "../net/session";
import { MenuBackdrop } from "./menu/MenuBackdrop";
import { CharacterPreview3D } from "./menu/CharacterPreview3D";
import { MENU, framePanel, goldButton, ghostButton, menuField, menuScreen, linkButton, goldRule } from "./menu/menuTheme";

const CLASS_ORDER: ClassId[] = ["knight", "reaper", "cleric", "necromancer"];
const CLASS_GLYPH: Record<ClassId, string> = { knight: "🛡️", reaper: "⚔️", cleric: "✨", necromancer: "💀" };
const MAX_CHARACTERS = 5;

export function CharacterSelect({ onEnterGame }: { onEnterGame: () => void }) {
  const session = useSession();
  const [chars, setChars] = useState<CharacterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newClass, setNewClass] = useState<ClassId>("knight");
  const [newVariant, setNewVariant] = useState<"a" | "b">("a");

  const refreshList = async (selectId?: string) => {
    try {
      const list = await withAuth(listCharacters);
      setChars(list);
      setSelectedId((cur) => selectId ?? (list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch (e) {
      setError(msg(e));
    }
  };

  useEffect(() => {
    void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(() => chars?.find((c) => c.id === selectedId) ?? null, [chars, selectedId]);
  const previewClass: ClassId = creating ? newClass : ((selected?.class_id as ClassId) ?? "knight");
  const VARIANT_B_SKIN: Record<ClassId, string> = { knight: "knight_f", cleric: "warden_m", reaper: "reaper_b", necromancer: "necro_b" };
  const previewSkin = creating && newVariant === "b" ? VARIANT_B_SKIN[newClass] : (selected?.skin_id ?? "");
  const nameValid = /^[A-Za-z][A-Za-z0-9 _-]*$/.test(newName.trim()) && newName.trim().length >= 3 && newName.trim().length <= 20;
  const atLimit = (chars?.length ?? 0) >= MAX_CHARACTERS;

  const doCreate = async () => {
    if (!nameValid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await withAuth((t) => createCharacter(t, newName.trim(), newClass, newVariant));
      setCreating(false);
      setNewName("");
      await refreshList(created?.id);
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
      await connectToZone({ url: run.wsUrl || REALTIME_URL, ticket: run.joinTicket, name: c.name, classId: c.class_id as ClassId });
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

  return (
    <div style={menuScreen}>
      <MenuBackdrop />

      <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 18, width: 960, maxWidth: "94vw", height: 640, maxHeight: "92vh" }}>
        {/* ── Roster ── */}
        <div style={{ ...framePanel, width: 300, display: "flex", flexDirection: "column", padding: 16, boxSizing: "border-box" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontFamily: MENU.display, fontSize: 22, letterSpacing: 2, color: MENU.gold }}>Champions</h2>
            <button onClick={signOut} style={linkButton} title={session?.kind === "guest" ? "Guest session" : session?.accountId}>
              {session?.kind === "guest" ? "Guest ⏻" : "Sign out"}
            </button>
          </div>
          <div style={{ ...goldRule, marginBottom: 10 }} />

          {error && <div style={{ color: MENU.danger, fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
          {chars === null && !error && <div style={{ color: MENU.parchmentDim }}>Loading…</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 7, overflowY: "auto", flex: 1 }}>
            {chars?.length === 0 && !creating && (
              <div style={{ color: MENU.parchmentDim, fontSize: 13, padding: "8px 2px" }}>No champions yet. Forge your first below.</div>
            )}
            {chars?.map((c) => {
              const active = c.id === selectedId && !creating;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setCreating(false);
                    setSelectedId(c.id);
                  }}
                  style={rosterRow(active)}
                >
                  <span style={{ fontSize: 20, filter: active ? "none" : "grayscale(0.4)" }}>{CLASS_GLYPH[c.class_id as ClassId] ?? "⚔️"}</span>
                  <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 14, color: MENU.parchment, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.name}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: MENU.parchmentDim }}>
                      Lv {levelForTotalXp(c.total_xp ?? 0)} · {CLASS_META[c.class_id as ClassId]?.label ?? c.class_id}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ ...goldRule, margin: "10px 0" }} />
          {!atLimit ? (
            <button onClick={() => setCreating(true)} style={{ ...ghostButton(true), width: "100%", borderStyle: creating ? "solid" : "dashed", color: creating ? MENU.gold : MENU.parchment }}>
              ＋ New Champion
            </button>
          ) : (
            <div style={{ color: MENU.parchmentDim, fontSize: 12, textAlign: "center" }}>All {MAX_CHARACTERS} slots full.</div>
          )}
        </div>

        {/* ── Showcase ── */}
        <div style={{ ...framePanel, flex: 1, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          {/* 3D hero fills the stage */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <CharacterPreview3D classId={previewClass} skinId={previewSkin} />
          </div>

          {/* Footer: either the selected-hero CTA or the creation form */}
          <div style={{ padding: "14px 22px 20px", borderTop: `1px solid ${MENU.goldDim}`, background: "linear-gradient(180deg, transparent, rgba(6,7,10,0.7))" }}>
            {creating ? (
              <CreatePanel
                newName={newName}
                setNewName={setNewName}
                newVariant={newVariant}
                setNewVariant={setNewVariant}
                newClass={newClass}
                setNewClass={setNewClass}
                nameValid={nameValid}
                busy={busy}
                onCreate={doCreate}
                onCancel={() => setCreating(false)}
              />
            ) : selected ? (
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: MENU.display, fontSize: 28, color: MENU.parchment, letterSpacing: 1, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selected.name}
                  </div>
                  <div style={{ color: MENU.gold, fontSize: 13.5, marginTop: 3 }}>
                    Level {levelForTotalXp(selected.total_xp ?? 0)} {CLASS_META[selected.class_id as ClassId]?.label} ·{" "}
                    <span style={{ color: MENU.parchmentDim }}>{CLASS_META[selected.class_id as ClassId]?.role}</span>
                  </div>
                  <div style={{ color: MENU.parchmentDim, fontSize: 12, marginTop: 4, maxWidth: 360 }}>
                    {CLASS_META[selected.class_id as ClassId]?.blurb}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <button onClick={() => doDelete(selected)} disabled={busy} title="Delete champion" style={deleteBtn}>
                    ✕
                  </button>
                  <button onClick={() => play(selected)} disabled={busy} style={goldButton(!busy)}>
                    {busy ? "Entering…" : "Enter World"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", color: MENU.parchmentDim, fontSize: 14, padding: "8px 0" }}>
                Select a champion, or forge a new one to begin.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreatePanel({
  newName,
  setNewName,
  newVariant,
  setNewVariant,
  newClass,
  setNewClass,
  nameValid,
  busy,
  onCreate,
  onCancel,
}: {
  newName: string;
  setNewName: (v: string) => void;
  newClass: ClassId;
  newVariant: "a" | "b";
  setNewVariant: (v: "a" | "b") => void;
  setNewClass: (c: ClassId) => void;
  nameValid: boolean;
  busy: boolean;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const meta = CLASS_META[newClass];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* All four class cards must fit: wrap + shrink instead of clipping. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {CLASS_ORDER.map((id) => {
          const active = id === newClass;
          return (
            <button key={id} onClick={() => setNewClass(id)} title={`${CLASS_META[id].role} — ${CLASS_META[id].blurb}`} style={classCard(active)}>
              <span style={{ fontSize: 22 }}>{CLASS_GLYPH[id]}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: active ? MENU.gold : MENU.parchment }}>{CLASS_META[id].label}</span>
              <span style={{ fontSize: 10.5, color: MENU.parchmentDim }}>{CLASS_META[id].role}</span>
            </button>
          );
        })}
      </div>
      <div style={{ color: MENU.parchmentDim, fontSize: 12, minHeight: 16 }}>{meta.blurb}</div>
      {/* Body variant toggle — two free starter forms per class. */}
      <div style={{ display: "flex", gap: 8 }}>
        {(["a", "b"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setNewVariant(v)}
            style={{
              flex: 1,
              padding: "7px 0",
              borderRadius: 6,
              border: `1px solid ${newVariant === v ? MENU.gold : MENU.goldDim}`,
              background: newVariant === v ? "rgba(201,165,74,0.15)" : "rgba(10,11,15,0.7)",
              color: newVariant === v ? MENU.gold : MENU.parchment,
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            {v === "a" ? "Form I" : "Form II"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          placeholder="champion name (3–20)"
          value={newName}
          maxLength={20}
          autoFocus
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && nameValid && !busy && onCreate()}
          style={{ ...menuField, flex: 1 }}
        />
        <button onClick={onCreate} disabled={!nameValid || busy} style={goldButton(nameValid && !busy)}>
          Create
        </button>
        <button onClick={onCancel} disabled={busy} style={ghostButton(!busy)}>
          Back
        </button>
      </div>
    </div>
  );
}

function rosterRow(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 11px",
    borderRadius: 5,
    border: `1px solid ${active ? MENU.gold : "rgba(201,165,74,0.18)"}`,
    background: active ? "linear-gradient(180deg, rgba(201,165,74,0.16), rgba(201,165,74,0.05))" : "rgba(10,11,15,0.6)",
    cursor: "pointer",
    textAlign: "left",
  };
}

function classCard(active: boolean): React.CSSProperties {
  return {
    // flex-basis 0 + minWidth lets four cards share the row evenly and shrink
    // (the 4th card was clipped off the right edge before).
    flex: "1 1 0",
    minWidth: 96,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    padding: "10px 4px",
    borderRadius: 6,
    border: `1px solid ${active ? MENU.gold : MENU.goldDim}`,
    background: active ? "rgba(201,165,74,0.15)" : "rgba(10,11,15,0.7)",
    cursor: "pointer",
  };
}

const deleteBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 5,
  border: `1px solid ${MENU.goldDim}`,
  background: "rgba(10,11,15,0.7)",
  color: MENU.danger,
  fontSize: 15,
  cursor: "pointer",
};

function msg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("character_limit_reached")) return "You already have 5 characters.";
  if (m.includes("not_authenticated") || m.includes("401")) return "Session expired — please sign in again.";
  if (m.includes("Failed to fetch")) return "Can't reach the server. Is the backend running?";
  return "Something went wrong. Try again.";
}
