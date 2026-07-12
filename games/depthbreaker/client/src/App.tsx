import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { leaveZone } from "./net/room";
import { bootstrap } from "./net/session";
import { initCombatSfx, startAmbient, stopAmbient, setMuted, isSfxMuted } from "./game/fx/sfx";
import { useControls } from "./game/input/useControls";
import { Scene } from "./game/world/Scene";
import { AnimationDebugView } from "./game/actors/AnimationDebugView";
import { Hud } from "./ui/Hud";
import { InventoryPanel } from "./ui/InventoryPanel";
import { SkillBookPanel } from "./ui/SkillBookPanel";
import { MarketPanel } from "./ui/MarketPanel";
import { StashPanel } from "./ui/StashPanel";
import { DailyQuestPanel } from "./ui/DailyQuestPanel";
import { TradePanel } from "./ui/TradePanel";
import { SpinnerPanel } from "./ui/SpinnerPanel";
import { ChatPanel } from "./ui/ChatPanel";
import { CookingPanel } from "./ui/CookingPanel";
import { PanelDock } from "./ui/PanelDock";
import { LootToasts } from "./ui/LootToasts";
import { GoldToasts } from "./ui/GoldToasts";
import { CastBar } from "./ui/CastBar";
import { TooltipLayer } from "./ui/Tooltip";
import { LoginScreen } from "./ui/LoginScreen";
import { CharacterSelect } from "./ui/CharacterSelect";
import { HudPreview } from "./ui/HudPreview";

function GameCanvas({ onLeave }: { onLeave: () => void }) {
  useControls();
  // Dungeon ambience runs while in a run; stops on leave.
  useEffect(() => {
    startAmbient();
    return () => stopAmbient();
  }, []);
  return (
    <>
      <Canvas shadows camera={{ position: [0, 8, 10], fov: 42 }} gl={{ antialias: true }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <Hud />
      <InventoryPanel />
      <SkillBookPanel />
      <MarketPanel />
      <StashPanel />
      <DailyQuestPanel />
      <TradePanel />
      <SpinnerPanel />
      <ChatPanel />
      <CookingPanel />
      <PanelDock />
      <LootToasts />
      <GoldToasts />
      <CastBar />
      <TooltipLayer />
      <MuteButton />
      <button onClick={onLeave} title="Leave to character select" style={leaveBtn}>
        ⎋ Leave
      </button>
    </>
  );
}

function MuteButton() {
  const [muted, setLocal] = useState(isSfxMuted());
  return (
    <button
      onClick={() => {
        const next = !muted;
        setMuted(next);
        setLocal(next);
      }}
      title={muted ? "Unmute sound" : "Mute sound"}
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      style={muteBtn}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

type Phase = "loading" | "auth" | "select" | "in-run";

function GameApp() {
  const [phase, setPhase] = useState<Phase>("loading");

  // Wire the combat SFX sample-bank once (arms the first-gesture audio unlock;
  // plays real audio files when present, richer procedural synth otherwise).
  useEffect(() => {
    initCombatSfx();
  }, []);

  // On load, try to restore a session from the refresh cookie. In ticketless
  // dev mode with no backend, skip straight to a minimal guest select.
  useEffect(() => {
    let cancelled = false;
    void bootstrap().then((ok) => {
      if (cancelled) return;
      setPhase(ok ? "select" : "auth");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const leave = () => {
    leaveZone();
    setPhase("select");
  };

  return (
    <main style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#08090c" }}>
      {phase === "loading" && <SplashScreen />}
      {phase === "auth" && <LoginScreen onAuthed={() => setPhase("select")} />}
      {phase === "select" && <CharacterSelect onEnterGame={() => setPhase("in-run")} />}
      {phase === "in-run" && <GameCanvas onLeave={leave} />}
    </main>
  );
}

function SplashScreen() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        color: "#e6e9ef",
        fontFamily: "system-ui, sans-serif",
        background: "radial-gradient(circle at 50% 30%, #131722, #0b0d12)",
      }}
    >
      <div style={{ opacity: 0.7 }}>Depthbreaker — loading…</div>
    </div>
  );
}

const leaveBtn: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(201,165,74,0.4)",
  background: "linear-gradient(180deg, rgba(30,34,44,0.92), rgba(8,9,13,0.95))",
  color: "#f1e9d0",
  fontSize: 13,
  cursor: "pointer",
  pointerEvents: "auto",
};

const muteBtn: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 96,
  width: 34,
  height: 34,
  borderRadius: 8,
  border: "1px solid rgba(201,165,74,0.4)",
  background: "linear-gradient(180deg, rgba(30,34,44,0.92), rgba(8,9,13,0.95))",
  color: "#f1e9d0",
  fontSize: 15,
  cursor: "pointer",
  pointerEvents: "auto",
};

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("hud")) return <HudPreview />;
  return params.has("debugAnim") ? <AnimationDebugView /> : <GameApp />;
}
