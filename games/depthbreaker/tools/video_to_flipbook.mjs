// Higgsfield clip -> flipbook sprite sheet, one command.
//
//   node tools/video_to_flipbook.mjs <video> <skillId>_<slot> [--grid 8x8] [--cell 256] [--fps 24]
//   e.g. node tools/video_to_flipbook.mjs fireburst.mp4 fireball_impact
//
// Writes client/public/vfx/<name>.png and prints the SheetSpec to paste into
// skillVfx.ts. The clip MUST be rendered on a PURE BLACK background (see
// docs/VFX_PROMPT_SHEET.md) — additive blending makes black transparent, so
// no alpha matting is ever needed. Requires ffmpeg on PATH.

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [video, name, ...rest] = process.argv.slice(2);
if (!video || !name) {
  console.error("usage: node tools/video_to_flipbook.mjs <video> <skillId>_<slot> [--grid 8x8] [--cell 256] [--fps 24]");
  process.exit(1);
}
const arg = (flag, def) => {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : def;
};
const [cols, rows] = arg("--grid", "8x8").split("x").map(Number);
const cell = Number(arg("--cell", "256"));
const fps = Number(arg("--fps", "24"));
const frames = cols * rows;

try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ffmpeg not found on PATH. Install it (winget install ffmpeg) and re-run.");
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(repoRoot, "client", "public", "vfx");
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `${name}.png`);

// Probe duration so the N frames sample the WHOLE clip evenly.
const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).toString().trim();
const duration = Math.max(0.2, parseFloat(probe) || 2);
const sampleFps = frames / duration;

// One ffmpeg pass: resample -> scale to cell -> tile into the grid.
execFileSync("ffmpeg", [
  "-y", "-i", video,
  "-vf", `fps=${sampleFps.toFixed(4)},scale=${cell}:${cell}:force_original_aspect_ratio=increase,crop=${cell}:${cell},tile=${cols}x${rows}`,
  "-frames:v", "1",
  out,
], { stdio: ["ignore", "ignore", "inherit"] });

if (!existsSync(out)) {
  console.error("ffmpeg produced no output");
  process.exit(1);
}
console.log(`wrote ${out}`);
console.log(`\nPaste into the skill's entry in client/src/game/fx/skillVfx.ts:`);
console.log(`  sheet: { url: "/vfx/${name}.png", cols: ${cols}, rows: ${rows}, fps: ${fps}, size: 2.2 },`);
