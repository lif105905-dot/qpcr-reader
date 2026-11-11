#!/usr/bin/env node
/**
 * qpcr_read.mjs — 从 Bio-Rad CFX 的 .pcrd 原始文件里读出 Ct 与熔解曲线，导出 CSV。
 *
 * 用法：
 *   node qpcr_read.mjs <file.pcrd> [--password <pwd>] [--outdir <dir>] [--threshold <RFU>]
 *
 * 说明：
 *  - 解密用 ZipCrypto（CFX 标准版的固定密码，可用 --password 覆盖）。
 *  - 熔解曲线与 Tm 由 zpcrweb core 计算（SG5 平滑 → −dF/dT → 取峰）。
 *  - Ct 不在文件里，按 CFX 自己的基线窗口（XML 里的 baselineBeginRepeat/EndRepeat）+ 阈值穿越计算；
 *    阈值未给时用 k×（整板基线噪声中的 SD 中位数），k 默认 20（= zpcrweb 自带的 DEFAULT_THRESHOLD_MULTIPLIER；用 20261109 板与 CFX 官方 Cq 校准后平均差 ~0.5 循环）。
 */
import fs from 'node:fs';
import path from 'node:path';
import core from '/Users/lijiehui/Documents/qpcr-tool/zpcrweb/packages/core/dist/index.cjs';

const DEFAULT_PASSWORD = 'SecureCompressDecompressKeyiQ5V4Files!!##$$';

function args(argv) {
  const o = { file: null, password: DEFAULT_PASSWORD, outdir: null, threshold: null, k: 20, minPeak: 150 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--password') o.password = argv[++i];
    else if (a === '--outdir') o.outdir = argv[++i];
    else if (a === '--threshold') o.threshold = Number(argv[++i]);
    else if (a === '--k') o.k = Number(argv[++i]);
    else if (a === '--min-peak') o.minPeak = Number(argv[++i]);
    else if (a === '--all-channels') o.allChannels = true;
    else if (!o.file) o.file = a;
  }
  return o;
}

const opt = args(process.argv);
if (!opt.file) { console.error('用法: node qpcr_read.mjs <file.pcrd> [--password ..] [--outdir ..] [--threshold RFU]'); process.exit(2); }
const outdir = opt.outdir ?? path.dirname(opt.file);
fs.mkdirSync(outdir, { recursive: true });
const stem = path.basename(opt.file).replace(/\.pcrd$/i, '');

const res = core.pcrdFromFile(opt.file, { password: opt.password });
const doc = res instanceof Promise ? await res : res;
if (doc.error) { console.error('解密/解析失败：', doc.error); process.exit(1); }
const z = doc.zpcr, xml = doc.xml;

// ── 从 XML 取 CFX 自己的分析参数 ─────────────────────────────
const num = (re, dflt) => { const m = xml.match(re); return m ? Number(m[1]) : dflt; };
const baselineBegin = num(/baselineBeginRepeat="(-?\d+)"/, 2);
const baselineEnd = num(/baselineEndRepeat="(-?\d+)"/, 9);
const selectedStep = num(/selectedStepNumber="(\d+)"/, 2);
const meltStep = num(/selectedMeltStepNumber="(\d+)"/, NaN);

// ── 扩增曲线（每孔每通道）────────────────────────────────────
const stepInfo = z.steps().find(s => s.step === selectedStep) ?? z.steps()[0];
const nCycles = stepInfo.readCount;
const curves = z.curves().filter(c => !c.isReference);

// 基线窗口（1-based → 0-based），CFX 用线性拟合
const b = Math.max(0, baselineBegin - 1), e = Math.min(nCycles - 1, baselineEnd - 1);
function baselineCorrect(raw) {
  const seg = raw.slice(b, e + 1);
  let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = seg.length;
  seg.forEach((y, i) => { const x = b + i; sx += x; sy += y; sxx += x * x; sxy += x * y; });
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const icpt = (sy - slope * sx) / n;
  const corr = raw.map((v, i) => v - (icpt + slope * i));
  const sd = Math.sqrt(corr.slice(b, e + 1).reduce((s, v) => s + v * v, 0) / n);
  return { corr, sd };
}
// CFX 的加权平均数字滤波（三点 1-2-1）
function smooth(raw) {
  const o = raw.slice();
  for (let i = 1; i < raw.length - 1; i++) raw[i] = (o[i - 1] + 2 * o[i] + o[i + 1]) / 4;
  return raw;
}

// 只保留真正有读数的通道（其余通道整列为 0）
const anyChans = [...new Set(curves.filter(c => c.mean.some(v => v > 0)).map(c => c.channel))];
const anm0 = core.computeRunAnalysis(z, {}, undefined);
const declared = new Set((anm0.thresholdGroups ?? []).map(g => g.channel));
const chans = opt.allChannels ? anyChans : anyChans.filter(c => declared.size === 0 || declared.has(c));
const wells = new Map(); // "row,col,ch" → {raw, sd, corr}
for (const c of curves.filter(c => chans.includes(c.channel))) {
  const raw = smooth(c.mean.slice(0, nCycles));
  const { corr, sd } = baselineCorrect(raw);
  wells.set(`${c.row},${c.col},${c.channel}`, { row: c.row, col: c.col, channel: c.channel, label: c.wellLabel, raw, corr, sd });
}

