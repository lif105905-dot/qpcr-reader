// 阶段 13：GelFigure 布局细节（组线端点 / 分组文字适配 / 最小字号 / 样品名顺序 / 面板字母）
import { chromium } from 'playwright';
import path from 'node:path';
const SAMPLE = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
};
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 920 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('file://' + path.resolve('src/index.html'));
await p.locator('.mode-card[data-mode="blot"]').click();
await p.waitForSelector('.canvas-wrap');
p.once('filechooser', (fc) => fc.setFiles(SAMPLE));
await p.locator('.btn', { hasText: '打开图片' }).click();
await p.waitForFunction(() => window.WA.app.img);
await p.evaluate(() => {
  const d = WA.app.doc;
  WA.lanes.setCount(d, 6);
  d.laneNames = ['1', '2', '3', '4', '5', '6'];
  WA.annotations.add(d, { kind: 'group', lanes: [0, 1, 2], name: '一个特别特别特别特别特别特别长的组名字' });
  WA.app.refresh();
});
await p.waitForTimeout(200);

const scene = () => p.evaluate(() => {
  const sc = WA.render.scene(WA.app.doc, { cropW: WA.app.img.w, cropH: WA.app.img.h });
  return { items: sc.items.map((i) => ({ k: i.kind, x: i.x, y: i.y, t: i.text, w: i.width })), lay: sc.layout };
});

// ① 默认：样品名在条件行上方
await p.evaluate(() => { const d = WA.app.doc; WA.annotations.add(d, { kind: 'condition', name: '4OHT', marks: [0,1,0,1,0,1] }); WA.app.refresh(); });
await p.waitForTimeout(150);
let S = await scene();
ok('默认样品名在条件行上方', S.lay.namesBaseline < S.lay.condBaseline, `${S.lay.namesBaseline.toFixed(1)} < ${S.lay.condBaseline.toFixed(1)}`);

// ② 关掉开关 → 条件行回到上方
await p.evaluate(() => { WA.app.doc.style.laneNamesAbove = false; WA.app.refresh(); });
await p.waitForTimeout(150);
S = await scene();
ok('关掉开关后条件行回到上方', S.lay.condBaseline < S.lay.namesBaseline);

// ③ 组线端点
await p.evaluate(() => { WA.app.doc.style.laneNamesAbove = true; WA.app.doc.style.groupTicks = false; WA.app.refresh(); });
await p.waitForTimeout(120);
const beforeTicks = (await scene()).items.length;
await p.evaluate(() => { WA.app.doc.style.groupTicks = true; WA.app.refresh(); });
await p.waitForTimeout(120);
const afterTicks = (await scene()).items.length;
ok('组线端点打开后多两条竖线', afterTicks - beforeTicks === 2, `${beforeTicks} → ${afterTicks}`);

// ④ 分组文字：wrap 折行 / shrink 缩字号 / none 溢出
const ginfo = () => p.evaluate(() => {
  const sc = WA.render.scene(WA.app.doc, { cropW: WA.app.img.w, cropH: WA.app.img.h });
  const g = sc.layout.groupItems[0];
  return { lines: g.lines.length, size: g.size, tw: g.tw, text: g.lines.join('|') };
});
await p.evaluate(() => { WA.app.doc.style.groupFit = 'wrap'; WA.app.refresh(); });
await p.waitForTimeout(120);
let g = await ginfo();
ok('分组文字默认折行', g.lines >= 2, g.text);

await p.evaluate(() => { WA.app.doc.style.groupFit = 'shrink'; WA.app.refresh(); });
await p.waitForTimeout(120);
g = await ginfo();
ok('shrink 时是一行且字号变小', g.lines === 1 && g.size < 9, `size=${g.size} lines=${g.lines}`);

await p.evaluate(() => { WA.app.doc.style.groupFit = 'none'; WA.app.refresh(); });
await p.waitForTimeout(120);
g = await ginfo();
ok('none 时保持一行原字号', g.lines === 1 && g.size === 9, `size=${g.size}`);

// ⑤ 面板字母
await p.evaluate(() => { WA.app.doc.style.groupFit = 'wrap'; WA.app.doc.style.panelLetter = 'B'; WA.app.refresh(); });
await p.waitForTimeout(120);
S = await scene();
const letter = S.items.filter((i) => i.k === 'text' && i.t === 'B')[0];
ok('面板字母画在成图上', !!letter && letter.y < S.lay.img.y + 4);

// ⑥ 样式条控件齐全且与数据同步
const ui = await p.evaluate(() => ({
  ticks: !!document.querySelector('[data-role=group-ticks]'),
  fit: document.querySelector('[data-role=group-fit]') ? document.querySelector('[data-role=group-fit]').value : '',
  namesAbove: document.querySelector('[data-role=names-above]') ? document.querySelector('[data-role=names-above]').checked : null,
  letter: document.querySelector('[data-role=panel-letter]') ? document.querySelector('[data-role=panel-letter]').value : '',
}));
ok('样式条有四个新控件且同步', ui.ticks && ui.namesAbove === true && ui.letter === 'B' && ui.fit === 'wrap', JSON.stringify(ui));

ok('无 JS 报错', errs.length === 0, errs[0] || '');
await b.close();
console.log(`\n阶段 13 E2E ${fail === 0 ? '全过' : '失败'}：${pass} 项${fail ? '，失败 ' + fail : ''}`);
process.exit(fail ? 1 : 0);
