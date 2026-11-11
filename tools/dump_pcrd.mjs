import fs from 'node:fs';
import path from 'node:path';
import * as core from '/Users/lijiehui/Documents/qpcr-tool/zpcrweb/packages/core/dist/index.js';

const file = process.argv[2];
const password = process.argv[3];
const outDir = process.argv[4] ?? '.';
const pcrd = await core.pcrdFromFile(file, { password });
if (pcrd.error) { console.error('解密失败:', pcrd.error); process.exit(1); }
const z = pcrd.zpcr;
const an = core.computeRunAnalysis(z, {}, undefined);

console.log('步骤:', JSON.stringify(z.steps()));
console.log('Cq 表:', an.cqTable.size, '行 | 通道:', JSON.stringify(an.available), '| 板:', an.plate?.plateName);

const segs = core.meltSegments(z);
console.log('熔解段:', JSON.stringify(segs));

let melt;
for (const st of [4, 3, 2, 1, 0, undefined]) {
  const m = core.computeMeltAnalysisFor(z, st);
  if (m && m.curves?.length) { melt = m; console.log(`熔解分析命中 step=${st} → 曲线 ${m.curves.length}`); break; }
}
if (!melt) { console.log('没有熔解数据'); process.exit(0); }
console.log('熔解曲线样例:', JSON.stringify({ ...melt.curves[0], temperaturesC: `len ${melt.curves[0].temperaturesC?.length}`, derivative: `len ${melt.curves[0].derivative?.length}` }));

// Tm 表
const rows = [];
for (const c of melt.curves) {
  rows.push({ well: c.wellKey ?? c.label, fluor: c.fluor, tm: c.tm, hasSignal: c.hasSignal, peak: c.peak?.tm });
}
console.log('Tm 非空:', rows.filter(r => r.tm != null).length, '/', rows.length);
console.log('样例:', rows.slice(0, 8).map(r => `${r.well}/${r.fluor ?? '-'}: Tm=${r.tm}`).join('  '));
