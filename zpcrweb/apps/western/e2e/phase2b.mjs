// 阶段 2 补充：拖放落图 / 对比度 / 自动色阶 / 画布平移（PRO 2.2 与阶段 2 明确要求的交互）。
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = 'file://' + path.resolve(here, '../src/index.html');
const sample = process.env.SAMPLE_TIFF
  || path.resolve(process.env.HOME, 'Documents/wb-studio/samples/membrane_A_long_30s.tiff');
const sampleB64 = fs.readFileSync(sample).toString('base64');

const checks = [];
const ok = (name, cond, extra) => checks.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(pageUrl);
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');

// ① 拖放落图：构造 DataTransfer 后 dispatch drop
await page.evaluate((b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], 'dropped.tiff', { type: 'image/tiff' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const wrap = document.querySelector('.canvas-wrap');
  wrap.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
}, sampleB64);
await page.waitForFunction(() => window.WA.app.img && window.WA.app.img.width > 0, null, { timeout: 15000 });
const dropped = await page.evaluate(() => ({ w: WA.app.img.width, h: WA.app.img.height, name: WA.app.doc.image.name }));
ok('拖放落图能打开', dropped.w === 1600 && dropped.h === 1100, dropped.w + 'x' + dropped.h + ' ' + dropped.name);

const figMean = () => page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { s += d[i]; n++; }
  return s / n;
});
const mean0 = await figMean();

// ② 亮部：滑块推到 80，成图必须变
const hiInput = page.locator('.hi-range');
await hiInput.evaluate((el) => { el.value = '80'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(60);
const meanC = await figMean();
ok('亮部改变成图', Math.abs(meanC - mean0) > 0.5, mean0.toFixed(2) + ' → ' + meanC.toFixed(2));
ok('亮部写入文档', (await page.evaluate(() => WA.app.doc.view.hi)) === 80);

// ③ 自动色阶：黑/白场被重算，且成图有变化
const before = await page.evaluate(() => JSON.stringify(WA.app.img.levels || null));
await page.locator('.btn', { hasText: '按当前范围自动' }).click();
await page.waitForTimeout(80);
const autoRes = await page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { s += d[i]; n++; }
  return { mean: s / n, view: WA.app.doc.view };
});
ok('自动色阶改变观感', Math.abs(autoRes.mean - meanC) > 0.5, meanC.toFixed(2) + ' → ' + autoRes.mean.toFixed(2) + ' ' + before);

// ④ 画布平移：在图片内部按住拖动，panX/panY 要变，且裁切区不能被改
const before2 = await page.evaluate(() => ({ crop: JSON.stringify(WA.app.doc.crop), view: WA.app.doc.view.zoom }));
const pt = await page.evaluate(() => {
  const t = WA.canvasview.geometry();
  const r = WA.canvasview.cropPx();
  const p = WA.canvasmath.toScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, t);
  const b = WA.canvasview.canvas.getBoundingClientRect();
  return { x: b.left + p.x, y: b.top + p.y };
});
await page.keyboard.down('Space');
await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
await page.mouse.move(pt.x + 60, pt.y + 40, { steps: 6 });
await page.mouse.up();
await page.keyboard.up('Space');
await page.waitForTimeout(50);
const after2 = await page.evaluate(() => ({
  pan: [WA.app.doc.view.panX || 0, WA.app.doc.view.panY || 0],
  crop: JSON.stringify(WA.app.doc.crop),
}));
const moved = after2.pan[0] !== 0 || after2.pan[1] !== 0;
ok('空白/空格拖动可平移画布', moved, JSON.stringify(after2.pan));
ok('平移不改裁切区', after2.crop === before2.crop, before2.crop + ' → ' + after2.crop);

ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await browser.close();

let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name + (c.extra ? '  [' + c.extra + ']' : '')); }
console.log(bad === 0 ? '\n阶段 2 补充 E2E 全过：' + checks.length + ' 项' : '\n阶段 2 补充 E2E 失败：' + bad + '/' + checks.length);
process.exit(bad === 0 ? 0 : 1);
