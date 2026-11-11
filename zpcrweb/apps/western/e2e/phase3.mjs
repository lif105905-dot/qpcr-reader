
// 阶段 3：手输泳道数 → 等距中线 → 画布上拖动中线 → 成图显示泳道名。
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
await page.waitForFunction(() => window.WA.app.img && window.WA.app.img.width > 0, null, { timeout: 15000 });

// 输入 6 条
const num = page.locator('.num input[type=number]').first();
await num.fill('6');
await num.dispatchEvent('change');
await page.waitForTimeout(60);
const st = await page.evaluate(() => ({
  count: WA.app.doc.laneCount,
  centers: WA.app.doc.laneCenters,
  names: WA.app.doc.laneNames
}));
ok('条数写入 6', st.count === 6);
ok('中线等距', JSON.stringify(st.centers) === JSON.stringify([1/12, 3/12, 5/12, 7/12, 9/12, 11/12]), st.centers.map((v) => v.toFixed(3)).join(','));
ok('泳道名 1..6', st.names.join(',') === '1,2,3,4,5,6', st.names.join(','));

// 拖第 3 根中线（下标 2）
const pos = await page.evaluate(() => {
  const t = WA.canvasview.geometry();
  const r = WA.canvasview.cropPx();
  const c = WA.app.doc.laneCenters[2];
  const p = WA.canvasmath.toScreen({ x: r.x + c * r.w, y: r.y + r.h / 2 }, t);
  const box = WA.canvasview.canvas.getBoundingClientRect();
  return { x: box.left + p.x, y: box.top + p.y };
});
await page.mouse.move(pos.x, pos.y);
await page.mouse.down();
await page.mouse.move(pos.x + 40, pos.y, { steps: 6 });
await page.mouse.up();
const moved = await page.evaluate(() => WA.app.doc.laneCenters[2]);
ok('中线可拖动', Math.abs(moved - 5/12) > 0.01, moved.toFixed(4));

const ordered = await page.evaluate(() => {
  const c = WA.app.doc.laneCenters;
  return c.every((v, i) => i === 0 || v > c[i - 1]);
});
ok('拖动后仍保持左右顺序', ordered);

// 等距排列按钮复原
await page.locator('.btn', { hasText: '等距排列' }).click();
await page.waitForTimeout(60);
const reset = await page.evaluate(() => WA.app.doc.laneCenters[2]);
ok('等距排列能复原', Math.abs(reset - 5/12) < 1e-9, reset.toFixed(4));

// 成图里出现 6 个泳道名（版式要求：名字在图**上方**，所以取样名字带）
const band = await page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const ctx = c.getContext('2d');
  const sc = WA.render.scene(WA.app.doc, { cropW: WA.figureview.source().px.w, cropH: WA.figureview.source().px.h });
  const want = sc.layout.lanes.map((l) => l.text);
  const names = sc.items.filter((i) => i.kind === 'text' && want.indexOf(i.text) >= 0 && i.y < sc.layout.img.y);
  if (!names.length) return 0;
  const k = c.width / sc.widthPt;
  const yTop = Math.max(0, Math.floor((Math.min.apply(null, names.map((n) => n.y)) - 12) * k));
  const yBot = Math.min(c.height, Math.ceil((Math.max.apply(null, names.map((n) => n.y)) + 2) * k));
  const d = ctx.getImageData(0, yTop, c.width, Math.max(1, yBot - yTop)).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
  return dark;
});
ok('成图图上方有 6 个泳道名（像素）', band > 50, band);

// 改条数 → 中线与名字同步
await num.fill('4');
await num.dispatchEvent('change');
await page.waitForTimeout(60);
const s4 = await page.evaluate(() => ({ c: WA.app.doc.laneCenters.length, n: WA.app.doc.laneNames.length }));
ok('改条数后中线/名字同步', s4.c === 4 && s4.n === 4, JSON.stringify(s4));

ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await browser.close();

let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name + (c.extra ? '  [' + c.extra + ']' : '')); }
console.log(bad === 0 ? '\n阶段 3 E2E 全过：' + checks.length + ' 项' : '\n阶段 3 E2E 失败：' + bad + '/' + checks.length);
process.exit(bad === 0 ? 0 : 1);
