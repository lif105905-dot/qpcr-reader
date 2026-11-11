/* 阶段 17：多 marker 孔 + 原图导出。 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const SAMPLE = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail += 1; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
};

const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + path.resolve('src/index.html'));
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(SAMPLE));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img);

await page.evaluate(() => {
  const app = WA.app; const d = app.doc;
  WA.lanes.setCount(d, 6);
  const ys = WA.ladders.all().filter((l) => /Yeasen/.test(l.name))[0];
  app.markerIndex = 0;
  app.marker().ladderId = ys.id;
  app.setMarkerLane(0);
  app.setMarkerSizes(ys.sizes.slice(0, 3));
  app.refresh();
});
await page.waitForTimeout(120);

ok('初始只有一个孔', await page.evaluate(() => WA.doc.markersOf(WA.app.doc).length) === 1, '');
await page.locator('.mk-holes .btn', { hasText: '加一孔' }).click();
await page.waitForTimeout(120);
ok('点「加一孔」变成两孔', await page.evaluate(() => WA.doc.markersOf(WA.app.doc).length) === 2, '');

await page.evaluate(() => { WA.app.marker().ladderId = WA.ladders.all()[0].id; WA.app.setMarkerLane(3); WA.app.setMarkerSizes(WA.ladders.all()[0].sizes.slice(0, 3)); });
await page.waitForTimeout(120);
const geo = await page.evaluate(() => {
  const d = WA.app.doc;
  const sc = WA.render.scene(d, { cropW: WA.figureview.source().px.w, cropH: WA.figureview.source().px.h });
  const lines = sc.items.filter((i) => i.kind === 'line' && i.y1 === i.y2);
  const img = sc.layout.img;
  const outside = lines.filter((t) => t.x2 < img.x);                       // 框外轴（第 1 孔）
  const inside = lines.filter((t) => t.x2 > img.x && t.x2 < img.x + img.w); // 图内轴（第 2 孔）
  const xs = [...new Set(inside.map((t) => +t.x2.toFixed(1)))];
  const laneX = +sc.layout.lanes[3].x.toFixed(1);
  const mTexts = sc.items.filter((i) => i.kind === 'text' && i.text === 'M').length;
  return { xs, laneX, mTexts, holes: WA.doc.markersOf(d).length,
           outsideCount: outside.length, insideCount: inside.length,
           outsideColor: outside.length ? [...new Set(outside.map((t) => t.color))] : [] };
});
ok('两条刻度轴各在自己的位置', geo.outsideCount === 3 && geo.insideCount === 3 && geo.xs.length === 1 && geo.xs[0] === geo.laneX,
  'out=' + geo.outsideCount + ' in=' + geo.xs.join(',') + ' lane=' + geo.laneX);
ok('框外刻度是黑色、图内刻度用高对比色', geo.outsideColor.length === 1 && geo.outsideColor[0] === '#000000', String(geo.outsideColor));
ok('两个 marker 泳道都标 M', geo.mTexts === 2, 'M=' + geo.mTexts);

await page.evaluate(() => WA.app.setMarkerIndex(0));
await page.waitForTimeout(120);
ok('切回孔 1 时正在编辑的是孔 1', await page.evaluate(() => WA.app.markerIndex === 0 && WA.app.marker() === WA.doc.markersOf(WA.app.doc)[0]), '');
ok('孔 1 的刻度还在', await page.evaluate(() => (WA.app.marker().sizes || []).length) === 3, '');

const dl = page.waitForEvent('download');
await page.locator('.export-btn[data-fmt="original"]').click();
const file = await dl;
const saved = path.join('/tmp', file.suggestedFilename());
await file.saveAs(saved);
const size = fs.statSync(saved).size;
ok('原图导出的是原始字节（大小与源文件一致）', size === fs.statSync(SAMPLE).size, size + ' vs ' + fs.statSync(SAMPLE).size);

await page.evaluate(() => WA.app.setMarkerIndex(1));
await page.waitForTimeout(80);
await page.locator('.mk-holes .btn', { hasText: '删本孔' }).click();
await page.waitForTimeout(120);
ok('删掉一孔后回到单孔', await page.evaluate(() => WA.doc.markersOf(WA.app.doc).length) === 1, '');
ok('无 JS 报错', errs.length === 0, errs.join(' | '));

await b.close();
console.log('\n阶段 17 E2E ' + (fail ? '失败：' + fail + '/' + (pass + fail) : '全过：' + pass + ' 项'));
process.exit(fail ? 1 : 0);
