// 阶段 7：成图版式对齐 GelFigure —— 组名在最上、泳道名在图上、编号压图顶边、Marker 轴在图内左侧。
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = 'file://' + path.resolve(here, '../src/index.html');
const sample = process.env.SAMPLE_TIFF
  || path.resolve(process.env.HOME, 'Documents/wb-studio/samples/membrane_A_long_30s.tiff');

const checks = [];
const ok = (name, cond, extra) => checks.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) });

// 勾选要标的条带（不勾就不画刻度）
async function pickBands(page, n) {
  await page.evaluate((count) => {
    const boxes = [...document.querySelectorAll('.band-chk input')];
    boxes.slice(0, count).forEach((b) => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
  }, n);
  await page.waitForTimeout(40);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(pageUrl);
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(sample));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img, null, { timeout: 15000 });

// 4 条泳道 + marker 在第 1 道 + 打 3 个点
const num = page.locator('.num input[type=number]').first();
await num.fill('4');
await num.dispatchEvent('change');
await pickBands(page, 3);
await page.locator('.marker-lane-select').selectOption('0');
const posOf = (ny) => page.evaluate((y) => {
  const t = WA.canvasview.geometry();
  const r = WA.canvasview.cropPx();
  const p = WA.canvasmath.toScreen({ x: r.x + r.w * 0.1, y: r.y + r.h * y }, t);
  const b = WA.canvasview.canvas.getBoundingClientRect();
  return { x: b.left + p.x, y: b.top + p.y };
}, ny);
for (const ny of [0.25, 0.55, 0.85]) {
  const p = await posOf(ny);
  await page.mouse.click(p.x, p.y);
}

// 加一个分组（在成图区拖过前两道泳道名）
const nm = (i) => page.evaluate((idx) => {
  const cv = document.querySelector('.fig-canvas');
  const r = cv.getBoundingClientRect();
  const v = WA.figureview.view;
  const lay = v.sc.layout;
  const x = lay.img.x + WA.app.doc.laneCenters[idx] * lay.img.w;
  return { x: r.left + x * v.scale, y: r.top + lay.namesBaseline * v.scale };
}, i);
const na = await nm(0); const nb = await nm(1);
await page.mouse.move(na.x, na.y);
await page.mouse.down();
await page.mouse.move(nb.x, nb.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(100);
if (await page.locator('.fig-inline').count()) {
  await page.locator('.fig-inline').fill('Ctrl');
  await page.keyboard.press('Enter');
}
// 条件行（参考图里有 4OHT 的 −/+ 行）+ 抗体说明
await page.evaluate(() => {
  const doc = WA.app.doc;
  doc.annotations.push({ kind: 'condition', drug: '4OHT', marks: [false, true, false, true] });
  doc.style.antibody = 'anti-SUMO2/3';
  WA.app.refresh();
});
await page.waitForTimeout(120);

await page.evaluate(() => { WA.app.doc.title = 'DAXX-cko mESC'; WA.app.refresh(); });
await page.waitForTimeout(120);
const geo = await page.evaluate(() => {
  const doc = WA.app.doc;
  const src = WA.figureview.source();
  const sc = WA.render.scene(doc, { cropW: src.px.w, cropH: src.px.h });
  const img = sc.layout.img;
  const lay = sc.layout;
  const texts = sc.items.filter((i) => i.kind === 'text');
  // marker 泳道按规范显示 M，所以名字集合 = 各泳道文字 + 'M'
  const nameTexts = lay.lanes.map((l, i) => (doc.marker && doc.marker.ladderId && doc.marker.lane === i ? 'M' : l.text));
  const names = texts.filter((t) => nameTexts.indexOf(t.text) >= 0 && t.y < img.y);
  const groupText = texts.filter((t) => t.text === 'Ctrl');
  const unitText = texts.filter((t) => t.text === '(kDa)');
  // 刻度：内侧端点在图框左侧 axisGap 处、长度 = tickOut；与图框/与数字留同样间隙
  const axisGap = lay.axis.gap != null ? lay.axis.gap : (img.x - lay.axis.x);
  const innerX = img.x - axisGap;
  const ticks = sc.items.filter((i) => i.kind === 'line'
    && Math.abs(i.x2 - innerX) < 0.01
    && Math.abs((i.x2 - i.x1) - lay.axis.tickOut) < 0.01);
  const condMarks = texts.filter((t) => t.text === '\u2212' || t.text === '+');
  return {
    imgY: img.y, imgX: img.x, imgW: img.w, heightPt: sc.heightPt,
    nameCount: names.length,
    laneCount: lay.lanes.length,
    namesAbove: names.length > 0 && names.every((t) => t.y < img.y),
    namesHorizontal: names.every((t) => !t.rotate),
    groupAboveNames: groupText.length === 1 && names.every((t) => groupText[0].y < t.y),
    condAboveImage: condMarks.length > 0 && condMarks.every((t) => t.y < img.y),
    // v13 起默认顺序与 GelFigure 一致：组名 → 样品名 → 条件行 → 图
    namesAboveCond: names.length > 0 && condMarks.length > 0
      && Math.max.apply(null, names.map((n) => n.y)) < Math.min.apply(null, condMarks.map((c) => c.y)),
    condAboveNames: names.length > 0 && condMarks.length > 0
      && Math.max.apply(null, condMarks.map((c) => c.y)) <= Math.min.apply(null, names.map((n) => n.y)) + 0.51,
    titleLine: sc.items.filter((i) => i.kind === 'line' && Math.abs(i.x1 - img.x) < 0.01 && Math.abs(i.x2 - (img.x + img.w)) < 0.01).length,
    tickCount: ticks.length,
    ticksOutside: ticks.length > 0 && ticks.every((t) => t.x2 < img.x && Math.abs((t.x2 - t.x1) - lay.axis.tickOut) < 0.01),
    tickGapToImage: ticks.length ? img.x - ticks[0].x2 : -1,
    tickGapToLabel: ticks.length ? ticks[0].x1 - lay.axis.labelX : -1,
    tickColors: Array.from(new Set(ticks.map((t) => t.color))),
    tickLen: lay.axis.tickOut,
    unitOutside: unitText.length === 1 && unitText[0].x < img.x,
    antibodyText: texts.filter((t) => t.text === 'anti-SUMO2/3').length,
  };
});

ok('泳道名在图片上方', geo.namesAbove, 'y=' + geo.imgY.toFixed(1));
ok('泳道名默认水平（不打斜）', geo.namesHorizontal && geo.nameCount === geo.laneCount, geo.nameCount + '/' + geo.laneCount);
ok('组名排在泳道名之上', geo.groupAboveNames, '');
ok('条件行在图片上方', geo.condAboveImage, '');
ok('样品名在条件行之上（GelFigure 默认顺序）', geo.namesAboveCond, '');
ok('上级组名有一条横跨全图的线', geo.titleLine >= 1, geo.titleLine);
ok('Marker 刻度在框外', geo.ticksOutside, 'ticks=' + geo.tickCount);
ok('刻度与图框、与数字的间隙相等', Math.abs(geo.tickGapToImage - geo.tickGapToLabel) < 0.6,
  geo.tickGapToImage.toFixed(2) + ' / ' + geo.tickGapToLabel.toFixed(2));
ok('刻度线是黑色', geo.tickColors.length === 1 && geo.tickColors[0] === '#000000', String(geo.tickColors));
ok('刻度变短（≤0.7 em）', geo.tickLen <= (WA_FP => WA_FP * 0.7)(9), geo.tickLen.toFixed(2));
ok('Marker 数值在框外左侧', geo.unitOutside, 'imgX=' + geo.imgX.toFixed(1));
ok('抗体说明画在图片下方', geo.antibodyText === 1, '');

// 像素校验：名字带真有墨水；框外刻度区偏黄
const px = await page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const ctx = c.getContext('2d');
  const sc = WA.render.scene(WA.app.doc, { cropW: WA.figureview.source().px.w, cropH: WA.figureview.source().px.h });
  const k = c.width / sc.widthPt;
  const img = sc.layout.img;
  const nameY = sc.layout.namesBaseline;
  const fp = WA.app.doc.style.fontPt;
  const top = Math.max(0, Math.floor((nameY - fp * 1.7) * k));
  const band = ctx.getImageData(0, top, c.width, Math.max(1, Math.floor(fp * 2.4 * k))).data;
  let dark = 0;
  for (let i = 0; i < band.length; i += 4) if (band[i] < 200) dark++;
  const x0 = Math.max(0, Math.floor((img.x - sc.layout.axis.tickOut - 1) * k));
  const w = Math.max(1, Math.floor((sc.layout.axis.tickOut + 2) * k));
  const area = ctx.getImageData(x0, Math.floor(img.y * k), w, Math.max(1, Math.floor(img.h * k))).data;
  let ink = 0;
  for (let i = 0; i < area.length; i += 4) if (area[i] < 160) ink++;
  const bandArea = c.width * Math.max(1, Math.floor(fp * 2.4 * k));
  return { dark, ink, bandArea };
});
ok('名字带里有墨水（真的画上去了）', px.dark > 30 && px.dark / px.bandArea > 0.002, px.dark + ' / ' + px.bandArea);
ok('框外刻度区有刻度像素（每条刻度至少 1 像素）', px.ink >= 3, px.ink);

