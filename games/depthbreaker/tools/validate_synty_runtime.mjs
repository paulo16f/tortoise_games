import fs from "node:fs/promises";
import crypto from "node:crypto";
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
const MOTION_PROFILES = new Set(["humanoidPlayer", "lightEnemy", "eliteEnemy", "heavyBoss"]);
const MIN_CHARACTER_CLIP_DURATION = 0.25;
const MIN_CHARACTER_CLIP_TRACKS = 20;
const REQUIRED_CHARACTER_BONES = ["Root", "Hips", "Spine_01", "Head", "Hand_R", "Ankle_L", "Ankle_R"];
const CLIP_SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
const MIN_IDLE_HAND_BIND_DELTA = 0.12;

function publicPath(url) {
  return path.join(repoRoot, "client/public", url.replace(/[?#].*$/, "").replace(/^\//, ""));
}

async function loadGlb(url) {
  const data = await fs.readFile(publicPath(url));
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return loader.parseAsync(arrayBuffer, "");
}

async function fileHash(url) {
  const data = await fs.readFile(publicPath(url));
  return crypto.createHash("sha1").update(data).digest("hex").slice(0, 12);
}

// Per-clip normalized forward travel, measured offline by the Blender bake
// (convert_synty_depthbreaker.py writes `<char>.stride.json`). The runtime
// foot-locks locomotion playback to real ground speed using these; see
// locomotionController.ts. Read here so the manifest stays the single runtime
// source of truth.
async function readStrideNorm(url) {
  const glbPath = publicPath(url);
  const sidecar = glbPath.replace(/\.glb$/i, ".stride.json");
  try {
    const raw = await fs.readFile(sidecar, "utf8");
    const parsed = JSON.parse(raw);
    const stride = parsed?.strideNorm;
    if (stride && typeof stride === "object" && Object.values(stride).some((v) => v > 0)) return stride;
  } catch {
    // No sidecar (e.g. non-Synty fallback) - runtime falls back to profile constants.
  }
  return null;
}

function boxFromScene(scene) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  return size;
}

function boundsFromScene(scene) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { height: size.y, minY: box.min.y };
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

function rootMotionTracks(gltf) {
  const bad = [];
  for (const clip of gltf.animations) {
    for (const track of clip.tracks) {
      if (track.name !== "root.position" && track.name !== "Root.position") continue;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i + 3 <= track.values.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const value = track.values[i + k];
          if (value < min[k]) min[k] = value;
          if (value > max[k]) max[k] = value;
        }
      }
      const range = Math.max(...max.map((v, k) => v - min[k]));
      if (range > 0.001) {
        bad.push(`${clip.name}:${track.name}:${range.toFixed(3)}`);
      }
    }
  }
  return bad;
}

function validateCharacterClips(character, gltf) {
  for (const clip of gltf.animations) {
    if (clip.duration < MIN_CHARACTER_CLIP_DURATION) {
      failures.push(`${character.key}: clip ${clip.name} is too short/frozen (${clip.duration.toFixed(3)}s)`);
    }
    if (clip.tracks.length < MIN_CHARACTER_CLIP_TRACKS) {
      failures.push(`${character.key}: clip ${clip.name} has too few tracks (${clip.tracks.length})`);
    }
  }
}

function characterBones(scene) {
  const bones = [];
  scene.traverse((object) => {
    if (object.isBone) bones.push(object);
  });
  return bones;
}

function boundsFromBones(bones) {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const point = new THREE.Vector3();
  for (const bone of bones) {
    bone.getWorldPosition(point);
    min.min(point);
    max.max(point);
  }
  const size = new THREE.Vector3().subVectors(max, min);
  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  return { min, max, size, center };
}

function validateRequiredBones(character, bones) {
  const names = new Set(bones.map((bone) => bone.name));
  for (const boneName of REQUIRED_CHARACTER_BONES) {
    if (!names.has(boneName)) failures.push(`${character.key}: missing required bone ${boneName}`);
  }
}

