import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type { ClassId } from "@depthbreaker/protocol";
import { REALTIME_URL } from "./config";
import { connectToZone } from "./net/room";
import { useControls } from "./game/input/useControls";
import { Scene } from "./game/world/Scene";
import { AnimationDebugView } from "./game/actors/AnimationDebugView";
import { Hud } from "./ui/Hud";
import { Menu } from "./ui/Menu";

function GameCanvas() {
  useControls();
  return (
    <>
      <Canvas shadows camera={{ position: [0, 8, 10], fov: 42 }} gl={{ antialias: true }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <Hud />
    </>
  );
}

function GameApp() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const play = async (name: string, classId: ClassId) => {
    setConnecting(true);
    setError(null);
    try {
      await connectToZone({ url: REALTIME_URL, name, classId });
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect to realtime server.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <main style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#08090c" }}>
      {connected ? <GameCanvas /> : <Menu connecting={connecting} error={error} onPlay={play} />}
    </main>
  );
}

export default function App() {
  return new URLSearchParams(window.location.search).has("debugAnim") ? <AnimationDebugView /> : <GameApp />;
}
