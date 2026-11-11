/**
 * Score Cq methods (`packages/core/src/cqMethod.ts`) against a corpus of real runs. See
 * `tools/cqeval.md` for usage and for what each column means.
 *
 * Runs the library from **source** (through vite-node), not from `dist/`, so a method being
 * written is scored without a build — and several people editing different method files can score
 * at once without racing over one `dist/`.
 *
 * The library half of `cqeval.mjs`: `loadCorpus()` + `scoreRefiner()` are what a script exploring
 * a method's parameters imports, so a candidate is scored by exactly the numbers the CLI reports.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  applyRefiner,

  computeRunAnalysis,
  curveKey,
  parseBiomeme,
  parsePcrd,
  parseZpcr,
  parseZpcrwebSettings,
  runAnalysisSettingsFromZpcrweb,
} from "../packages/core/src/index.ts";

const REPO = resolve(new URL("..", import.meta.url).pathname);
const LAB = process.env.MOLBIOLAB ?? join(process.env.HOME ?? "", "lab/MolBioLab");

function cfxPassword() {
  const p = join(REPO, "secrets.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")).cfxPassword : undefined;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * The corpus's file list. `cfx` is every CFX `.zpcr` under the lab repo plus the repo's own
 * samples, deduplicated by file name (the lab repo wins); `biomeme` is every `.bmrun`, likewise
 * deduplicated — the lab repo keeps the same export in more than one experiment folder.
 */
export function corpusFiles(set = "cfx") {
  const pick = (re) => {
    const byName = new Map();
    for (const p of [...walk(join(LAB, "experiments")), ...walk(join(LAB, "biomeme")), ...walk(join(REPO, "samples"))]) {
      if (!re.test(p)) continue;
      const k = basename(p).replace(/\.(zpcr|pcrd)$/i, "");
      if (!byName.has(k)) byName.set(k, p);
    }
    return [...byName.values()].sort();
  };
  const cfx = pick(/\.(zpcr|pcrd)$/i).filter((p) => !/gradient|GRADIENT/.test(p));
  const biomeme = pick(/\.bmrun$/i);
  if (set === "cfx") return cfx;
  if (set === "biomeme") return biomeme;
  return [...cfx, ...biomeme];
}

function loadZpcr(path, password) {
  const bytes = new Uint8Array(readFileSync(path));
  if (/\.bmrun$/i.test(path)) return parseBiomeme(bytes);
  if (/\.pcrd$/i.test(path)) return parsePcrd(bytes, password ? { password } : undefined).zpcr;
  return parseZpcr(bytes);
}

/**
 * Every **positive** curve of every run — every loaded well/dye pair whose threshold Cq exists —
 * plus the negatives' count, with each run analysed exactly as the app would open it (its own
 * `zpcrweb.json` thresholds honoured; a Biomeme run on this library's own Cq, not the device's).
 */
export function loadCorpus({ set = "cfx", files, settingsPatch } = {}) {
  const password = cfxPassword();
  const runs = [];
  for (const path of files ?? corpusFiles(set)) {
    let zpcr;
    try {
      zpcr = loadZpcr(path, password);
    } catch (e) {
      console.error(`skip ${basename(path)}: ${e.message}`);
      continue;
    }
    if (!zpcr) continue;
    const settings = runAnalysisSettingsFromZpcrweb(parseZpcrwebSettings(zpcr));
    if (!settings.thresholdOverrides && zpcr.persistedThresholds) {
      settings.thresholdOverrides = zpcr.persistedThresholds;
    }
    settings.cqSource = "computed";
    settings.baselineSource = "computed";
    settings.cqMethod = "threshold";
    if (settingsPatch) Object.assign(settings, settingsPatch);
    const step = zpcr.steps()[0]?.step;
    let run;
    try {
      run = computeRunAnalysis(zpcr, settings, step, password);
    } catch (e) {
      console.error(`skip ${basename(path)}: ${e.message}`);
      continue;
    }
    if (!run.plate) continue;
    const curves = [];
    let negatives = 0;
    const byKey = new Map(run.allFluorCurves.map((c) => [curveKey(c.row, c.col, c.dye), c]));
    for (const w of run.plate.wells) {
      if (!w.loaded) continue;
      for (const wf of w.fluors) {
        const key = curveKey(w.row, w.col, wf.fluor);
        const e = run.cqTable.get(key);
        const c = byKey.get(key);
        if (!e || !c) continue;
        if (e.thresholdCq == null) {
          negatives++;
          continue;
        }
        curves.push({
          run: basename(path),
          key,
          well: w.label,
          fluor: wf.fluor,
          target: run.groupOf(w.row, w.col, wf.fluor) ?? "",
          sample: w.sample ?? "",
          sampleType: w.sampleType,
          deviceCq: c.fileAnalysis?.cq ?? null,
          input: {
            cycles: c.cycles,
            values: c.mean,
            corrected: e.correctedValues,
            baselineFit: e.baselineFit,
            baselineRegion: e.baselineRegion,
            noise: e.noise,
            threshold: e.threshold,
            thresholdCq: e.thresholdCq,
          },
        });
      }
    }
    runs.push({ path, name: basename(path), curves, negatives });
  }
  return runs;
}

