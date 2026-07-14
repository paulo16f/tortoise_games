// The official hand-built island: one GLB exported from the Unity scene
// (map1.glb), placed 1:1 at world origin — the export used world-space
// coordinates that already match the game's (playerSpawn, markers, node
// positions all line up). Replaces the procedural DungeonGround + RuntimeDungeon
// when USE_OFFICIAL_MAP is on. Outdoor daylight (the cave IBL is for dungeons).

import { useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import { FrontSide, type Mesh } from "three";

const MAP_URL = "/models/map/map1.glb";

export function IslandMap() {
  const { scene } = useGLTF(MAP_URL);

  useEffect(() => {
    // Synty meshes render double-sided by default in some exports; force
    // front-side + shadows so the big terrain reads cleanly under the sun.
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.receiveShadow = true;
        m.castShadow = false; // terrain doesn't self-shadow; cheaper
        const mat = m.material;
        if (mat && !Array.isArray(mat) && "side" in mat) (mat as { side: number }).side = FrontSide;
      }
    });
  }, [scene]);

  return (
    <group>
      <primitive object={scene} />
      {/* Outdoor daylight so the island is lit like the Unity scene, not a cave. */}
      <ambientLight intensity={0.85} color="#dfeaff" />
      <directionalLight position={[60, 120, 40]} intensity={1.4} color="#fff2d8" />
    </group>
  );
}

useGLTF.preload(MAP_URL);
