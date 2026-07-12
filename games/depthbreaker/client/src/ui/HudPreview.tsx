// Canvas-free HUD preview (?hud). Seeds the zone store with a mock snapshot and
// renders the real HUD over a static gradient — NO WebGL — so the HUD can be
// screenshotted and iterated on without the 3D scene (which makes screenshots
// hang). Dev-only harness; not part of the shipped game flow.

import { useEffect, useState } from "react";
import { hotbarLayout, type ClassId } from "@depthbreaker/protocol";
import { zoneStore } from "../net/room";
import { Hud } from "./Hud";
import { PanelDock } from "./PanelDock";

const CLASSES: ClassId[] = ["knight", "reaper", "cleric", "necromancer"];

function mockSelf(classId: ClassId) {
  const hotbar = hotbarLayout(classId).map((skillId, i) => ({
    skillId,
    cooldownRemaining: skillId === "cleave" ? 4 : 0, // one slot on cooldown to show the sweep
    unlocked: skillId !== "bulwark", // one locked to show the lock state
    _i: i,
  })).map(({ _i, ...s }) => s);
  return {
    id: "preview",
    accountId: "",
    characterId: "",
    name: "Preview Hero",
    classId,
    skinId: "",
    x: 0, y: 0, z: 0, yaw: 0,
    hp: 128, maxHp: 170, level: 14, runXp: 640, gold: 292,
    targetId: "mob", autoAttack: true, weaponId: "iron_sword", alive: true,
    actionState: "idle", actionStartedAt: 0, actionEndsAt: 0, actionTargetId: "", actionId: "",
    potionCooldown: 0, gcdRemaining: 0, swingCooldown: 0, swingInterval: 1.0,
    shieldSeconds: 0, frostSeconds: 0, ampSeconds: 0,
    inventory: [] as never[],
    hotbar,
  };
}

function mockTarget() {
  return {
    id: "mob", defId: "elite_grunt", rank: "elite", name: "Cursed Sentinel",
    x: 0, y: 0, z: 0, yaw: 0, hp: 84, maxHp: 130, level: 12,
    alive: true, fsm: "combat", targetId: "preview",
    actionState: "idle", actionStartedAt: 0, actionEndsAt: 0, actionTargetId: "", actionId: "",
  };
}

export function HudPreview() {
  const [cls, setCls] = useState<ClassId>("knight");
  useEffect(() => {
    const base = zoneStore.getSnapshot();
    zoneStore.__setMockSnapshot({
      ...base,
      playerCount: 3,
      enemyCount: 12,
      depth: 0,
      roomId: "preview",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      self: mockSelf(cls) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      target: mockTarget() as any,
    });
  }, [cls]);

  return (
    <main style={{ position: "fixed", inset: 0, overflow: "hidden", background: "radial-gradient(120% 90% at 50% 20%, #26313f, #0d1017 60%, #06070a)" }}>
      {/* faux ground so the HUD reads over a scene-like backdrop */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.5))" }} />
      <Hud />
      <PanelDock />
      <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, zIndex: 50 }}>
        {CLASSES.map((c) => (
          <button
            key={c}
            onClick={() => setCls(c)}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              border: c === cls ? "1px solid #c9a54a" : "1px solid rgba(255,255,255,0.2)",
              background: c === cls ? "rgba(201,165,74,0.2)" : "rgba(0,0,0,0.4)", color: "#e6e9ef",
            }}
          >
            {c}
          </button>
        ))}
      </div>
    </main>
  );
}