/**
 * Where the curve visibly leaves its noise: the fractional cycle at which the corrected curve last
 * rises through `k × σ` before its threshold Cq. A Cq more than a cycle before `rise(3)` is being
 * reported where the data are still indistinguishable from noise — "pushed back too far".
 */
export function riseCycle(input, k) {
  const { cycles, corrected, noise, thresholdCq } = input;
  const level = k * noise;
  let i = cycles.findIndex((c) => c > thresholdCq);
  if (i < 0) i = cycles.length - 1;
  for (; i > 0; i--) {
    if (corrected[i - 1] < level && corrected[i] >= level) {
      return cycles[i - 1] + (level - corrected[i - 1]) / (corrected[i] - corrected[i - 1]);
    }
    if (corrected[i - 1] < level) break;
  }
  return cycles[Math.max(i, 0)];
}

function quantile(xs, q) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

function sd(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Score one refiner over a corpus. Returns per-curve rows and a summary:
 *
 * - `shift` — threshold Cq minus the method's Cq (≥ 0 by contract): how much earlier it calls.
 * - `tooEarly` — curves whose Cq lands more than `tooEarlyMargin` cycles before `rise(3σ)`.
 * - `repSd` — median replicate standard deviation of Cq, over groups of ≥ 2 positive wells sharing
 *   a run, sample, target and dye. A Cq that tracks the curve better should not scatter more.
 */
export function scoreRefiner(runs, refine, { tooEarlyMargin = 1 } = {}) {
  const rows = [];
  for (const r of runs) {
    for (const c of r.curves) {
      const cq = applyRefiner(refine, c.input);
      const thr = c.input.thresholdCq;
      rows.push({
        run: r.name,
        well: c.well,
        fluor: c.fluor,
        target: c.target,
        sample: c.sample,
        sampleType: c.sampleType,
        thresholdCq: thr,
        cq,
        shift: thr - cq,
        rise3: riseCycle(c.input, 3),
        rise5: riseCycle(c.input, 5),
        deviceCq: c.deviceCq,
        curve: c,
      });
    }
  }
  for (const row of rows) row.tooEarly = row.cq < row.rise3 - tooEarlyMargin;

  const groups = new Map();
  for (const row of rows) {
    if (!row.sample || /ntc|nrt|negative/i.test(row.sampleType)) continue;
    // The plate row too: a plate that names no target (a qualification plate) keeps one gene per
    // row, so the same sample in two rows is two assays, not replicates.
    const k = [row.run, row.sample, row.target, row.fluor, row.well.replace(/\d+$/, "")].join("|");
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const repThr = [];
  const repNew = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    repThr.push(sd(g.map((x) => x.thresholdCq)));
    repNew.push(sd(g.map((x) => x.cq)));
  }
  const clean = repThr.map((t, i) => [t, repNew[i]]).filter(([t]) => t < 1);
  const shifts = rows.map((x) => x.shift);
  const summary = {
    positives: rows.length,
    negatives: runs.reduce((a, r) => a + r.negatives, 0),
    meanShift: shifts.reduce((a, b) => a + b, 0) / Math.max(shifts.length, 1),
    medianShift: quantile(shifts, 0.5),
    p90Shift: quantile(shifts, 0.9),
    maxShift: Math.max(0, ...shifts),
    unchanged: rows.filter((x) => x.shift === 0).length,
    tooEarly: rows.filter((x) => x.tooEarly).length,
    medianLeadOverRise3: quantile(rows.map((x) => x.rise3 - x.cq), 0.5),
    replicateGroups: repThr.length,
    repSdThreshold: quantile(repThr, 0.5),
    repSdMethod: quantile(repNew, 0.5),
    repSdThresholdMean: repThr.reduce((a, b) => a + b, 0) / Math.max(repThr.length, 1),
    repSdMethodMean: repNew.reduce((a, b) => a + b, 0) / Math.max(repNew.length, 1),
    // The same, over "clean" groups only — threshold-Cq SD under 1 cycle — where scatter is
    // measurement precision rather than mislabelled or genuinely different wells.
    cleanGroups: clean.length,
    repSdCleanThreshold: clean.reduce((a, [t]) => a + t, 0) / Math.max(clean.length, 1),
    repSdCleanMethod: clean.reduce((a, [, m]) => a + m, 0) / Math.max(clean.length, 1),
  };
  return { rows, summary };
}

// ---- Plots -------------------------------------------------------------------------------------

const COLORS = ["#ff4fd8", "#3ef0ff", "#ffd23e", "#7dff6b", "#ff8a3e", "#b48cff"];

function tileSvg(row, marks, { w = 300, h = 170, log = false } = {}) {
  const { cycles, corrected, noise, threshold, thresholdCq } = row.curve.input;
  const floor = Math.max(noise * 0.5, 1e-3);
  const ys = corrected.map((v) => (log ? Math.log10(Math.max(v, floor)) : v));
  const x0 = cycles[0];
  const x1 = cycles.at(-1);
  const yMin = log ? Math.log10(floor) : Math.min(...ys, -3 * noise);
  const yMax = Math.max(...ys, log ? Math.log10(threshold * 2) : threshold * 1.2);
  const pad = 18;
  const X = (c) => pad + ((c - x0) / (x1 - x0)) * (w - pad - 4);
  const Y = (v) => h - pad - ((v - yMin) / (yMax - yMin || 1)) * (h - pad - 14);
  const pts = cycles.map((c, i) => `${X(c).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(" ");
  const tY = Y(log ? Math.log10(threshold) : threshold);
  const nY = Y(log ? Math.log10(3 * noise) : 3 * noise);
  const interp = (cq) => {
    const i = cycles.findIndex((c) => c >= cq);
    if (i <= 0) return ys[0];
    const t = (cq - cycles[i - 1]) / (cycles[i] - cycles[i - 1]);
    return ys[i - 1] + t * (ys[i] - ys[i - 1]);
  };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="background:#0d0f17">`;
  for (let c = Math.ceil(x0 / 5) * 5; c <= x1; c += 5) {
    s += `<line x1="${X(c)}" x2="${X(c)}" y1="14" y2="${h - pad}" stroke="#222838"/>`;
    s += `<text x="${X(c)}" y="${h - 5}" fill="#667" font-size="9" text-anchor="middle">${c}</text>`;
  }
  s += `<line x1="${pad}" x2="${w}" y1="${tY}" y2="${tY}" stroke="#ffffff" stroke-dasharray="3 3" opacity="0.5"/>`;
  s += `<line x1="${pad}" x2="${w}" y1="${nY}" y2="${nY}" stroke="#7a8" stroke-dasharray="1 3" opacity="0.6"/>`;
  s += `<polyline points="${pts}" fill="none" stroke="#9fb4ff" stroke-width="1.4"/>`;
  for (const [cx] of cycles.map((c, i) => [X(c), i])) s += `<circle cx="${cx}" cy="${0}" r="0"/>`;
  s += `<circle cx="${X(thresholdCq)}" cy="${Y(interp(thresholdCq))}" r="4" fill="none" stroke="#fff" stroke-width="1.5"/>`;
  marks.forEach((m, j) => {
    if (m.cq == null || m.cq === thresholdCq) return;
    s += `<circle cx="${X(m.cq)}" cy="${Y(interp(m.cq))}" r="4" fill="none" stroke="${COLORS[j % COLORS.length]}" stroke-width="1.8"/>`;
  });
  const label = `${row.run.replace(/\.(zpcr|pcrd|bmrun)$/, "").slice(0, 22)} ${row.well} ${row.fluor}`;
  s += `<text x="4" y="11" fill="#ccd" font-size="10">${label}${log ? " (log)" : ""}</text>`;
  const cqText = [`thr ${thresholdCq.toFixed(2)}`, ...marks.map((m) => `${m.name} ${m.cq?.toFixed(2)}`)].join("  ");
  s += `<text x="${w - 4}" y="23" fill="#99a" font-size="9" text-anchor="end">${cqText}</text>`;
  return s + "</svg>";
}

/**
 * Write contact sheets of every positive curve, linear and log side by side, with the threshold
 * Cq as a white ring and each scored method's Cq as a coloured one. The dashed white line is the
 * threshold, the dotted green one 3σ. `scored` is `[{name, rows}]`, rows aligned across methods.
 */
export function writePlots(scored, outDir, { perSheet = 24, filter = () => true, chrome } = {}) {
  mkdirSync(outDir, { recursive: true });
  const base = scored[0].rows;
  const idx = base.map((_, i) => i).filter((i) => filter(base[i], scored.map((s) => s.rows[i])));
  const files = [];
  for (let start = 0; start < idx.length; start += perSheet) {
    const chunk = idx.slice(start, start + perSheet);
    let html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#05060a;font-family:sans-serif">`;
    html += `<div style="color:#ccd;font-size:12px;padding:4px">white ring = threshold Cq; ${scored
      .map((s, j) => `<span style="color:${COLORS[j % COLORS.length]}">${s.name}</span>`)
      .join(", ")}; dashed = threshold, dotted = 3σ</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(4,300px);gap:3px;padding:3px">`;
    for (const i of chunk) {
      const marks = scored.map((s) => ({ name: s.name, cq: s.rows[i].cq }));
      html += tileSvg(base[i], marks) + tileSvg(base[i], marks, { log: true });
    }
    html += `</div></body>`;
    const n = String(files.length + 1).padStart(2, "0");
    const htmlPath = join(outDir, `sheet-${n}.html`);
    const pngPath = join(outDir, `sheet-${n}.png`);
    writeFileSync(htmlPath, html);
    const rows = Math.ceil((chunk.length * 2) / 4);
    shoot(htmlPath, pngPath, 1220, 30 + rows * 173, chrome);
    files.push(pngPath);
  }
  return files;
}

function shoot(htmlPath, pngPath, w, h, chrome) {
  const bin = chrome ?? process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = join(process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, "tmp") : tmpdir(), `cqeval-chrome-${process.pid}`);
  execFileSync(
    bin,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-component-update",
      "--disable-background-networking",
      "--hide-scrollbars",
      `--user-data-dir=${profile}`,
      `--window-size=${w},${h}`,
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: "ignore", timeout: 60000 },
  );
}

// ---- CLI ---------------------------------------------------------------------------------------

function fmt(v) {
  return typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v);
}

export function printSummaries(named) {
  const keys = Object.keys(named[0].summary);
  const width = Math.max(...named.map((n) => n.name.length), 8);
  console.log(["metric".padEnd(22), ...named.map((n) => n.name.padStart(width))].join(" "));
  for (const k of keys) {
    console.log([k.padEnd(22), ...named.map((n) => fmt(n.summary[k]).padStart(width))].join(" "));
  }
}

export function rowsCsv(named) {
  const head = ["run", "well", "fluor", "target", "sample", "sampleType", "thresholdCq", "rise3", "rise5", "deviceCq", ...named.map((n) => n.name)];
  const lines = [head.join(",")];
  named[0].rows.forEach((r, i) => {
    lines.push(
      [r.run, r.well, r.fluor, r.target, r.sample, r.sampleType, r.thresholdCq, r.rise3, r.rise5, r.deviceCq ?? "", ...named.map((n) => n.rows[i].cq)]
        .map((v) => (typeof v === "number" ? v.toFixed(3) : `"${String(v).replace(/"/g, '""')}"`))
        .join(","),
    );
  });
  return lines.join("\n") + "\n";
}

