// The Depthbreaker character GLBs (Synty Dungeon Realms) export with a single
// flat gray "Lit" material and NO baked texture — the FBX→glTF chain dropped the
// base-colour link, exactly like the map did. Their UVs map into the shared
// Dungeon Realms atlas that already lives in-repo (the map copied it), so we
// re-attach it at load time instead of re-exporting. Mirrors IslandMap.tsx.

import { useTexture } from "@react-three/drei";
import { SRGBColorSpace, type MeshStandardMaterial, type Texture } from "three";

const CHARACTER_ATLAS_URL = "/models/map/textures/Dungeons_2_Texture_01_A.png";

/** Load (and correctly configure) the shared character atlas. Suspends until
 *  ready, so callers must render inside a <Suspense> boundary (they all do). */
export function useCharacterAtlas(): Texture {
  const atlas = useTexture(CHARACTER_ATLAS_URL);
  // Configure ONCE. This is a shared cached texture (the map uses the same file),
  // so toggling `needsUpdate` on every render re-uploads it to the GPU every
  // frame across every character + the map — which tanks the whole framerate.
  // glTF convention (top-left origin) + sRGB; only touch it until it's set.
  if (atlas.flipY !== false || atlas.colorSpace !== SRGBColorSpace) {
    atlas.flipY = false;
    atlas.colorSpace = SRGBColorSpace;
    atlas.needsUpdate = true;
  }
  return atlas;
}

/** Attach the atlas to a character material that has no map (the gray "Lit").
 *  Leaves already-textured materials untouched, and resets the gray tint to
 *  white so the texture shows at full colour. */
export function attachAtlas(mat: MeshStandardMaterial, atlas: Texture): void {
  if (mat.map) return;
  mat.map = atlas;
  mat.color?.setRGB(1, 1, 1);
  mat.needsUpdate = true;
}
