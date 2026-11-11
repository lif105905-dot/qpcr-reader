// 阶段 15：每项字体（泳道名 / Marker 各自字号、*斜体* 标记）
import { chromium } from 'playwright';
import path from 'node:path';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 920 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('file://' + path.resolve('src/index.html'));
await p.locator('.mode-card[data-mode="blot"]').click();
await p.waitForSelector('.canvas-wrap');
p.once('filechooser', (fc) => fc.setFiles('/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff'));
await p.locator('.btn', { hasText: '打开图片' }).click();
await p.waitForFunction(() => window.WA.app.img);
await p.evaluate(() => {
  const d = WA.app.doc;
  WA.lanes.setCount(d, 4);
  d.laneNames = ['1', '2', '3', '*4*'];
  WA.app.setMarkerLane(0);
  const ys = WA.ladders.all().filter((l) => /Yeasen/.test(l.name))[0];
  d.marker.ladderId = ys.id;
  WA.app.setMarkerSizes(ys.sizes.slice(0, 3));
  WA.app.refresh();
});
await p.waitForTimeout(250);

const scene = () => p.evaluate(() => {
  const sc = WA.render.scene(WA.app.doc, { cropW: WA.app.img.w, cropH: WA.app.img.h });
  const ix = sc.layout.img.x;
  return sc.items.filter((i) => i.kind === 'text').map((i) => ({ t: i.text, size: i.size, italic: !!i.italic, y: i.y, x: i.x, outside: i.x < ix - 1 }));
});

let S = await scene();
const name1 = S.filter((i) => i.t === '2')[0];
const base = name1 ? name1.size : 0;
ok('泳道名默认跟随全局字号', Math.abs(base - 9) < 0.01, base);

// ① 单独设泳道名字号
await p.evaluate(() => { WA.app.doc.style.laneNamePt = 6; WA.app.refresh(); });
await p.waitForTimeout(150);
S = await scene();
ok('泳道名字号可单独设 6pt', Math.abs(S.filter((i) => i.t === '2')[0].size - 6) < 0.01, S.filter((i) => i.t === '2')[0].size);

// ② Marker 字号
await p.evaluate(() => { WA.app.doc.style.markerPt = 8; WA.app.refresh(); });
await p.waitForTimeout(150);
S = await scene();
const mk = S.filter((i) => i.outside && /^\d+$/.test(i.t))[0];
ok('Marker 字号可单独设 8pt', !!mk && Math.abs(mk.size - 8) < 0.01, mk ? mk.size : 'none');

// ③ 留空回到跟随
await p.evaluate(() => { WA.app.doc.style.laneNamePt = null; WA.app.doc.style.markerPt = null; WA.app.refresh(); });
await p.waitForTimeout(150);
S = await scene();
ok('清空后回到跟随全局', Math.abs(S.filter((i) => i.t === '2')[0].size - 9) < 0.01);

// ④ *斜体* 标记：星号去掉、整条按斜体画
const ital = S.filter((i) => i.t === '4')[0];
ok('泳道名 *4* 去掉星号', !!ital);
ok('*4* 被标成斜体', !!ital && ital.italic === true);

// ⑤ 样式条两个输入存在且同步
const ui = await p.evaluate(() => ({
  lane: !!document.querySelector('[data-role=lane-name-pt]'),
  mark: !!document.querySelector('[data-role=marker-pt]'),
  laneVal: document.querySelector('[data-role=lane-name-pt]').value,
  markVal: document.querySelector('[data-role=marker-pt]').value,
}));
ok('样式条有泳道名/Marker 字号两个输入', ui.lane && ui.mark && ui.laneVal === '' && ui.markVal === '', JSON.stringify(ui));

// ⑥ 输入后写回数据
await p.fill('[data-role=lane-name-pt]', '7');
await p.locator('[data-role=lane-name-pt]').press('Enter');
await p.locator('[data-role=lane-name-pt]').evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
await p.waitForTimeout(200);
const v = await p.evaluate(() => WA.app.doc.style.laneNamePt);
ok('输入 7 写回 laneNamePt', v === 7, v);

ok('无 JS 报错', errs.length === 0, errs[0] || '');
await b.close();
console.log(`\n阶段 15 E2E ${fail === 0 ? '全过' : '失败'}：${pass} 项${fail ? '，失败 ' + fail : ''}`);
process.exit(fail ? 1 : 0);
