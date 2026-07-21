import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

globalThis.self = globalThis;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const glb = path.join(repoRoot, "client/public/models/synty/depthbreaker/characters/warrior.glb");
const data = await fs.readFile(glb);
const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const gltf = await new GLTFLoader().parseAsync(ab, "");
const byName = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));

const bones = new Map();
gltf.scene.traverse((o) => { if (o.isBone) bones.set(o.name, o); });
const SAMPLE = ["Hand_R", "Shoulder_L", "Head", "Ankle_L"];

function poseAt(clip, t) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.reset().play();
  mixer.setTime(t);
  gltf.scene.updateMatrixWorld(true);
  const out = {};
  const v = new THREE.Vector3();
  for (const b of SAMPLE) { const bone = bones.get(b); if (bone) { bone.getWorldPosition(v); out[b] = v.clone(); } }
  mixer.stopAllAction();
  return out;
}

console.log("=== loop seam via mixer sampling (world pos at t=0 vs t=dur; small = seamless) ===");
for (const name of ["idle", "walk", "run", "sprint"]) {
  const c = byName[name];
  if (!c) continue;
  const p0 = poseAt(c, 0);
  const pEnd = poseAt(c, c.duration);
  const pMid = poseAt(c, c.duration * 0.5);
  const parts = SAMPLE.map((b) => {
    if (!p0[b]) return `${b}:n/a`;
    const seam = p0[b].distanceTo(pEnd[b]);
    const amp = p0[b].distanceTo(pMid[b]); // how much it moves mid-cycle
    return `${b}: seam=${seam.toFixed(3)} amp=${amp.toFixed(3)}`;
  });
  console.log(`\n${name} (dur ${c.duration.toFixed(3)}s):\n  ${parts.join("\n  ")}`);
}

