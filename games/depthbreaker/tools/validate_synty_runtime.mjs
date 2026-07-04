import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

globalThis.self = globalThis;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "client/public/models/synty/runtime/manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const loader = new GLTFLoader();
const failures = [];
const warnings = [];

function publicPath(url) {
  return path.join(repoRoot, "client/public", url.replace(/^\//, ""));
}

async function loadGlb(url) {
  const data = await fs.readFile(publicPath(url));
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return loader.parseAsync(arrayBuffer, "");
}

function boxFromScene(scene) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  return size;
}

function assertAssetBounds(asset, size) {
  const maxXZ = Math.max(size.x, size.z);
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) failures.push(`${asset.key}: zero/invalid bounds`);
  if (asset.category === "floor") {
    if (maxXZ < 4 || maxXZ > 7 || size.y > 0.8) failures.push(`${asset.key}: floor bounds not camera-safe (${size.toArray().join(", ")})`);
  } else if (asset.category === "prop") {
    if (size.y * (asset.visualScale ?? 1) > 1.5 || maxXZ * (asset.visualScale ?? 1) > 3.5) {
      failures.push(`${asset.key}: prop too large for v1 runtime (${size.toArray().join(", ")})`);
    }
  }
}

function dangerousPositionTracks(gltf, allowedMagnitude = 5) {
  const bad = [];
  for (const clip of gltf.animations) {
    for (const track of clip.tracks) {
      if (!track.name.endsWith(".position")) continue;
      if (track.name === "root.position") continue;
      let max = 0;
      for (const value of track.values) max = Math.max(max, Math.abs(value));
      if (max > allowedMagnitude) bad.push(`${clip.name}:${track.name}:${max.toFixed(2)}`);
    }
  }
  return bad;
}

for (const asset of manifest.assets) {
  if (!asset.runtimeApproved) continue;
  const gltf = await loadGlb(asset.url);
  assertAssetBounds(asset, boxFromScene(gltf.scene));
}

for (const character of manifest.characters ?? []) {
  if (!character.runtimeApproved) {
    warnings.push(`${character.key}: Synty character is not runtime-approved; using fallback ${character.fallback}`);
    continue;
  }
  const gltf = await loadGlb(character.url);
  const clipNames = new Set(gltf.animations.map((clip) => clip.name));
  for (const clipName of character.requiredClips ?? []) {
    if (!clipNames.has(clipName)) failures.push(`${character.key}: missing clip ${clipName}`);
  }
  const badTracks = dangerousPositionTracks(gltf);
  if (badTracks.length > 0) failures.push(`${character.key}: dangerous position tracks: ${badTracks.slice(0, 8).join("; ")}`);
}

for (const warning of warnings) console.warn(`[warn] ${warning}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`[fail] ${failure}`);
  process.exit(1);
}

console.log(`[ok] Synty runtime manifest validated: ${manifest.assets.filter((a) => a.runtimeApproved).length} assets approved`);
