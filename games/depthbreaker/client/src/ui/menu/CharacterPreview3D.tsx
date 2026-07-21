// A slowly-rotating 3D character bust for the roster / creation screens — the
// WoW "hero on a plinth" moment. Loads the class's player-model GLB (the same
// PLAYER_MODELS mapping the game uses, so it auto-upgrades when the real Dark
// Fortress GLBs are exported) and plays its idle clip. Deliberately lightweight:
// no combat/locomotion machinery, just clone + idle + auto-spin.

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { Box3, Vector3, Mesh, MeshStandardMaterial, type Group } from "three";
import { resolvePlayerModel } from "../../game/actors/useModel";
import { useCharacterAtlas, attachAtlas } from "../../game/actors/characterAtlas";

/** Same normalization contract as the in-game AnimatedCharacter: scale the GLB
 *  to a known height and plant its feet on y=0, so the fixed camera always
 *  frames a full body no matter how each pack authored its rig. */
const PREVIEW_HEIGHT = 1.7;

function Hero({ url, naturalHeight, restMinY }: { url: string; naturalHeight?: number; restMinY?: number }) {
  const gltf = useGLTF(url);
  const atlas = useCharacterAtlas();
  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(gltf.scene) as Group;
    c.traverse((o) => {
      o.castShadow = true;
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) if (m instanceof MeshStandardMaterial) attachAtlas(m, atlas);
      }
    });
    // Normalize with the MANIFEST's measured rest-pose metrics (same contract
    // as AnimatedCharacter). Box3 on a skinned mesh reads the raw bind-pose
    // geometry — on Synty rigs (~0.006 bone scale) that yields a giant model.
    let height = naturalHeight;
    let minY = restMinY;
    if (height === undefined || minY === undefined) {
      const box = new Box3().setFromObject(c);
      const size = new Vector3();
      box.getSize(size);
      height = size.y;
      minY = box.min.y;
    }
    let scale = height > 1e-3 ? PREVIEW_HEIGHT / height : 1;
    if (!Number.isFinite(scale) || scale < 0.05 || scale > 50) scale = 1;
    c.scale.setScalar(scale);
    c.position.y = -minY * scale;
    return c;
  }, [gltf.scene, naturalHeight, restMinY, atlas]);
  const { actions, names } = useAnimations(gltf.animations, clone);
  const spin = useRef<Group>(null);

  useEffect(() => {
    // Always the calm "idle" loop (case-insensitive), so every bust idles the
    // same way — never fall through to names[0], which can be a combat clip.
    const idleName = names.find((n) => n.toLowerCase() === "idle") ?? names[0];
    const idle = idleName ? actions[idleName] : undefined;
    idle?.reset().fadeIn(0.3).play();
    return () => void idle?.fadeOut(0.2);
  }, [actions, names]);

  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.5;
  });

  return (
    <group ref={spin}>
      <primitive object={clone} />
    </group>
  );
}

/** Dark plinth with a faint gold ring the hero stands on. */
function Plinth() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <circleGeometry args={[1.15, 48]} />
        <meshStandardMaterial color="#0c0d12" roughness={0.9} metalness={0.1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[1.02, 1.15, 48]} />
        <meshBasicMaterial color="#c9a54a" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

export function CharacterPreview3D({ classId, skinId }: { classId: string; skinId?: string }) {
  const model = resolvePlayerModel(classId, skinId || undefined);
  const url = model?.url;
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <Canvas
        shadows
        dpr={[1, 1.25]}
        // Aim at mid-torso (not the feet at the origin) so the whole
        // normalized 1.7u body — head included — fits the frame.
        camera={{ position: [0, 1.35, 3.9], fov: 34 }}
        onCreated={({ camera }) => camera.lookAt(0, 0.85, 0)}
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent" }}
      >
        {/* soft fill + warm key from the front, cool rim from behind */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[2.5, 4, 3]} intensity={1.5} color="#ffe6b0" castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-3, 2, -2]} intensity={0.8} color="#6f8dff" />
        <group position={[0, -0.02, 0]}>
          <Plinth />
          <Suspense fallback={null}>
            {url && <Hero key={url} url={url} naturalHeight={model?.naturalHeight} restMinY={model?.restMinY} />}
          </Suspense>
        </group>
      </Canvas>
    </div>
  );
}