function validateAnimatedPoseBounds(character, gltf) {
  const bones = characterBones(gltf.scene);
  validateRequiredBones(character, bones);
  if (bones.length < 30) {
    failures.push(`${character.key}: too few bones for approved Polygon humanoid (${bones.length})`);
    return;
  }

  gltf.scene.updateMatrixWorld(true);
  const rest = boundsFromBones(bones);
  const restHeight = character.naturalHeight || Math.max(rest.size.y, 1);
  const maxHorizontal = restHeight * 2.8;
  const maxHeight = restHeight * 1.65;
  const minHeight = restHeight * 0.55;
  const floorDrop = restHeight * 0.35;
  const maxCenterTravel = restHeight * 1.75;
  const mixer = new THREE.AnimationMixer(gltf.scene);

  for (const clip of gltf.animations) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    for (const fraction of CLIP_SAMPLE_FRACTIONS) {
      mixer.setTime(clip.duration * fraction);
      gltf.scene.updateMatrixWorld(true);
      const bounds = boundsFromBones(bones);
      const horizontal = Math.max(bounds.size.x, bounds.size.z);
      const centerTravel = bounds.center.distanceTo(rest.center);
      if (!Number.isFinite(bounds.size.x + bounds.size.y + bounds.size.z)) {
        failures.push(`${character.key}: ${clip.name} has invalid animated skeleton bounds at ${fraction}`);
        continue;
      }
      const isDeath = clip.name === "death";
      if (!isDeath && bounds.size.y < minHeight) {
        failures.push(`${character.key}: ${clip.name} collapses vertically at ${fraction} (${bounds.size.y.toFixed(3)})`);
      }
      if (bounds.size.y > maxHeight) {
        failures.push(`${character.key}: ${clip.name} stretches vertically at ${fraction} (${bounds.size.y.toFixed(3)})`);
      }
      if (horizontal > maxHorizontal) {
        failures.push(`${character.key}: ${clip.name} stretches horizontally at ${fraction} (${horizontal.toFixed(3)})`);
      }
      if (!isDeath && bounds.min.y < rest.min.y - floorDrop) {
        failures.push(`${character.key}: ${clip.name} drops too far below bind floor at ${fraction} (${bounds.min.y.toFixed(3)})`);
      }
      if (centerTravel > maxCenterTravel) {
        failures.push(`${character.key}: ${clip.name} drifts too far from bind pose at ${fraction} (${centerTravel.toFixed(3)})`);
      }
    }
  }
  mixer.stopAllAction();
}

function validateLocomotionAxis(character, gltf) {
  const byName = new Map();
  gltf.scene.traverse((object) => {
    if (object.isBone) byName.set(object.name, object);
  });
  const ankleL = byName.get("Ankle_L");
  const ankleR = byName.get("Ankle_R");
  if (!ankleL || !ankleR) return;

  const mixer = new THREE.AnimationMixer(gltf.scene);
  const point = new THREE.Vector3();
  for (const clipName of ["walk", "run"]) {
    const clip = gltf.animations.find((candidate) => candidate.name === clipName);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.reset().play();
    const ranges = {
      x: { min: Infinity, max: -Infinity },
      z: { min: Infinity, max: -Infinity },
    };
    for (const fraction of CLIP_SAMPLE_FRACTIONS) {
      mixer.setTime(clip.duration * fraction);
      gltf.scene.updateMatrixWorld(true);
      for (const ankle of [ankleL, ankleR]) {
        ankle.getWorldPosition(point);
        ranges.x.min = Math.min(ranges.x.min, point.x);
        ranges.x.max = Math.max(ranges.x.max, point.x);
        ranges.z.min = Math.min(ranges.z.min, point.z);
        ranges.z.max = Math.max(ranges.z.max, point.z);
      }
    }
    const xRange = ranges.x.max - ranges.x.min;
    const zRange = ranges.z.max - ranges.z.min;
    if (zRange < 0.2 || zRange < xRange * 1.8) {
      failures.push(`${character.key}: ${clipName} locomotion is not forward-axis dominant (x=${xRange.toFixed(3)}, z=${zRange.toFixed(3)})`);
    }
    mixer.stopAllAction();
  }
}

