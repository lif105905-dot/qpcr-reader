// 阶段 16：首尾等距联动 + 泳道名批量粘贴
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
await p.evaluate(() => { WA.lanes.setCount(WA.app.doc, 5); WA.app.refresh(); });
await p.waitForTimeout(200);

// ① 首尾等距：拖中间那根，其余按新跨度等分
await p.check('[data-role=lane-linked]');
await p.waitForTimeout(120);
const linked = await p.evaluate(() => WA.app.doc.laneLinked);
ok('首尾等距开关打开', linked === true);

await p.evaluate(() => {
  const d = WA.app.doc;
  // 先把首尾弄得不对称：首=0.1，尾=0.9
  d.laneCenters = [0.1, 0.3, 0.5, 0.7, 0.9];
  d.laneCenters = WA.lanes.linkedMove(d.laneCenters, 0, 0.2);
  WA.app.refresh();
});
const c1 = await p.evaluate(() => WA.app.doc.laneCenters.slice());
const even1 = c1.every((v, i) => Math.abs(v - (0.2 + (0.9 - 0.2) * i / 4)) < 1e-6);
ok('拖首根后中间按新跨度等分', even1, c1.map((v) => v.toFixed(3)).join(','));

// ② 关掉后拖中间不影响别人
await p.uncheck('[data-role=lane-linked]');
await p.waitForTimeout(120);
const c2 = await p.evaluate(() => {
  const d = WA.app.doc;
  const before = d.laneCenters.slice();
  d.laneCenters = WA.lanes.moveCenter(d.laneCenters, 2, 0.45);
  return { before, after: d.laneCenters.slice() };
});
ok('关掉后只动被拖那一根', Math.abs(c2.after[0] - c2.before[0]) < 1e-6 && Math.abs(c2.after[4] - c2.before[4]) < 1e-6);

// ③ 批量填名
await p.evaluate(() => { WA.lanes.setCount(WA.app.doc, 4); WA.app.refresh(); });
await p.waitForTimeout(150);
await p.locator('.lane-bulk-btn').click();
await p.fill('.lane-bulk-text', 'Ctrl\nLPS 1h\nLPS 6h\nLPS 24h');
await p.locator('.lane-bulk .btn').last().click();
await p.waitForTimeout(200);
const names = await p.evaluate(() => WA.app.doc.laneNames.slice());
ok('批量粘贴按行填入', names.join('|') === 'Ctrl|LPS 1h|LPS 6h|LPS 24h', names.join('|'));

// ④ 逗号/制表符也认
await p.locator('.lane-bulk-btn').click();
await p.fill('.lane-bulk-text', 'A,B\tC，D');
await p.locator('.lane-bulk .btn').last().click();
await p.waitForTimeout(200);
const names2 = await p.evaluate(() => WA.app.doc.laneNames.slice());
ok('逗号/制表符/中文逗号都能分', names2.join('|') === 'A|B|C|D', names2.join('|'));

// ⑤ 名字数量不够时保留原值、多了截断
await p.locator('.lane-bulk-btn').click();
await p.fill('.lane-bulk-text', 'X');
await p.locator('.lane-bulk .btn').last().click();
await p.waitForTimeout(200);
const names3 = await p.evaluate(() => WA.app.doc.laneNames.slice());
ok('只填一个时其余保留', names3[0] === 'X' && names3.length === 4, names3.join('|'));

ok('无 JS 报错', errs.length === 0, errs[0] || '');
await b.close();
console.log(`\n阶段 16 E2E ${fail === 0 ? '全过' : '失败'}：${pass} 项${fail ? '，失败 ' + fail : ''}`);
process.exit(fail ? 1 : 0);
