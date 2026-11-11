/* 阶段 22：换图不再覆盖 / 清空处理区 / 每条泳道单独设字号字体颜色 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const SAMPLE = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + path.resolve('src/index.html'));
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(SAMPLE));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img);
await page.evaluate(() => { const a = WA.app; WA.lanes.setCount(a.doc, 6); a.doc.laneNames = ['M','wt','7','8','21','41']; a.refresh(); });

// 1) 每条泳道自己的字号 / 字体 / 颜色只影响那一条
await page.evaluate(() => {
  const a = WA.app;
  a.doc.laneStyle = { '2': { pt: 14, family: 'Georgia', color: '#b00020' } };
  a.refresh();
});
const per = await page.evaluate(() => {
  const sc = WA.render.scene(WA.app.doc, { cropW: 1600, cropH: 1100 });
  return sc.items.filter((i) => i.kind === 'text' && Math.abs(i.y - sc.layout.namesBaseline) < 0.5)
    .map((i) => ({ t: i.text, size: i.size, family: i.family, color: i.color }));
});
const lane3 = per[2], others = per.filter((_, i) => i !== 2);
ok('被设置的那一条字号变大', lane3.size === 14 && lane3.t === '7', JSON.stringify(lane3));
ok('被设置的那一条用指定字体与颜色', lane3.family === 'Georgia' && lane3.color === '#b00020');
ok('其它泳道保持全局样式', others.every((i) => i.size === 9), JSON.stringify(others.map((i) => i.size)));

// 2) 导出 SVG 里也要带上这一条的 font-family / fill
const svg = await page.evaluate(async () => {
  const b64Of = (bytes) => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const r = await WA.exporters.run(WA.app, 'svg', { collect: true });
  return b64Of(r.bytes);
});
const text = Buffer.from(svg, 'base64').toString('utf8');
ok('SVG 里那一格用 Georgia', /font-family="Georgia"[^>]*>7</.test(text.replace(/\n/g, '')), '');
ok('SVG 里那一格用深红', /fill="#b00020"/.test(text));

// 3) 属性卡：改字号 / 字体 / 颜色都落到 doc.laneStyle
const box = await page.evaluate(() => {
  const v = WA.figureview.view, lay = v.sc.layout;
  const r = WA.figureview.canvas.getBoundingClientRect();
  return { x: r.left + (lay.img.x + (0.5 / 6) * lay.img.w) * v.scale, y: r.top + (lay.namesBaseline - 4) * v.scale };
});
await page.mouse.click(box.x, box.y);
await page.waitForSelector('.fig-pop');
await page.fill('[data-role="pop-lane-pt"]', '13');
await page.locator('[data-role="pop-lane-pt"]').dispatchEvent('change');
await page.selectOption('[data-role="pop-lane-font"]', 'Times New Roman');
await page.selectOption('[data-role="pop-lane-color"]', '#103a70');
await page.waitForTimeout(200);
const stored = await page.evaluate(() => WA.app.doc.laneStyle);
const key = '0';
ok('属性卡改的字号写进 laneStyle', stored[key] && stored[key].pt === 13, JSON.stringify(stored[key]));
ok('属性卡改的字体写进 laneStyle', stored[key].family === 'Times New Roman');
ok('属性卡改的颜色写进 laneStyle', stored[key].color === '#103a70');

// 4) 「恢复默认」清掉这一条
await page.click('[data-act="pop-clear"]');
await page.waitForTimeout(150);
const cleared = await page.evaluate(() => WA.app.doc.laneStyle && WA.app.doc.laneStyle['0']);
ok('恢复默认后那条样式被清掉', cleared === undefined, JSON.stringify(cleared));
ok('无 JS 报错', errors.length === 0, errors.join(' | '));

await b.close();
console.log('\n阶段 22 全过：' + pass + ' 项');
if (fail) { console.log('失败 ' + fail + ' 项'); process.exit(1); }
process.exit(0);
