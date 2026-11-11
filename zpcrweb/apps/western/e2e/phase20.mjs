/* 阶段 20：泳道名留空不显示、空行不占位、回车跳下一道 */
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const SAMPLE = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + path.resolve('src/index.html'));
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(SAMPLE));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img);
await page.evaluate(() => { WA.app.doc.autoLanes = false; WA.lanes.setCount(WA.app.doc, 4); WA.app.refresh(); });

// 1) 名字全部清空 → 名字行整行消失（不占高度）
const before = await page.evaluate(() => {
  const sc = WA.render.scene(WA.app.doc, { cropW: 1600, cropH: 1100 });
  return { names: sc.layout.bands.names, imgY: sc.layout.img.y };
});
ok('默认有名字时留出名字行', before.names > 0, before.names);

await page.evaluate(() => {
  const app = WA.app;
  for (let i = 0; i < app.doc.laneCount; i++) app.setLaneName(i, '');
});
await page.waitForTimeout(120);
const none = await page.evaluate(() => {
  const sc = WA.render.scene(WA.app.doc, { cropW: 1600, cropH: 1100 });
  const texts = sc.items.filter((i) => i.kind === 'text').map((i) => i.text);
  return { names: sc.layout.bands.names, imgY: sc.layout.img.y, texts };
});
ok('清空全部名字后名字行不占高度', none.names === 0, none.names);
ok('没有名字时上面的内容下沉（图片上移）', none.imgY < before.imgY, before.imgY + ' → ' + none.imgY);
ok('画布上不再出现 1/2/3/4 这种序号', !['1','2','3','4'].every((n) => none.texts.includes(n)));

// 2) 只清一个 → 只少那一个，其它保留
await page.evaluate(() => { const app = WA.app; app.setLaneName(0, 'M'); app.setLaneName(1, 'wt'); app.setLaneName(2, ''); app.setLaneName(3, '41'); });
await page.waitForTimeout(120);
const partial = await page.evaluate(() => {
  const sc = WA.render.scene(WA.app.doc, { cropW: 1600, cropH: 1100 });
  const names = sc.items.filter((i) => i.kind === 'text').map((i) => String(i.text));
  return { names, band: sc.layout.bands.names };
});
ok('保留已命名的三道', ['M', 'wt', '41'].every((n) => partial.names.includes(n)), partial.names.join(','));
ok('被清空的那一道不再显示序号', !partial.names.includes('3'), partial.names.join(','));

// 3) 点名字打开属性卡 → 改文字 → 回车跳到下一道
const box = await page.evaluate(() => {
  const v = WA.figureview.view, lay = v.sc.layout;
  const r = WA.figureview.canvas.getBoundingClientRect();
  return { x: r.left + (lay.img.x + 0.125 * lay.img.w) * v.scale, y: r.top + (lay.namesBaseline - 4) * v.scale };
});
await page.mouse.click(box.x, box.y);
await page.waitForSelector('.fig-pop', { timeout: 3000 });
ok('点泳道名打开属性卡', (await page.locator('.fig-pop h4').innerText()).indexOf('第 1 道') >= 0);
await page.fill('[data-role="pop-lane-text"]', 'AA');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const after = await page.evaluate(() => ({
  open: !!document.querySelector('.fig-pop'),
  head: document.querySelector('.fig-pop h4') ? document.querySelector('.fig-pop h4').textContent : '',
  value: document.querySelector('[data-role="pop-lane-text"]') ? document.querySelector('[data-role="pop-lane-text"]').value : null,
  names: WA.app.doc.laneNames.slice()
}));
ok('回车提交第一道', after.names[0] === 'AA', JSON.stringify(after.names));
ok('回车后自动打开下一道', after.open === true && after.head.indexOf('第 2 道') >= 0, after.head);
ok('下一道是它原来的名字', after.value === 'wt', JSON.stringify(after.value));
await page.keyboard.press('Escape');

// 4) 导出仍然正常
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-lane-'));
const dl = page.waitForEvent('download', { timeout: 20000 });
await page.locator('.export-btn[data-fmt="png"]').click();
const d = await dl;
const f = path.join(dir, d.suggestedFilename());
await d.saveAs(f);
ok('导出 PNG 落盘', fs.statSync(f).size > 1000, fs.statSync(f).size + ' B');
ok('无 JS 报错', errors.length === 0, errors.join(' | '));

await browser.close();
console.log('\n阶段 20 全过：' + pass + ' 项');
if (fail) { console.log('失败 ' + fail + ' 项'); process.exit(1); }
process.exit(0);