function validateIdleCombatPose(character, gltf) {
  const byName = new Map();
  gltf.scene.traverse((object) => {
    if (object.isBone) byName.set(object.name, object);
  });
  const handL = byName.get("Hand_L");
  const handR = byName.get("Hand_R");
  if (!handL || !handR) return;

  gltf.scene.updateMatrixWorld(true);
  const bindL = new THREE.Vector3();
  const bindR = new THREE.Vector3();
  const point = new THREE.Vector3();
  handL.getWorldPosition(bindL);
  handR.getWorldPosition(bindR);

  const clip = gltf.animations.find((candidate) => candidate.name === "idle");
  if (!clip) return;
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.reset().play();

  let maxLeft = 0;
  let maxRight = 0;
  for (const fraction of CLIP_SAMPLE_FRACTIONS) {
    mixer.setTime(clip.duration * fraction);
    gltf.scene.updateMatrixWorld(true);
    handL.getWorldPosition(point);
    maxLeft = Math.max(maxLeft, point.distanceTo(bindL));
    handR.getWorldPosition(point);
    maxRight = Math.max(maxRight, point.distanceTo(bindR));
  }
  mixer.stopAllAction();

  if (maxLeft < MIN_IDLE_HAND_BIND_DELTA || maxRight < MIN_IDLE_HAND_BIND_DELTA) {
    failures.push(
      `${character.key}: idle hands remain too close to bind/T-pose (left=${maxLeft.toFixed(3)}, right=${maxRight.toFixed(3)})`,
    );
  }
}

for (const asset of manifest.assets) {
  if (!asset.runtimeApproved) continue;
  const gltf = await loadGlb(asset.url);
  assertAssetBounds(asset, boxFromScene(gltf.scene));
}

let manifestChanged = false;
const EPSILON = 1e-4;

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
  if (!MOTION_PROFILES.has(character.motionProfile)) {
    failures.push(`${character.key}: invalid or missing motionProfile ${character.motionProfile}`);
  }
  for (const [slot, clipName] of Object.entries(character.clips ?? {})) {
    if (!clipNames.has(clipName)) failures.push(`${character.key}: clip slot ${slot} points to missing clip ${clipName}`);
  }
  validateCharacterClips(character, gltf);
  validateAnimatedPoseBounds(character, gltf);
  validateLocomotionAxis(character, gltf);
  validateIdleCombatPose(character, gltf);
  const rootTracks = rootMotionTracks(gltf);
  if (rootTracks.length > 0) failures.push(`${character.key}: unstripped root motion tracks: ${rootTracks.slice(0, 8).join("; ")}`);
  const hash = await fileHash(character.url);
  if (character.assetVersion !== hash) {
    character.assetVersion = hash;
    manifestChanged = true;
  }

  const strideNorm = await readStrideNorm(character.url);
  if (strideNorm && JSON.stringify(character.strideNorm ?? {}) !== JSON.stringify(strideNorm)) {
    character.strideNorm = strideNorm;
    manifestChanged = true;
  }

  // Record the bind-pose height/foot-offset once, offline, so the client can
  // trust these numbers instead of re-measuring a freshly-cloned SkinnedMesh
  // at runtime (see AnimatedCharacter.tsx) - the same pattern already used
  // for dungeon asset `bounds` above.
  const bounds = boundsFromScene(gltf.scene);
  const heightChanged = typeof character.naturalHeight !== "number" || Math.abs(character.naturalHeight - bounds.height) > EPSILON;
  const minYChanged = typeof character.restMinY !== "number" || Math.abs(character.restMinY - bounds.minY) > EPSILON;
  if (heightChanged || minYChanged) {
    character.naturalHeight = Number(bounds.height.toFixed(5));
    character.restMinY = Number(bounds.minY.toFixed(5));
    manifestChanged = true;
  }
}

for (const warning of warnings) console.warn(`[warn] ${warning}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`[fail] ${failure}`);
  process.exit(1);
}

if (manifestChanged) {
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("[ok] recorded updated character metadata into runtime manifest");
}

console.log(`[ok] Synty runtime manifest validated: ${manifest.assets.filter((a) => a.runtimeApproved).length} assets approved`);
