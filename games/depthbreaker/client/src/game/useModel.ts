// GLB loading helper. The studio has NOT purchased character/enemy art yet, so
// every entry below is empty and the renderer falls back to primitive meshes.
//
// TO ADD REAL ART LATER: drop a .glb under client/public/models/ and point the
// class/enemy key at it, e.g.
//
//   export const PLAYER_MODELS: Partial<Record<ClassId, string>> = {
//     bruiser: "/models/bruiser.glb",
//     mage: "/models/mage.glb",
//     warden: "/models/warden.glb",
//   };
//   export const ENEMY_MODELS: Record<string, string> = {
//     grunt: "/models/enemy_grunt.glb",
//   };
//
// Then use the <ModelOrPrimitive> pattern: a component that calls drei's
// useGLTF(url) (a hook, so it must be a component, called unconditionally) and
// clones gltf.scene, with a primitive fallback when no url is mapped. Because
// the maps are empty today, resolveModelUrl always returns undefined and every
// entity renders as a primitive — no real asset paths are referenced.

import type { ClassId } from "@depthbreaker/protocol";

/** Empty until art is purchased. Keys map a class id -> GLB url. */
export const PLAYER_MODELS: Partial<Record<ClassId, string>> = {};

/** Empty until art is purchased. Keys map an enemy defId -> GLB url. */
export const ENEMY_MODELS: Record<string, string> = {};

/** Resolve a player class id to a GLB url, or undefined for a primitive. */
export function resolvePlayerModel(classId: string): string | undefined {
  return PLAYER_MODELS[classId as ClassId];
}

/** Resolve an enemy defId to a GLB url, or undefined for a primitive. */
export function resolveEnemyModel(defId: string): string | undefined {
  return ENEMY_MODELS[defId];
}

// When a url exists, render this inside a wrapper that calls it as a component:
//
//   function GlbModel({ url }: { url: string }) {
//     const { scene } = useGLTF(url);
//     const cloned = useMemo(() => scene.clone(true), [scene]);
//     return <primitive object={cloned} />;
//   }
//
// Keeping it here as guidance only; not wired while the maps are empty.
