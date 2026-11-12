#!/usr/bin/env node
// Score our Cq against CFX's own export, plate by plate.
//
//   node score_against_cfx.mjs <目录...> [--weight 0.35] [--baseline cfx|declared] [--quiet]
//
// Looks for a `<run> -  Quantification Cq Results.csv` next to each `.pcrd`, parses CFX's Cq
// column, and compares it with what the library computes under the same settings the app ships.
import fs from "node:fs";
import path from "node:path";
import core from "../zpcrweb/packages/core/dist/index.cjs";

const PASSWORD = "SecureCompressDecompressKeyiQ5V4Files!!##$$";
const args = process.argv.slice(2);
let weight = 0.35;
let baselineRule = "cfx";
let method = "curvature";
let offset = 0;
let quiet = false;
const roots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--weight") weight = Number(args[++i]);
  else if (args[i] === "--baseline") baselineRule = args[++i];
  else if (args[i] === "--method") method = args[++i];
  else if (args[i] === "--offset") offset = Number(args[++i]);
  else if (args[i] === "--quiet") quiet = true;
  else roots.push(args[i]);
}
if (roots.length === 0) roots.push("/Volumes/这是新的u盘/q-PCR");

const ROWS = "ABCDEFGH";
const isData = (n) => /\.(pcrd|zpcr)$/i.test(n) && !n.startsWith("._");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** `admin_2026-11-06 22-47-10_BR009578.pcrd` → `admin_2026-11-06 22-47-10_BR009578` */
const stem = (file) => path.basename(file).replace(/\.(pcrd|zpcr)$/i, "");

function readReference(csvPath) {
  const text = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = lines[0].split(",").map((h) => h.trim());
  const iWell = head.indexOf("Well");
  const iCq = head.indexOf("Cq");
  if (iWell < 0 || iCq < 0) return null;
  const out = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const well = (cells[iWell] ?? "").trim().replace(/^([A-H])0?(\d{1,2})$/, "$1$2");
    const cq = Number(cells[iCq]);
    if (/^[A-H]\d{1,2}$/.test(well) && Number.isFinite(cq) && cq > 0) out.set(well, cq);
  }
  return out;
}

const files = roots.flatMap(walk);
const plates = new Map(); // stem → { pcrd, ref }
for (const f of files) {
  if (isData(f)) {
    const key = path.join(path.dirname(f), stem(f));
    const entry = plates.get(key) ?? {};
    entry.pcrd = f;
    plates.set(key, entry);
  } else if (/Quantification Cq Results.*\.csv$/i.test(f)) {
    const key = path.join(
      path.dirname(f),
      path.basename(f).replace(/\s*-\s*Quantification Cq Results.*\.csv$/i, ""),
    );
    const entry = plates.get(key) ?? {};
    entry.ref = f;
    plates.set(key, entry);
  }
}

const results = [];
for (const [key, { pcrd, ref }] of plates) {
  if (!pcrd || !ref) continue;
  const folder = path.basename(path.dirname(pcrd));
  let parsed;
  try {
    parsed = await core.pcrdFromFile(pcrd, { password: PASSWORD });
  } catch {
    continue;
  }
  if (!parsed?.zpcr) continue;
  const zpcr = parsed.zpcr;
  const steps = zpcr.steps();
  if (steps.length === 0) continue;
  const cqTable = core.computeRunAnalysis(
    zpcr,
    { autoThresholdMethod: method, baselineRule, curvatureWeight: weight },
    steps[0].step,
  ).cqTable;

  const ours = new Map();
  for (const [k, row] of cqTable) {
    const [r, c] = k.split(",");
    const label = `${ROWS[Number(r)]}${Number(c) + 1}`;
    if (!ours.has(label) && row.cq != null) ours.set(label, { cq: row.cq, threshold: row.groupThreshold });
  }
  const reference = readReference(ref);
  if (!reference) continue;

  const deltas = [];
  let threshold = null;
  for (const [well, cfx] of reference) {
    const mine = ours.get(well);
    if (!mine) continue;
    threshold = mine.threshold ?? threshold;
    deltas.push({ well, d: mine.cq + offset - cfx });
  }
  if (deltas.length === 0) continue;
  const abs = deltas.map((x) => Math.abs(x.d));
  results.push({
    run: path.basename(pcrd).replace(/\.(pcrd|zpcr)$/i, ""),
    folder,
    n: deltas.length,
    mean: abs.reduce((a, b) => a + b, 0) / abs.length,
    max: Math.max(...abs),
    bias: deltas.reduce((a, x) => a + x.d, 0) / deltas.length,
    within: abs.filter((x) => x <= 0.1).length / abs.length,
    threshold,
    worst: [...deltas].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3),
  });
}

results.sort((a, b) => b.mean - a.mean);
const total = results.reduce((a, r) => a + r.n, 0);
const weighted = results.reduce((a, r) => a + r.mean * r.n, 0) / total;
const pass = results.filter((r) => r.mean <= 0.05 && r.max <= 0.3 && r.within >= 0.95).length;

if (!quiet) {
  console.log(`阈值 ${method} / 权重 ${weight} / 基线 ${baselineRule}：${results.length} 块板，${total} 孔`);
  for (const r of results) {
    console.log(
      `  ${r.mean.toFixed(2)}  ${r.within >= 0.95 ? "✔" : " "} ${r.run.slice(0, 54).padEnd(54)} n=${String(r.n).padStart(2)} 最大 ${r.max.toFixed(2)} 偏 ${r.bias >= 0 ? "+" : ""}${r.bias.toFixed(2)}`,
    );
  }
}
console.log(
  `合计：加权平均 |ΔCq| ${weighted.toFixed(3)}，达标 ${pass}/${results.length} 块（门槛 mean≤0.05、max≤0.3、≥95% 孔 ≤0.1）`,
);
fs.writeFileSync("/tmp/score.json", JSON.stringify({ weight, baselineRule, results, weighted, pass }, null, 2));
