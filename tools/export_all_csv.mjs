#!/usr/bin/env node
// 批量把 .pcrd / .zpcr 导出成 CSV：每块板一份 Cq 表（含 Tm），再合并成一张总表。
//
//   node export_all_csv.mjs <目录或文件...> [-o 输出目录] [--melt] [--min-peak 150]
//
// 算法与 App 里「定量数据」页一致：自动阈值 = 曲率法（CFX 的加权位置规则），
// 基线 = 文件声明的循环区间；熔解按 CFX 的 Savitzky–Golay 二次五点求导取峰。
import fs from "node:fs";
import path from "node:path";
import core from "../zpcrweb/packages/core/dist/index.cjs";

const PASSWORD = "SecureCompressDecompressKeyiQ5V4Files!!##$$";
const MIN_PEAK = 150;

const args = process.argv.slice(2);
let outDir = null;
let wantCurves = true;
let minPeak = MIN_PEAK;
const inputs = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-o" || a === "--out") outDir = args[++i];
  else if (a === "--curves") wantCurves = true;
  else if (a === "--no-curves") wantCurves = false;
  else if (a === "--min-peak") minPeak = Number(args[++i]);
  else inputs.push(a);
}
if (inputs.length === 0) {
  console.error("用法: node export_all_csv.mjs <目录或文件...> [-o 输出目录] [--melt]");
  process.exit(2);
}
if (!outDir) {
  const stamp = new Date().toISOString().slice(0, 10);
  outDir = path.join(process.env.HOME, "Documents", `qPCR导出_${stamp}`);
}
fs.mkdirSync(outDir, { recursive: true });

const isData = (name) => /\.(pcrd|zpcr)$/i.test(name) && !name.startsWith("._");

function walk(target) {
  const out = [];
  const st = fs.statSync(target);
  if (st.isFile()) {
    if (isData(path.basename(target))) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === ".Trashes" || entry.name === ".Spotlight-V100") continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (isData(entry.name)) out.push(full);
  }
  return out;
}

const files = inputs.flatMap(walk).sort();
if (files.length === 0) {
  console.error("没找到 .pcrd / .zpcr 文件");
  process.exit(2);
}

