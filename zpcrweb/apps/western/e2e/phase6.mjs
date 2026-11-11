// 阶段 6：凝胶模式走同一套流程（DNA ladder → bp 刻度 → 导出）。
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = 'file://' + path.resolve(here, '../src/index.html');
const sample = process.env.SAMPLE_TIFF || path.resolve(process.env.HOME, 'Documents/wb-studio/samples/membrane_A_long_30s.tiff');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-gel-'));

const checks = [];
const ok = (n, c, e) => checks.push({ name: n, pass: !!c, extra: e === undefined ? '' : String(e) });

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
ok('首页有凝胶卡片', (await page.locator('.mode-card[data-mode="gel"]').count()) === 1);
await page.locator('.mode-card[data-mode="gel"]').click();
await page.waitForSelector('.canvas-wrap');
ok('模式写入文档', (await page.evaluate(() => WA.app.doc.mode)) === 'gel');

page.once('filechooser', (fc) => fc.setFiles(sample));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img, null, { timeout: 15000 });

const dnaCount = await page.evaluate(() => WA.ladders.allFor('gel').length);
ok('DNA ladder 列表可用', dnaCount >= 20, dnaCount);
const optText = await page.evaluate(() => {
  const sel = document.querySelector('.ladder-select');
  return sel.options[0] ? sel.options[0].textContent : '';
});
ok('下拉里标的是 bp', /bp/.test(optText), optText.slice(0, 40));
ok('蛋白 ladder 不在凝胶模式里混入', !(await page.evaluate(() => WA.ladders.allFor('gel').some((l) => /kDa/i.test(l.name)))));

// 5 条泳道 + marker 在第 2 道
const num = page.locator('.num input[type=number]').first();
await num.fill('5');
await num.dispatchEvent('change');
await pickBands(page, 3);
await page.locator('.marker-lane-select').selectOption('1');

// 打 3 个点
const posOf = (ny) => page.evaluate((y) => {
  const t = WA.canvasview.geometry();
  const r = WA.canvasview.cropPx();
  const p = WA.canvasmath.toScreen({ x: r.x + r.w / 2, y: r.y + r.h * y }, t);
  const box = WA.canvasview.canvas.getBoundingClientRect();
  return { x: box.left + p.x, y: box.top + p.y };
}, ny);
for (const ny of [0.2, 0.5, 0.8]) {
  const p = await posOf(ny);
  await page.mouse.click(p.x, p.y);
}
const labels = await page.evaluate(() => {
  const mk = WA.app.doc.marker;
  const sizes = WA.ladders.get(mk.ladderId).sizes;
  return WA.marker.assignSizes(mk.points, sizes).map((p) => WA.marker.formatLabel(p.kDa, 'bp'));
});
ok('刻度按 bp 取整显示', labels.length === 3 && labels.every((s) => /^\d+$/.test(s)), labels.join(','));

// 成图里有这三个数字
const hasLabels = await page.evaluate((want) => {
  const sc = WA.render.scene(WA.app.doc, { cropW: 1600, cropH: 1100 });
  const texts = sc.items.filter((i) => i.kind === 'text').map((i) => i.text);
  return want.every((w) => texts.indexOf(w) >= 0);
}, labels);
ok('成图场景包含 bp 标签', hasLabels, labels.join(','));

// 导出 PNG + PDF 在凝胶模式同样可用
for (const fmt of ['png', 'pdf']) {
  const btn = page.locator(`.export-btn[data-fmt="${fmt}"]`);
  let name;
  if (await btn.count()) {
    const dl = page.waitForEvent('download', { timeout: 20000 });
    await btn.click();
    const d = await dl;
    name = d.suggestedFilename();
    await d.saveAs(path.join(outDir, name));
  } else {
    const r = await page.evaluate(async (f) => {
      const b64Of = (bytes) => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
      const x = await WA.exporters.run(WA.app, f, { collect: true });
      return { name: x.name, b64: b64Of(x.bytes) };
    }, fmt);
    name = r.name;
    fs.writeFileSync(path.join(outDir, name), Buffer.from(r.b64, 'base64'));
  }
  ok('凝胶模式导出 ' + fmt.toUpperCase(), fs.statSync(path.join(outDir, name)).size > 1000, name);
}

// 切回首页再进 blot，ladder 列表变回蛋白
await page.locator('[data-act="home"]').click();
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(sample));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img);
const back = await page.evaluate(() => {
  const sel = document.querySelector('.ladder-select');
  return { mode: WA.app.doc.mode, first: sel.options[0].textContent };
});
ok('回首页再进 Western blot 正常', back.mode === 'blot' && /kDa/.test(back.first), back.first.slice(0, 30));

ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await browser.close();

let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name + (c.extra ? '  [' + c.extra + ']' : '')); }
console.log(bad === 0 ? '\n阶段 6 E2E 全过：' + checks.length + ' 项' : '\n阶段 6 E2E 失败：' + bad + '/' + checks.length);
process.exit(bad === 0 ? 0 : 1);