// ── 阈值 ─────────────────────────────────────────────────────
const sds = [...wells.values()].map(w => w.sd).sort((a, b2) => a - b2);
const medSd = sds[Math.floor(sds.length / 2)];
const threshold = opt.threshold ?? opt.k * medSd;

const cross = (corr, T) => {
  for (let i = 1; i < corr.length; i++) {
    if (corr[i] >= T) return i + (T - corr[i - 1]) / (corr[i] - corr[i - 1]) + 1; // 1-based 循环号
  }
  return null;
};

// 荧光通道 → 染料名（.pcrd 的 dyeLayersList 里声明的染料名，缺省 CH<n>）
const anm = core.computeRunAnalysis(z, {}, undefined);
const dyeNames = new Map((anm.thresholdGroups ?? []).map(g => [g.channel, g.fluor]));
const dyeOf = (ch) => dyeNames.get(ch) ?? 'CH' + ch;

const ctRows = [];
for (const ch of chans) {
  for (const w of [...wells.values()].filter(x => x.channel === ch)) {
    const cq = cross(w.corr, threshold);
    ctRows.push({ well: w.label, row: w.row + 1, col: w.col + 1, channel: ch, dye: dyeOf(ch), cq, sd: w.sd, endRfu: w.corr.slice(-5).reduce((s, v) => s + v, 0) / 5 });
  }
}

// ── 熔解曲线 + Tm ────────────────────────────────────────────
let melt = null;
for (const st of [meltStep, 4, 3, 2, 1, 0].filter(v => !Number.isNaN(v))) {
  const m = core.computeMeltAnalysisFor(z, st);
  if (m && m.curves?.length) { melt = m; break; }
}
const tmByWell = new Map();
if (melt) for (const c of melt.curves.filter(c => chans.includes(c.channel))) {
  const k = `${c.row},${c.col},${c.channel}`;
  // 信号闸门：曲线总跨度不足自身中位数 3% 判为无熔解信号（docs/melt.md）
  const signal = core.hasMeltSignal(c.rfu ?? []) && (c.peakHeight ?? 0) >= opt.minPeak;
  if (!tmByWell.has(k) || (tmC != null && tmByWell.get(k).tmC == null)) {
    tmByWell.set(k, { tmC: signal ? c.tmC : null, peakHeight: c.peakHeight ?? null, signal });
  }
}

// ── 写 CSV ──────────────────────────────────────────────────
const f = (v, d = 2) => (v == null || Number.isNaN(v) ? '' : Number(v).toFixed(d));
const ctPath = path.join(outdir, `${stem}_Ct.csv`);
const lines = ['Well,Row,Col,Channel,Dye,Ct,BaselineSD,EndRFU,Tm_C,PeakHeight'];
for (const r of ctRows) {
  const tm = tmByWell.get(`${r.row - 1},${r.col - 1},${r.channel}`);
  lines.push([r.well, r.row, r.col, r.channel, r.dye, f(r.cq), f(r.sd, 3), f(r.endRfu, 1), tm ? f(tm.tmC, 1) : '', tm ? f(tm.peakHeight, 1) : ''].join(','));
}
fs.writeFileSync(ctPath, lines.join('\n') + '\n', 'utf8');

let meltPath = null;
if (melt) {
  meltPath = path.join(outdir, `${stem}_melt.csv`);
  const ml = ['Well,Row,Col,Channel,Temperature_C,RFU,Derivative,Tm_C'];
  for (const c of melt.curves) {
    if (!c.temperaturesC || !chans.includes(c.channel)) continue;
    for (let i = 0; i < c.temperaturesC.length; i++) {
      ml.push([c.wellLabel, c.row + 1, c.col + 1, c.channel, f(c.temperaturesC[i], 2), f(c.rfu?.[i], 2), f(c.derivative?.[i], 4), f(c.tmC, 1)].join(','));
    }
  }
  fs.writeFileSync(meltPath, ml.join('\n') + '\n', 'utf8');
}

// ── 摘要 ────────────────────────────────────────────────────
const ct = ctRows.filter(r => r.cq != null).map(r => r.cq);
const tms = [...tmByWell.values()].filter(v => v.tmC != null).map(v => v.tmC);
console.log(`文件      : ${path.basename(opt.file)}`);
console.log(`扩增步/循环: step ${selectedStep} / ${nCycles} | 熔解步: ${melt ? melt.curves[0].temperaturesC.length + ' 点 ' + melt.curves[0].temperaturesC[0] + '–' + melt.curves[0].temperaturesC.at(-1) + ' °C' : '无'}`);
console.log(`基线窗口  : 循环 ${baselineBegin}–${baselineEnd}（取自文件）| 阈值: ${threshold.toFixed(1)} RFU（k=${opt.threshold ? '-' : opt.k} × 板内 SD 中位 ${medSd.toFixed(2)}）`);
console.log(`Ct        : ${ct.length} 孔，${Math.min(...ct).toFixed(2)} – ${Math.max(...ct).toFixed(2)}`);
console.log(`Tm        : ${tms.length} 条，${tms.length ? Math.min(...tms) + ' – ' + Math.max(...tms) + ' °C' : '-'}`);
console.log(`输出      : ${ctPath}${meltPath ? '\n            ' + meltPath : ''}`);