const q = (v) => {
  if (v == null || v === "") return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (v, digits = 3) =>
  v == null || !Number.isFinite(v) ? "" : Number(v.toFixed(digits)).toString();

const ROWS = "ABCDEFGH";
const combined = [];
const failures = [];
const started = Date.now();
let ampCount = 0;
let meltCount = 0;

for (const [i, file] of files.entries()) {
  const rel = path.basename(path.dirname(file)) + "/" + path.basename(file);
  process.stdout.write(`\r[${i + 1}/${files.length}] ${rel.slice(0, 70).padEnd(70)}`);
  try {
    const parsed = await core.pcrdFromFile(file, { password: PASSWORD });
    if (!parsed || !parsed.zpcr) throw new Error(parsed?.error ?? "unreadable");
    const zpcr = parsed.zpcr;
    const steps = zpcr.steps();
    if (steps.length === 0) throw new Error("no reads");

    // 扩增步 = 第一个步；熔解步 = 温度跨度足够大的那一步。
    const ampStep = steps[0].step;
    const segs = core.meltSegments(zpcr);
    const meltStep = segs.length > 0 ? segs[segs.length - 1].step : null;

    const analysis = core.computeRunAnalysis(
      zpcr,
      { autoThresholdMethod: "curvature", baselineRule: "cfx", curvatureWeight: 0.35 },
      ampStep,
    );

    const byWell = new Map(); // "A1" -> { cq, threshold, noise, deltaRfu, endRfu, baseline }
    for (const [key, row] of analysis.cqTable) {
      const [rIdx, cIdx] = key.split(",");
      const label = `${ROWS[Number(rIdx)]}${Number(cIdx) + 1}`;
      if (byWell.has(label)) continue; // 一块板只有 SYBR 一路，重复组取第一个
      byWell.set(label, row);
    }
    ampCount += byWell.size;

    const meltLines = [];
    const tmByWell = new Map();
    if (meltStep != null) {
      const analysisMelt = core.computeMeltAnalysisFor(zpcr, meltStep);
      for (const m of analysisMelt?.curves ?? []) {
        if (m.channel !== 0) continue;
        const label = `${ROWS[m.row]}${m.col + 1}`;
        const signal = core.hasMeltSignal(m.rfu);
        const peak = m.peakHeight ?? 0;
        if (signal && peak >= minPeak && Number.isFinite(m.tmC)) {
          tmByWell.set(label, { tm: m.tmC, peak });
        } else if (!tmByWell.has(label)) {
          tmByWell.set(label, { tm: null, peak });
        }
        if (wantCurves && m.temperaturesC) {
          const rows = [];
          for (let k = 0; k < m.temperaturesC.length; k++) {
            rows.push(
              [label, ROWS[m.row], m.col + 1, num(m.temperaturesC[k], 2), num(m.rfu[k], 3), num(m.derivative[k], 4)]
                .map(q)
                .join(","),
            );
          }
          if (wantCurves && meltLines.length > 0) {
      fs.writeFileSync(
        path.join(outDir, `${path.basename(file).replace(/\.(pcrd|zpcr)$/i, "")}_熔解曲线.csv`),
        ["Well,Row,Col,Temperature_C,RFU,Derivative", ...meltLines].join("\n") + "\n",
      );
    }

    if (wantCurves) {
      const cycleByWell = new Map();
      for (const c of zpcr.curves({ includeReference: false, step: ampStep })) {
        if (c.channel !== 0) continue;
        cycleByWell.set(`${ROWS[c.row]}${c.col + 1}`, c);
      }
      const ampLines = ["Well,Row,Col,Cycle,RFU,RFU_baseline_subtracted"];
      for (const [label, row] of byWell) {
        const curve = cycleByWell.get(label);
        if (!curve) continue;
        const cycles = curve.cycles ?? [];
        const raw = curve.mean ?? [];
        const corrected = row.correctedValues ?? [];
        for (let k = 0; k < cycles.length; k++) {
          ampLines.push(
            [label, label[0], label.slice(1), num(cycles[k], 0), num(raw[k], 2), num(corrected[k], 2)]
              .map(q)
              .join(","),
          );
        }
      }
      fs.writeFileSync(
        path.join(outDir, `${path.basename(file).replace(/\.(pcrd|zpcr)$/i, "")}_扩增曲线.csv`),
        ampLines.join("\n") + "\n",
      );
    }

    const name = path.basename(file).replace(/\.(pcrd|zpcr)$/i, "");
          const meltPath = path.join(outDir, `${name}_熔解曲线.csv`);
          const header = "Well,Row,Col,Temperature_C,RFU,Derivative\n";
          fs.appendFileSync(meltPath, header + rows.join("\n") + "\n");
        }
      }
      meltCount += [...tmByWell.values()].filter((v) => v.tm != null).length;
    }

    const name = path.basename(file).replace(/\.(pcrd|zpcr)$/i, "");
    const runDate = (path.basename(path.dirname(file)).match(/(20\d{6})/) ?? name.match(/(20\d{2})-?/) ?? [])[0]?.replace(/-/g, "") ?? "";
    const runFolder = path.basename(path.dirname(file));
    const lines = ["Well,Row,Col,Run,Cq,Threshold,Baseline,DeltaRFU,EndRFU,Tm_C,PeakHeight"];
    for (const r of ROWS.split("")) {
      for (let c = 1; c <= 12; c++) {
        const label = `${r}${c}`;
        const row = byWell.get(label);
        const tm = tmByWell.get(label);
        if (!row && !tm) continue;
        const cells = [
          label,
          r,
          String(c),
          runFolder,
          num(row?.cq, 2),
          num(row?.groupThreshold ?? row?.threshold, 1),
          row?.baselineRegion ? `${row.baselineRegion.beginCycle}-${row.baselineRegion.endCycle}` : "",
          num(row?.deltaRfu, 1),
          num(row?.endRfu, 1),
          tm?.tm != null ? num(tm.tm, 1) : "",
          tm?.peak != null ? num(tm.peak, 1) : "",
        ];
        lines.push(cells.map(q).join(","));
        combined.push({ runFolder, runDate, name, cells });
      }
    }
    fs.writeFileSync(path.join(outDir, `${name}_Cq.csv`), lines.join("\n") + "\n");
  } catch (err) {
    failures.push({ file: rel, error: String(err.message ?? err) });
  }
}
process.stdout.write("\r" + " ".repeat(72) + "\r");

const header = "Run,RunDate,File,Well,Row,Col,Cq,Threshold,Baseline,DeltaRFU,EndRFU,Tm_C,PeakHeight";
const rows = combined.map((r) =>
  [r.runFolder, r.runDate, r.name, ...r.cells.slice(0, 3), ...r.cells.slice(4)].map(q).join(","),
);
fs.writeFileSync(path.join(outDir, "全部_汇总.csv"), [header, ...rows].join("\n") + "\n");

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`文件 ${files.length} 个，成功 ${files.length - failures.length}，失败 ${failures.length}，用时 ${secs}s`);
console.log(`有 Cq 的孔 ${ampCount} 个，有 Tm 的孔 ${meltCount} 个`);
console.log(`输出目录 ${outDir}`);
for (const f of failures) console.log(`  ✗ ${f.file}: ${f.error}`);
