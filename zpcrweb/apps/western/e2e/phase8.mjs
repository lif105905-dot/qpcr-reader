/* 阶段 8：成图区里的直接编辑 —— 拖选泳道加分组、点条件行循环 ·/−/+、Marker 勾选条带 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const sample = process.env.WA_SAMPLE || '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
const pageUrl = 'file://' + path.resolve('src/index.html');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
};

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

const num = page.locator('.num input[type=number]').first();
await num.fill('4');
await num.dispatchEvent('change');

// Marker：先选泳道，再勾两条
const laneSel = page.locator('.marker-lane-select');
ok('Marker 面板有「所在泳道」选择', await laneSel.count() === 1, '');
await laneSel.selectOption('1');
const bandCount = await page.locator('.band-chk').count();
ok('Marker 条带可勾选（数量/大小自选）', bandCount > 3, bandCount + ' 条可选');
await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('.band-chk input')];
  boxes.forEach((b, i) => { b.checked = i < 2; b.dispatchEvent(new Event('change')); });
});
const chosen = await page.evaluate(() => WA.app.doc.marker.sizes.length);
ok('勾选后只标这几条', chosen === 2, String(chosen));

// 成图里拖选 → 分组
let figBox = await page.locator('.fig-canvas').boundingBox();
const laneX = await page.evaluate(() => {
  const v = WA.figureview.view;
  const lay = v.sc.layout;
  return { a: lay.lanes[0].x * v.scale, b: lay.lanes[1].x * v.scale, y: (lay.namesBaseline - 8) * v.scale };
});
await page.mouse.move(figBox.x + laneX.a, figBox.y + laneX.y);
await page.mouse.down();
await page.mouse.move(figBox.x + laneX.b, figBox.y + laneX.y, { steps: 6 });
await page.mouse.up();
const hasGroup = await page.evaluate(() => WA.app.doc.annotations.filter((a) => a.kind === 'group').length);
ok('在成图区拖过泳道名即生成分组', hasGroup === 1, String(hasGroup));
const inline = await page.locator('.fig-inline').count();
ok('拖动后就地输入组名', inline === 1, String(inline));
if (inline) {
  await page.locator('.fig-inline').fill('Ctrl');
  await page.locator('.fig-inline').press('Enter');
}
const groupName = await page.evaluate(() => (WA.app.doc.annotations.find((a) => a.kind === 'group') || {}).name);
ok('组名写进分组', groupName === 'Ctrl', String(groupName));

// 条件行：按钮加行 → 点格子循环 · → − → +
await page.locator('[data-act="add-cond"]').click();
const condRow = await page.evaluate(() => WA.app.doc.annotations.filter((a) => a.kind === 'condition').length);
ok('按钮加出一条条件行', condRow === 1, String(condRow));
await page.locator('.fig-canvas').scrollIntoViewIfNeeded();
figBox = await page.locator('.fig-canvas').boundingBox();
const cell = await page.evaluate(() => {
  const v = WA.figureview.view;
  const lay = v.sc.layout;
  return { x: lay.lanes[1].x * v.scale, y: (lay.condBaseline - 2) * v.scale };
});
const marksOf = () => page.evaluate(() => WA.app.doc.annotations.find((a) => a.kind === 'condition').marks[1]);
ok('初始为「无处理」', (await marksOf()) === 0, String(await marksOf()));
await page.mouse.click(figBox.x + cell.x, figBox.y + cell.y);
ok('点一次 → −', (await marksOf()) === 1, String(await marksOf()));
await page.mouse.click(figBox.x + cell.x, figBox.y + cell.y);
ok('再点 → +', (await marksOf()) === 2, String(await marksOf()));
await page.mouse.click(figBox.x + cell.x, figBox.y + cell.y);
ok('再点回到 ·', (await marksOf()) === 0, String(await marksOf()));

// 药名就地输入
await page.locator('.fig-canvas').scrollIntoViewIfNeeded();
figBox = await page.locator('.fig-canvas').boundingBox();
const drugCell = await page.evaluate(() => {
  const v = WA.figureview.view;
  const lay = v.sc.layout;
  return { x: Math.max(4, lay.img.x * 0.25) * v.scale, y: (lay.condBaseline - 2) * v.scale };
});
await page.mouse.click(figBox.x + drugCell.x, figBox.y + drugCell.y);
const drugInline = await page.locator('.fig-inline').count();
ok('点药名格子可输入药物名', drugInline === 1, String(drugInline));
if (drugInline) {
  await page.locator('.fig-inline').fill('4OHT');
  await page.locator('.fig-inline').press('Enter');
}
const drug = await page.evaluate(() => WA.app.doc.annotations.find((a) => a.kind === 'condition').drug);
ok('药物名写进条件行', drug === '4OHT', String(drug));

ok('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-p8-'));
const dl = page.waitForEvent('download', { timeout: 20000 });
await page.locator('.export-btn[data-fmt="png"]').click();
const d = await dl;
await d.saveAs(path.join(outDir, d.suggestedFilename()));
ok('导出 PNG 仍正常', fs.statSync(path.join(outDir, d.suggestedFilename())).size > 1000, d.suggestedFilename());

await browser.close();
console.log((fail ? '阶段 8 E2E 失败：' + fail + '/' + (pass + fail) : '阶段 8 E2E 全过：' + pass + ' 项'));
process.exit(fail ? 1 : 0);
