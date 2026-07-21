// Pull PNG sprites straight out of a Synty (or any) .unitypackage — no Unity.
// A .unitypackage is a gzipped tar of <guid>/{asset,pathname,...}; `asset` is the
// raw file and `pathname` is its original Assets/... path. This lists or extracts
// the PNGs, optionally filtered by name substrings, renaming them to their
// original basenames.
//
// Usage:
//   node tools/extract_unitypackage_pngs.mjs <package.unitypackage> --list
//   node tools/extract_unitypackage_pngs.mjs <package.unitypackage> <outDir> [nameSubstr ...]
//
// Examples:
//   node tools/extract_unitypackage_pngs.mjs "C:/.../INTERFACE_Dark_Fantasy_HUD...unitypackage" --list | grep Frame_Bar
//   node tools/extract_unitypackage_pngs.mjs "C:/.../HUD.unitypackage" client/public/ui/synty Frame_Bar_01 Frame_Box_Medium_01_Variant_01
//
// Notes: shells out to `tar` (Git Bash / macOS / Linux). Windows paths with a
// drive letter need tar's --force-local, which this passes automatically.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

const [pkg, outArg, ...filters] = process.argv.slice(2);
if (!pkg || !outArg) {
  console.error("usage: node extract_unitypackage_pngs.mjs <package> <outDir | --list> [nameSubstr ...]");
  process.exit(1);
}
const listOnly = outArg === "--list";

const tmp = mkdtempSync(join(tmpdir(), "unitypkg-"));
// Extract only the small pathname + raw asset members (skip previews/metas).
// MSYS/GNU tar on Windows rejects backslash paths — normalize to forward slashes.
const fwd = (p) => p.replace(/\\/g, "/");
execFileSync("tar", ["--force-local", "-xzf", fwd(pkg), "-C", fwd(tmp), "--wildcards", "*/asset", "*/pathname"], { stdio: "inherit" });

const rows = [];
for (const guid of readdirSync(tmp)) {
  const pn = join(tmp, guid, "pathname");
  const asset = join(tmp, guid, "asset");
  if (!existsSync(pn) || !existsSync(asset)) continue;
  const p = readFileSync(pn, "utf8").split("\n")[0].trim();
  if (!/\.png$/i.test(p)) continue;
  if (filters.length && !filters.some((f) => p.includes(f))) continue;
  rows.push({ path: p, asset });
}

if (listOnly) {
  for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) console.log(r.path);
  console.error(`\n${rows.length} png(s)${filters.length ? ` matching [${filters.join(", ")}]` : ""}`);
} else {
  mkdirSync(outArg, { recursive: true });
  let n = 0;
  for (const r of rows) {
    copyFileSync(r.asset, join(outArg, basename(r.path)));
    n++;
  }
  console.log(`extracted ${n} png(s) -> ${outArg}`);
}
