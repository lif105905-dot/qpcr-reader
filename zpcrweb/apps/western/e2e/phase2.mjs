
// 阶段 2：导入图片 → 画布显示 → 裁切 → 成图实时更新 → 调色/反相生效 → 性能不超 30ms。
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = 'file://' + path.resolve(here, '../src/index.html');
const sample = process.env.SAMPLE_TIFF
  || path.resolve(process.env.HOME, 'Documents/wb-studio/samples/membrane_A_long_30s.tiff');

const checks = [];
const ok = (name, cond, extra) => checks.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(pageUrl);
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');

// 通过 filechooser 注入样本图（pickFile 会动态创建 input）
page.once('filechooser', (fc) => fc.setFiles(sample));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img && window.WA.app.img.width > 0, null, { timeout: 15000 });

const info = await page.evaluate(() => ({
  w: WA.app.img.width, h: WA.app.img.height, bits: WA.app.img.bits,
  crop: WA.app.doc.crop, name: WA.app.doc.image.name
}));
ok('样本图解码成功', info.w === 1600 && info.h === 1100, info.w + 'x' + info.h);
ok('记录位深（16-bit）', info.bits === 16, info.bits);
ok('默认不裁切', info.crop === null);

// 成图区域有非空像素
const figStats = await page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let min = 255, max = 0, sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i];
    if (g < min) min = g;
    if (g > max) max = g;
    sum += g; n++;
  }
  return { min, max, mean: sum / n };
});
ok('成图有内容（不是纯白/纯黑）', figStats.max - figStats.min > 10, JSON.stringify(figStats));

// 拖右下角把手 → 裁切框变小
const handle = await page.evaluate(() => {
  const t = WA.canvasview.geometry();
  const r = WA.canvasview.cropPx();
  const p = WA.canvasmath.toScreen({ x: r.x + r.w, y: r.y + r.h }, t);
  const box = WA.canvasview.canvas.getBoundingClientRect();
  return { x: box.left + p.x, y: box.top + p.y };
});
await page.mouse.move(handle.x, handle.y);
await page.mouse.down();
await page.mouse.move(handle.x - 180, handle.y - 90, { steps: 8 });
await page.mouse.up();
const afterDrag = await page.evaluate(() => WA.app.doc.crop);
ok('拖动把手能裁切', afterDrag && afterDrag.w < 0.95 && afterDrag.h < 0.95, JSON.stringify(afterDrag));

const figAfter = await page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { sum += d[i]; n++; }
  const crop = WA.app.doc.crop;
  const src = WA.figureview.source();          // 成图真正用的裁切像素区
  const sc = WA.render.scene(WA.app.doc, { cropW: src.px.w, cropH: src.px.h });
  return {
    mean: sum / n,
    aspect: sc.layout.img.w / sc.layout.img.h,
    cropAspect: src.px.w / src.px.h,
  };
});
// 均值不稳定（暗底裁切后变化很小），改成结构断言：成图块的长宽比必须跟着裁切比例走
ok('裁切后成图重新渲染',
  Math.abs(figAfter.aspect - figAfter.cropAspect) < 0.02 && Math.abs(figAfter.mean - figStats.mean) > 0.05,
  'aspect ' + figAfter.aspect.toFixed(3) + ' vs crop ' + figAfter.cropAspect.toFixed(3) + '，mean ' + figStats.mean.toFixed(2) + ' → ' + figAfter.mean.toFixed(2));

// 反相
const beforeInv = figAfter.mean;
await page.locator('.check input[type=checkbox]').check();
const afterInv = await page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { sum += d[i]; n++; }
  return sum / n;
});
ok('反相改变成图', afterInv > beforeInv + 5, beforeInv.toFixed(1) + ' → ' + afterInv.toFixed(1));

// 亮部滑块（v5 起用「暗部/亮部」替代旧的亮度/对比度）
const slider = page.locator('.ctl', { hasText: '亮部' }).locator('input[type=range]');
await slider.fill('70');
const afterBri = await page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { sum += d[i]; n++; }
  return sum / n;
});
ok('亮部滑块改变成图', Math.abs(afterBri - afterInv) > 0.5, afterInv.toFixed(1) + ' → ' + afterBri.toFixed(1));

// 旋转
await page.evaluate(() => { WA.app.doc.view.rotate = 5; WA.app.refresh(); });
await page.waitForTimeout(120);
const rotatedDims = await page.evaluate(() => {
  const rot = WA.image.rotatedCanvas(WA.app.img, WA.app.doc.view.rotate, WA.app.levels(), 2048);
  return { w: rot.width, h: rot.height };
});
ok('旋转改变了工作画布尺寸', rotatedDims.w !== 1600 || rotatedDims.h !== 1100, JSON.stringify(rotatedDims));

// 性能：一次整幅重绘（显示画布重建 + 成图重绘）
const timing = await page.evaluate(async () => {
  const t0 = performance.now();
  WA.app.img._dispKey = '';           // 强制丢弃缓存
  WA.app.doc.view.contrast = 61;
  WA.app.refresh();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return performance.now() - t0;
});
ok('整幅重绘 ≤ 30ms', timing <= 30, timing.toFixed(1) + 'ms');

ok('无 JS 报错', errors.length === 0, errors.join(' | '));

await browser.close();

let bad = 0;
for (const c of checks) {
  if (!c.pass) bad++;
  console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name + (c.extra ? '  [' + c.extra + ']' : ''));
}
console.log(bad === 0 ? '\n阶段 2 E2E 全过：' + checks.length + ' 项' : '\n阶段 2 E2E 失败：' + bad + '/' + checks.length);
process.exit(bad === 0 ? 0 : 1);
