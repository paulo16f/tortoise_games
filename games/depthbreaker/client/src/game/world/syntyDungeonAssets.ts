import { useGLTF } from "@react-three/drei";
import type { DungeonVisualAssetId } from "@depthbreaker/protocol";
import manifest from "../../../public/models/synty/runtime/manifest.json";

export type DungeonAssetKey = DungeonVisualAssetId;

export interface RuntimeDungeonAsset {
  key: DungeonAssetKey;
  category: "floor" | "prop";
  url: string;
  visualScale: number;
  yOffset: number;
  runtimeApproved: boolean;
}

const approvedAssets = manifest.assets.filter((asset) => asset.runtimeApproved) as RuntimeDungeonAsset[];

export const DUNGEON_ASSETS = Object.fromEntries(
  approvedAssets.map((asset) => [asset.key, asset.url]),
) as Record<DungeonAssetKey, string>;

export const DUNGEON_ASSET_META = Object.fromEntries(
  approvedAssets.map((asset) => [asset.key, asset]),
) as Record<DungeonAssetKey, RuntimeDungeonAsset>;

for (const url of Object.values(DUNGEON_ASSETS)) useGLTF.preload(url);