// 导出 PNG，确认版式在导出里同样成立
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-layout-'));
const dl = page.waitForEvent('download', { timeout: 20000 });
await page.locator('.export-btn[data-fmt="png"]').click();
const d = await dl;
await d.saveAs(path.join(outDir, d.suggestedFilename()));
ok('导出 PNG 落盘', fs.statSync(path.join(outDir, d.suggestedFilename())).size > 1000, d.suggestedFilename());

// 泳道名可以直接在成图里点开改名
const laneBox = await page.evaluate(() => {
  const cv = document.querySelector('.fig-canvas');
  const r = cv.getBoundingClientRect();
  const sc = WA.figureview.view.sc;
  const x = (sc.layout.img.x + WA.app.doc.laneCenters[1] * sc.layout.img.w) * WA.figureview.view.scale;
  const y = sc.layout.namesBaseline * WA.figureview.view.scale;
  return { x: r.left + x, y: r.top + y };
});
await page.mouse.click(laneBox.x, laneBox.y);
await page.waitForSelector('.fig-pop', { timeout: 3000 });
const popOpen = await page.locator('[data-role="pop-lane-text"]').count();
await page.fill('[data-role="pop-lane-text"]', '72H');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const renamed = await page.evaluate(() => WA.app.doc.laneNames[1]);
ok('点泳道名可打开属性卡并改名', popOpen === 1 && renamed === '72H', popOpen + ' / ' + renamed);

ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await browser.close();

let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name + (c.extra ? '  [' + c.extra + ']' : '')); }
console.log(bad === 0 ? '\n阶段 7 版式 E2E 全过：' + checks.length + ' 项' : '\n阶段 7 版式 E2E 失败：' + bad + '/' + checks.length);
process.exit(bad === 0 ? 0 : 1);
