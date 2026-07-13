// A slowly-rotating 3D character bust for the roster / creation screens — the
// WoW "hero on a plinth" moment. Loads the class's player-model GLB (the same
// PLAYER_MODELS mapping the game uses, so it auto-upgrades when the real Dark
// Fortress GLBs are exported) and plays its idle clip. Deliberately lightweight:
// no combat/locomotion machinery, just clone + idle + auto-spin.

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { Box3, Vector3, type Group } from "three";
import { resolvePlayerModel } from "../../game/actors/useModel";

/** Same normalization contract as the in-game AnimatedCharacter: scale the GLB
 *  to a known height and plant its feet on y=0, so the fixed camera always
 *  frames a full body no matter how each pack authored its rig. */
const PREVIEW_HEIGHT = 1.7;

function Hero({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(gltf.scene) as Group;
    c.traverse((o) => {
      o.castShadow = true;
    });
    // Normalize: measure the rest pose, scale to PREVIEW_HEIGHT, foot-plant.
    const box = new Box3().setFromObject(c);
    const size = new Vector3();
    box.getSize(size);
    const scale = size.y > 0.0001 ? PREVIEW_HEIGHT / size.y : 1;
    c.scale.setScalar(scale);
    c.position.y = -box.min.y * scale;
    return c;
  }, [gltf.scene]);
  const { actions, names } = useAnimations(gltf.animations, clone);
  const spin = useRef<Group>(null);

  useEffect(() => {
    const idle = actions["idle"] ?? (names[0] ? actions[names[0]] : undefined);
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

export function CharacterPreview3D({ classId }: { classId: string }) {
  const url = resolvePlayerModel(classId)?.url;
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
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
          <Suspense fallback={null}>{url && <Hero key={url} url={url} />}</Suspense>
        </group>
      </Canvas>
    </div>
  );
}
