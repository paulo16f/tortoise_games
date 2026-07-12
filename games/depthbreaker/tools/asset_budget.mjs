import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const modelsDir = path.join(root, "client", "public", "models");

const DEFAULT_BUDGETS_MIB = {
  total: 140,
  largestFile: 16,
  groups: {
    kaykit: 20,
    synty: 120,
  },
};

function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number.`);
  return value;
}

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

function mib(bytes) {
  return bytes / 1024 / 1024;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function groupFor(rel) {
  return rel.split("/")[0] || "misc";
}

function formatMib(bytes) {
  return `${round(mib(bytes)).toFixed(3)} MiB`;
}

function budgets() {
  return {
    total: readNumberEnv("DEPTHBREAKER_ASSET_BUDGET_TOTAL_MIB", DEFAULT_BUDGETS_MIB.total),
    largestFile: readNumberEnv("DEPTHBREAKER_ASSET_BUDGET_LARGEST_FILE_MIB", DEFAULT_BUDGETS_MIB.largestFile),
    groups: Object.fromEntries(
      Object.entries(DEFAULT_BUDGETS_MIB.groups).map(([group, fallback]) => [
        group,
        readNumberEnv(`DEPTHBREAKER_ASSET_BUDGET_${group.toUpperCase()}_MIB`, fallback),
      ]),
    ),
  };
}

function buildReport() {
  const files = existsSync(modelsDir)
    ? walk(modelsDir)
        .map((file) => {
          const rel = path.relative(modelsDir, file).split(path.sep).join("/");
          const bytes = statSync(file).size;
          return { path: rel, group: groupFor(rel), bytes, mib: round(mib(bytes)) };
        })
        .sort((a, b) => a.path.localeCompare(b.path))
    : [];
  const groupMap = new Map();
  for (const file of files) {
    const group = groupMap.get(file.group) ?? { group: file.group, count: 0, bytes: 0, mib: 0 };
    group.count++;
    group.bytes += file.bytes;
    group.mib = round(mib(group.bytes));
    groupMap.set(file.group, group);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 12);
  const budget = budgets();
  const failures = [];
  if (mib(totalBytes) > budget.total) failures.push(`total ${formatMib(totalBytes)} > ${budget.total} MiB`);
  if (largest[0] && largest[0].mib > budget.largestFile) {
    failures.push(`largest file ${largest[0].path} ${largest[0].mib} MiB > ${budget.largestFile} MiB`);
  }
  for (const [group, maxMib] of Object.entries(budget.groups)) {
    const actual = groupMap.get(group)?.mib ?? 0;
    if (actual > maxMib) failures.push(`${group} ${actual} MiB > ${maxMib} MiB`);
  }
  return {
    generatedAt: new Date().toISOString(),
    root: "client/public/models",
    fileCount: files.length,
    totalMib: round(mib(totalBytes)),
    budgetsMib: budget,
    groups: [...groupMap.values()].sort((a, b) => b.bytes - a.bytes),
    largest,
    failures,
  };
}

const report = buildReport();
console.log(`models: ${report.fileCount} files, ${report.totalMib.toFixed(3)} MiB total`);
console.log("");
for (const group of report.groups) {
  const budget = report.budgetsMib.groups[group.group];
  const suffix = budget === undefined ? "" : ` / ${budget} MiB`;
  console.log(`${group.group.padEnd(12)} ${String(group.count).padStart(4)} ${group.mib.toFixed(3).padStart(9)} MiB${suffix}`);
}
console.log("");
for (const file of report.largest.slice(0, 8)) {
  console.log(`${file.mib.toFixed(3).padStart(8)} MiB  ${file.path}`);
}
if (report.failures.length > 0) {
  console.error("");
  for (const failure of report.failures) console.error(`asset budget failure: ${failure}`);
  process.exitCode = 1;
}

