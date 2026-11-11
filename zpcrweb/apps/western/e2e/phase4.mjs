
// 阶段 4：选 ladder → 设 marker 泳道 → 打点 → 成图出现 kDa 刻度。
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = 'file://' + path.resolve(here, '../src/index.html');
const sample = process.env.SAMPLE_TIFF || path.resolve(process.env.HOME, 'Documents/wb-studio/samples/membrane_A_long_30s.tiff');

const checks = [];
const ok = (n, c, e) => checks.push({ name: n, pass: !!c, extra: e === undefined ? '' : String(e) });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(pageUrl);
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(sample));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img, null, { timeout: 15000 });

// 6 条泳道
const num = page.locator('.num input[type=number]').first();
await num.fill('6');
await num.dispatchEvent('change');

// 选第一个 ladder
const ladderCount = await page.evaluate(() => WA.ladders.all().length);
ok('内置 ladder 数量 > 20', ladderCount > 20, ladderCount);
const firstId = await page.evaluate(() => {
  const sel = document.querySelector('.ladder-select');
  sel.selectedIndex = 0;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return WA.app.doc.marker.ladderId;
});
ok('ladder 写入文档', !!firstId, firstId);

// 勾两条要标的条带
await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('.band-chk input')];
  boxes.slice(0, 2).forEach((b) => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
});
ok('只勾两条后 sizes 有 2 项', (await page.evaluate(() => WA.app.doc.marker.sizes.length)) === 2, '');

// 先选泳道：marker 在第 3 道
const laneSel = page.locator('.marker-lane-select');
ok('有「所在泳道」下拉', await laneSel.count() === 1, '');
await laneSel.selectOption('2');
const lane = await page.evaluate(() => WA.app.doc.marker.lane);
ok('marker 泳道 = 第 3 道（下标 2）', lane === 2, lane);

// 勾 4 条 → 自动等距放 4 个刻度
await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('.band-chk input')];
  boxes.slice(0, 4).forEach((b) => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
});
const pts = await page.evaluate(() => WA.app.doc.marker.points.map((p) => +p.y.toFixed(2)));
ok('勾 4 条自动生成 4 个刻度', pts.length === 4, JSON.stringify(pts));

const even = pts.every((v, i) => i === 0 || v > pts[i - 1]);
ok('刻度从上到下等距递增', even && Math.abs(pts[0] - 0.10) < 0.001 && Math.abs(pts[3] - 0.90) < 0.001, JSON.stringify(pts));

const assigned = await page.evaluate(() => {
  const mk = WA.app.doc.marker;
  return WA.marker.assignSizes(mk.points, mk.sizes).map((p) => p.kDa);
});
const firstSize = await page.evaluate(() => WA.app.doc.marker.sizes[0]);
ok('按从上到下配分子量', assigned.length === 4 && assigned[0] === firstSize, assigned.join(','));

// 按住刻度拖动 → 位置改变（对应分子量不变）
const dragBefore = await page.evaluate(() => WA.app.doc.marker.points[0].y);
const spot = await page.evaluate(() => {
  const t = WA.canvasview.geometry();
  const r = WA.canvasview.cropPx();
  const h = WA.canvasview.markerHandles(r, t)[0];
  const box = WA.canvasview.canvas.getBoundingClientRect();
  return { x: box.left + h.x, y: box.top + h.y };
});
await page.mouse.move(spot.x, spot.y);
await page.mouse.down();
await page.mouse.move(spot.x, spot.y + 30, { steps: 5 });
await page.mouse.up();
const dragAfter = await page.evaluate(() => WA.app.doc.marker.points.map((p) => +p.y.toFixed(3)));
ok('拖动刻度改变位置', dragAfter[0] > dragBefore + 0.01, JSON.stringify(dragAfter));

// 选泳道即自动生效：成图里该道标 M，处理区该道中线变黄
await page.locator('.marker-lane-select').selectOption('1');
await page.waitForTimeout(150);   // 等 rAF 合并的那一帧画完
const mkState = await page.evaluate(() => {
  const d = WA.app.doc;
  const sc = WA.render.scene(d, { cropW: 571, cropH: 126 });
  const names = sc.items.filter((i) => i.kind === 'text' && i.y === sc.layout.namesBaseline).map((i) => i.text);
  // 处理区：找 marker 泳道中线的颜色
  const c = WA.canvasview.canvas;
  const ctx = c.getContext('2d');
  const d2 = ctx.getImageData(0, 0, c.width, c.height).data;
  const t = WA.canvasview.geometry();
  const r = WA.canvasview.cropPx();
  const k = c.width / c.getBoundingClientRect().width;
  const laneX = Math.round(WA.canvasmath.toScreen({ x: r.x + d.laneCenters[d.marker.lane] * r.w, y: r.y }, t).x * k);
  const hist = new Array(c.width).fill(0);
  let n = 0;
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d2[i] > 170 && d2[i + 1] > 130 && d2[i + 2] < 110) { n++; hist[x]++; }
    }
  }
  let modeX = 0, best = 0;
  hist.forEach((v, x) => { if (v > best) { best = v; modeX = x; } });
  const near = best;
  return { lane: d.marker.lane, names: names, yellowPx: n, near: near, modeX: modeX, laneX: laneX };
});
ok('选泳道即自动设为 marker（无需再点图）', mkState.lane === 1, String(mkState.lane));
ok('成图里 marker 泳道标 M', mkState.names[1] === 'M', mkState.names.join(','));
ok('处理区 marker 泳道中线变黄', mkState.near > 8 && Math.abs(mkState.modeX - mkState.laneX) <= 8, 'modeX=' + mkState.modeX + ' laneX=' + mkState.laneX + ' 列像素=' + mkState.near);

// 刻度重新等距
await page.locator('.step', { hasText: 'Marker' }).first().locator('.btn', { hasText: '刻度重新等距' }).click();
const reEven = await page.evaluate(() => WA.app.doc.marker.points.map((p) => +p.y.toFixed(2)));
ok('刻度重新等距恢复均分', reEven[0] === 0.1 && reEven[3] === 0.9, JSON.stringify(reEven));

// 成图里出现刻度像素（左侧紧邻 marker 泳道）
const tickPixels = await page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 60) dark++;
  return dark;
});
ok('成图有刻度/文字像素', tickPixels > 200, tickPixels);

// 刻度只标勾选的分子量
const labelCheck = await page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const sc = WA.render.scene(WA.app.doc, { cropW: 571, cropH: 126 });
  return sc.items.filter((i) => i.kind === 'text').map((i) => i.text);
});
const sizesChosen = await page.evaluate(() => WA.app.doc.marker.sizes.map(String));
ok('只标勾选的分子量', sizesChosen.every((v) => labelCheck.includes(v)), labelCheck.filter((t) => /^\d+(\.\d)?$/.test(t)).join(','));

ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await browser.close();

let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name + (c.extra ? '  [' + c.extra + ']' : '')); }
console.log(bad === 0 ? '\n阶段 4 E2E 全过：' + checks.length + ' 项' : '\n阶段 4 E2E 失败：' + bad + '/' + checks.length);
process.exit(bad === 0 ? 0 : 1);
