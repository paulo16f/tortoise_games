// Top-level state machine: "menu" -> "connecting" -> "playing".
// On Play we attempt the full backend flow (guest login -> ensure character ->
// start run -> ws url + ticket). If ANY step fails we fall back to a ticketless
// join against REALTIME_URL. The client must work even without the backend.

import { Suspense, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import type { ClassId } from "@depthbreaker/protocol";
import { REALTIME_URL } from "./config";
import {
  guestLogin,
  listCharacters,
  createCharacter,
  startRun,
} from "./net/backend";
import { connectToZone } from "./net/room";
import { useControls } from "./game/input/useControls";
import { Scene } from "./game/world/Scene";
import { ARPG_CAMERA } from "./game/world/cameraPreset";
import { Menu } from "./ui/Menu";
import { Hud } from "./ui/Hud";

type Phase = "menu" | "connecting" | "playing";

async function backendFlow(
  name: string,
  classId: ClassId,
): Promise<{ url: string; ticket: string } | null> {
  try {
    const { accessToken } = await guestLogin();
    let characters = await listCharacters(accessToken);
    let character = characters.find((c) => c.class_id === classId);
    if (!character) character = await createCharacter(accessToken, name, classId);
    const run = await startRun(accessToken, character.id);
    const url = typeof run.wsUrl === "string" && /^wss?:\/\//.test(run.wsUrl)
      ? run.wsUrl
      : REALTIME_URL;
    return { url, ticket: run.joinTicket };
  } catch (err) {
    console.warn("[depthbreaker] backend flow failed, joining ticketless:", err);
    return null;
  }
}

function PlayingLayer() {
  useControls();
  return (
    <>
      <Canvas
        shadows
        camera={{ position: [0, 5.5, -7], fov: ARPG_CAMERA.fov, near: 0.1, far: 120 }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <Hud />
    </>
  );
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("menu");
  const [error, setError] = useState<string | null>(null);

  const handlePlay = useCallback(async (name: string, classId: ClassId) => {
    setError(null);
    setPhase("connecting");
    try {
      const flow = await backendFlow(name, classId);
      const url = flow?.url ?? REALTIME_URL;
      await connectToZone({ url, ticket: flow?.ticket, name, classId });
      setPhase("playing");
    } catch (err) {
      console.error("[depthbreaker] failed to join zone:", err);
      setError(
        "Could not connect to the realtime server. Is it running on " +
          REALTIME_URL +
          "?",
      );
      setPhase("menu");
    }
  }, []);

  if (phase === "playing") return <PlayingLayer />;
  return <Menu connecting={phase === "connecting"} error={error} onPlay={handlePlay} />;
}
