import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  Object3D,
  Vector3,
} from "three";
import syntyRuntimeManifest from "../../../public/models/synty/runtime/manifest.json";
import { AnimatedCharacter, type PreviewState, type StrideNorm } from "./AnimatedCharacter";
import { MOTION_PROFILES, type MotionProfileId } from "./motionProfiles";
import { LOCOMOTION_BUILD } from "./locomotionController";

type ManifestCharacter = {
  key: string;
  url: string;
  assetVersion?: string;
  runtimeApproved?: boolean;
  visualHeight?: number;
  naturalHeight?: number;
  restMinY?: number;
  motionProfile?: MotionProfileId;
  strideNorm?: StrideNorm;
};

const characters = (syntyRuntimeManifest.characters as ManifestCharacter[]).filter((character) => character.runtimeApproved);
const PREVIEW_STATES: PreviewState[] = ["idle", "walk", "run", "sprint", "turn", "attack", "hit", "death"];

function versionedUrl(url: string, version?: string): string {
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

function initialCharacter(): string {
  const requested = new URLSearchParams(window.location.search).get("debugAnim");
  return characters.find((character) => character.key === requested)?.key ?? characters[0]?.key ?? "";
}

export function AnimationDebugView() {
  const [characterKey, setCharacterKey] = useState(initialCharacter);
  const [mode, setMode] = useState<"blend" | "clip">("blend");
  const [clipName, setClipName] = useState("");
  const [clipNames, setClipNames] = useState<string[]>([]);
  const [speed, setSpeed] = useState(1);
  const [previewState, setPreviewState] = useState<PreviewState>("run");
  const [previewSpeed, setPreviewSpeed] = useState(4.2);
  const [stats, setStats] = useState("loading");
  const character = characters.find((entry) => entry.key === characterKey) ?? characters[0];
  const url = character ? versionedUrl(character.url, character.assetVersion) : "";
  const motionProfile = MOTION_PROFILES[character?.motionProfile ?? "humanoidPlayer"] ?? MOTION_PROFILES.humanoidPlayer;

  return (
    <main style={{ position: "fixed", inset: 0, background: "#090a0e", color: "#f8fafc" }}>
      <Canvas shadows camera={{ position: [0, 2.5, 5], fov: 42 }}>
        <color attach="background" args={["#090a0e"]} />
        <hemisphereLight args={["#dbeafe", "#1f2937", 1.1]} />
        <directionalLight color="#ffffff" intensity={2.4} position={[3, 5, 4]} castShadow />
        <gridHelper args={[6, 12, "#334155", "#1e293b"]} />
        <Suspense fallback={null}>
          {url && mode === "blend" && character && (
            <AnimatedCharacter
              key={`blend:${url}`}
              entityId="debug"
              kind="player"
              url={url}
              targetHeight={character.visualHeight ?? 1.8}
              naturalHeight={character.naturalHeight}
              restMinY={character.restMinY}
              motionProfile={motionProfile}
              strideNorm={character.strideNorm}
              previewState={previewState}
              previewSpeed={previewSpeed}
            />
          )}
          {url && mode === "clip" && (
            <DebugCharacter
              key={`clip:${url}`}
              url={url}
              clipName={clipName}
              speed={speed}
              onClips={(clips) => {
                setClipNames(clips);
                setClipName((current) => current || clips[0] || "");
              }}
              onStats={setStats}
            />
          )}
        </Suspense>
        <OrbitControls target={[0, 0.9, 0]} />
      </Canvas>

      <section style={{ position: "fixed", top: 16, left: 16, display: "grid", gap: 8, padding: 12, background: "rgba(8, 9, 12, 0.86)", border: "1px solid rgba(148, 163, 184, 0.25)", borderRadius: 8, fontFamily: "system-ui, sans-serif", minWidth: 300 }}>
        <strong>Animation QA <span style={{ color: "#38bdf8", fontWeight: 400 }}>· build: {LOCOMOTION_BUILD}</span></strong>
        <label>
          Character{" "}
          <select value={character?.key ?? ""} onChange={(event) => { setCharacterKey(event.target.value); setClipName(""); }}>
            {characters.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.key}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mode{" "}
          <select value={mode} onChange={(event) => setMode(event.target.value as "blend" | "clip")}>
            <option value="blend">blend (runtime controller)</option>
            <option value="clip">clip (raw inspector)</option>
          </select>
        </label>

        {mode === "blend" ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {PREVIEW_STATES.map((state) => (
                <button
                  key={state}
                  onClick={() => setPreviewState(state)}
                  style={{ padding: "2px 8px", background: previewState === state ? "#2563eb" : "#1e293b", color: "#f8fafc", border: "1px solid #334155", borderRadius: 4, cursor: "pointer" }}
                >
                  {state}
                </button>
              ))}
            </div>
            <label>
              Speed{" "}
              <input type="range" min="0" max="8" step="0.1" value={previewSpeed} onChange={(event) => setPreviewSpeed(Number(event.target.value))} />
              {" "}{previewSpeed.toFixed(1)} u/s
            </label>
            <code style={{ whiteSpace: "pre-wrap", color: "#cbd5e1" }}>
              {`state: ${previewState}\nspeed: ${previewSpeed.toFixed(1)} u/s\nstrideNorm: ${JSON.stringify(character?.strideNorm ?? {})}`}
            </code>
          </>
        ) : (
          <>
            <label>
              Clip{" "}
              <select value={clipName} onChange={(event) => setClipName(event.target.value)}>
                {clipNames.map((clip) => (
                  <option key={clip} value={clip}>
                    {clip}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Speed{" "}
              <input type="range" min="0" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
              {" "}{speed.toFixed(2)}x
            </label>
            <code style={{ whiteSpace: "pre-wrap", color: "#cbd5e1" }}>{stats}</code>
          </>
        )}
      </section>
    </main>
  );
}

function DebugCharacter({
  url,
  clipName,
  speed,
  onClips,
  onStats,
}: {
  url: string;
  clipName: string;
  speed: number;
  onClips: (clips: string[]) => void;
  onStats: (stats: string) => void;
}) {
  const { scene, animations } = useGLTF(url);
  const root = useMemo(() => SkeletonUtils.clone(scene) as Group, [scene]);
  const mixer = useMemo(() => new AnimationMixer(root), [root]);
  const currentClip = useRef("");
  const bones = useMemo(() => {
    const found: Object3D[] = [];
    root.traverse((object) => {
      if ((object as Object3D & { isBone?: boolean }).isBone) found.push(object);
    });
    return found;
  }, [root]);

  useEffect(() => {
    onClips(animations.map((clip) => clip.name));
  }, [animations, onClips]);

  useFrame((_, delta) => {
    const requested = clipName || animations[0]?.name || "";
    if (requested && requested !== currentClip.current) {
      mixer.stopAllAction();
      const clip = animations.find((candidate) => candidate.name === requested);
      if (clip) {
        const sanitized = new AnimationClip(clip.name, clip.duration, clip.tracks.filter((track) => !["root.position", "Root.position"].includes(track.name)));
        const action = mixer.clipAction(sanitized, root);
        action.reset().fadeIn(0.08).play();
      }
      currentClip.current = requested;
    }
    mixer.timeScale = speed;
    mixer.update(delta);
    root.updateMatrixWorld(true);
    onStats(formatStats(root, bones, animations.find((clip) => clip.name === requested)));
  });

  return <primitive object={root} />;
}

function formatStats(root: Group, bones: Object3D[], clip?: AnimationClip): string {
  const box = new Box3().setFromObject(root);
  const meshSize = new Vector3();
  box.getSize(meshSize);
  const boneBounds = boundsFromObjects(bones);
  return [
    `clip: ${clip?.name ?? "none"}`,
    `duration: ${(clip?.duration ?? 0).toFixed(3)}s`,
    `tracks: ${clip?.tracks.length ?? 0}`,
    `bones: ${bones.length}`,
    `mesh size: ${meshSize.x.toFixed(2)}, ${meshSize.y.toFixed(2)}, ${meshSize.z.toFixed(2)}`,
    `bone size: ${boneBounds.size.x.toFixed(2)}, ${boneBounds.size.y.toFixed(2)}, ${boneBounds.size.z.toFixed(2)}`,
    `bone minY: ${boneBounds.min.y.toFixed(2)}`,
  ].join("\n");
}

function boundsFromObjects(objects: Object3D[]) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const point = new Vector3();
  for (const object of objects) {
    object.getWorldPosition(point);
    min.min(point);
    max.max(point);
  }
  return { min, max, size: new Vector3().subVectors(max, min) };
}
