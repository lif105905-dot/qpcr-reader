/* 阶段 21：换图不再覆盖已暂存面板；清空处理区只清工作区 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const SAMPLE = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
const SAMPLE2 = '/Users/lijiehui/Documents/wb-studio/samples/membrane_B_30s.tiff';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('file://' + path.resolve('src/index.html'));
await p.locator('.mode-card[data-mode="blot"]').click();
await p.waitForSelector('.canvas-wrap');
p.once('filechooser', (fc) => fc.setFiles(SAMPLE));
await p.locator('.btn', { hasText: '打开图片' }).click();
await p.waitForFunction(() => window.WA.app.img);

// 第一张：命名 + 暂存
await p.evaluate(() => {
  const app = WA.app;
  WA.lanes.setCount(app.doc, 6);
  app.doc.exportOptions.fileBase = 'first';
  app.refresh();
  app.stashPanel();
});
const afterFirst = await p.evaluate(() => ({ n: WA.app.tray.length, name: WA.app.tray[0].name, img: WA.app.tray[0].doc.image.name }));
ok('第一张已暂存', afterFirst.n === 1 && afterFirst.name === 'first', JSON.stringify(afterFirst));
ok('暂存里是第一张图', /membrane_A/.test(afterFirst.img), afterFirst.img);

// 拖进第二张图（模拟拖放：直接调 openFile，和拖放同一条路径）
p.once('filechooser', (fc) => fc.setFiles(SAMPLE2));
await p.locator('.btn', { hasText: '打开图片' }).click();
await p.waitForFunction(() => !!(window.WA.app.img && WA.app.doc.image && /membrane_B/.test(WA.app.doc.image.name)));
const afterSecond = await p.evaluate(() => ({
  trayName: WA.app.tray[0].name,
  trayImg: WA.app.tray[0].doc.image.name,
  curImg: WA.app.doc.image.name,
  active: WA.app.activeTrayId
}));
ok('换图后第一张面板没被改写', /membrane_A/.test(afterSecond.trayImg) && afterSecond.trayName === 'first', afterSecond.trayImg);
ok('当前是第二张图', /membrane_B/.test(afterSecond.curImg), afterSecond.curImg);
ok('换图后不处于「编辑暂存项」状态', afterSecond.active === null);

// 第二张也暂存 → 两张不同图
await p.evaluate(() => { const app = WA.app; app.doc.exportOptions.fileBase = 'second'; app.refresh(); app.stashPanel(); });
const both = await p.evaluate(() => WA.app.tray.map((t) => t.name + ':' + t.doc.image.name));
ok('两张面板各自保留自己的图', both.length === 2 && /first:membrane_A/.test(both[0]) && /second:membrane_B/.test(both[1]), both.join(' | '));

// 分别导出这两张，像素必须不同（曾经出现「第一张被第二张覆盖」）
const shots = [];
for (let i = 0; i < 2; i++) {
  const r = await p.evaluate(async (idx) => {
    const app = WA.app;
    app.openPanel(app.tray[idx].id);
    const b64Of = (bytes) => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
    const out = await WA.exporters.run(app, 'png', { collect: true });
    return { name: out.name, b64: b64Of(out.bytes) };
  }, i);
  shots.push(r);
  fs.writeFileSync('/tmp/panel-' + i + '.png', Buffer.from(r.b64, 'base64'));
}
ok('两张面板导出成两个文件', shots[0].name !== shots[1].name, shots[0].name + ' / ' + shots[1].name);
ok('两张导出的图内容不同（没有被覆盖）', shots[0].b64 !== shots[1].b64,
   fs.statSync('/tmp/panel-0.png').size + ' B vs ' + fs.statSync('/tmp/panel-1.png').size + ' B');

// 多选导出仍然打包成 zip，且条目名用面板名
const dl = p.waitForEvent('download', { timeout: 20000 });
await p.evaluate(() => { const app = WA.app; app.activeTrayId = null; app.paintTray(); });
await p.locator('[data-act="tray-export"]').click();
const zipFile = await dl;
const zpath = '/tmp/tray-two.zip';
await zipFile.saveAs(zpath);
const zbuf = fs.readFileSync(zpath);
const names = [];
for (let i = 0; i + 30 < zbuf.length; i++) {
  if (zbuf.readUInt32LE(i) === 0x04034b50) { const n = zbuf.readUInt16LE(i + 26); names.push(zbuf.toString('utf8', i + 30, i + 30 + n)); }
}
ok('多选导出打包成 zip', names.length === 2, names.join(','));
ok('zip 里两个文件名不同', new Set(names).size === 2, names.join(','));

// 清空处理区：暂存还在，工作区空
await p.evaluate(() => WA.app.clearPanel());
await p.waitForTimeout(200);
const cleared = await p.evaluate(() => ({
  tray: WA.app.tray.length,
  names: WA.app.tray.map((t) => t.name),
  img: WA.app.img,
  docImage: WA.app.doc.image,
  active: WA.app.activeTrayId
}));
ok('清空处理区后暂存还在', cleared.tray === 2, cleared.names.join(','));
ok('处理区已无图片', cleared.img === null && cleared.docImage === null);

// 清空后拖入第三张：不覆盖任何暂存
p.once('filechooser', (fc) => fc.setFiles(SAMPLE));
await p.locator('.btn', { hasText: '打开图片' }).click();
await p.waitForFunction(() => window.WA.app.img);
const third = await p.evaluate(() => ({ n: WA.app.tray.length, tray: WA.app.tray.map((t) => t.name + ':' + t.doc.image.name) }));
ok('清空后拖新图不会多出/改写面板', third.n === 2 && /first:membrane_A/.test(third.tray[0]) && /second:membrane_B/.test(third.tray[1]), third.tray.join(' | '));

// 点「编辑」回到第一张，仍然是第一张的图
await p.evaluate(() => WA.app.openPanel(WA.app.tray[0].id));
await p.waitForTimeout(200);
const reopened = await p.evaluate(() => ({ img: WA.app.doc.image.name, active: !!WA.app.activeTrayId }));
ok('暂存项仍可返回修改', /membrane_A/.test(reopened.img) && reopened.active === true, reopened.img);
ok('无 JS 报错', errors.length === 0, errors.join(' | '));

await b.close();
console.log('\n阶段 21 全过：' + pass + ' 项');
if (fail) { console.log('失败 ' + fail + ' 项'); process.exit(1); }
process.exit(0);
