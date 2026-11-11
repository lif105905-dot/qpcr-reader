// 阶段 19：暂存面板（同一张图处理多个区域）+ 批量导出
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa19-'));
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail += 1; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
};

await p.goto('file://' + path.resolve('src/index.html'));
await p.locator('.mode-card[data-mode="blot"]').click();
await p.waitForSelector('.canvas-wrap');
p.once('filechooser', (fc) => fc.setFiles('/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff'));
await p.locator('.btn', { hasText: '打开图片' }).click();
await p.waitForFunction(() => window.WA.app.img);
await p.waitForTimeout(200);

// 1) 命名 + 暂存两块
await p.evaluate(() => {
  const app = WA.app;
  WA.lanes.setCount(app.doc, 6);
  app.doc.exportOptions.fileBase = 'membrane-A';
  app.refresh();
  app.stashPanel();                       // 暂存后自动重置成新面板
  WA.lanes.setCount(app.doc, 4);
  app.doc.exportOptions.fileBase = 'membrane-B';
  app.refresh();
  app.stashPanel();
  app.paintTray();
});
const st = await p.evaluate(() => ({
  n: WA.app.tray.length,
  names: WA.app.tray.map((t) => t.name),
  selected: WA.app.tray.every((t) => t.selected),
  thumbs: WA.app.tray.map((t) => (t.thumb || '').slice(0, 15)),
  lanes: WA.app.tray.map((t) => t.doc.laneCount),
  rows: document.querySelectorAll('.tray-item').length,
  active: WA.app.activeTrayId
}));
ok('暂存两块面板', st.n === 2 && st.rows === 2, st.n + ' / ' + st.rows);
ok('名字在暂存前就定好', st.names.join(',') === 'membrane-A,membrane-B', st.names.join(','));
ok('每块都带缩略图', st.thumbs.every((t) => t.startsWith('data:image/png')), st.thumbs[0]);
ok('暂存后当前编辑被重置（新面板）', st.active === null, String(st.active));
ok('各面板保留自己的泳道数', st.lanes.join(',') === '6,4', st.lanes.join(','));

// 2) 打开已暂存的继续修改，并回写
await p.evaluate(() => WA.app.openPanel(WA.app.tray[1].id));
await p.waitForTimeout(200);
const reopened = await p.evaluate(() => ({ lanes: WA.app.doc.laneCount, active: WA.app.activeTrayId === WA.app.tray[1].id }));
ok('点开已暂存的面板可继续编辑', reopened.active && reopened.lanes === 4, 'lanes=' + reopened.lanes);
await p.evaluate(() => { WA.lanes.setCount(WA.app.doc, 5); WA.app.refresh(); });
await p.waitForTimeout(200);
const synced = await p.evaluate(() => WA.app.tray[1].doc.laneCount);
ok('编辑后自动回写暂存项', synced === 5, String(synced));

// 3) 批量导出：两块 → zip，条目名各自带名字
const dl = p.waitForEvent('download');
await p.evaluate(() => WA.app.exportSelected('png'));
const d = await dl;
const zipPath = path.join(tmp, 'figs.zip');
await d.saveAs(zipPath);
const buf = fs.readFileSync(zipPath);
const names = [];
for (let i = 0; i + 30 < buf.length; i++) {
  if (buf.readUInt32LE(i) === 0x04034b50) {
    const n = buf.readUInt16LE(i + 26);
    names.push(buf.slice(i + 30, i + 30 + n).toString('utf8'));
  }
}
ok('多张打包成 zip', d.suggestedFilename() === 'figures_2.zip' && buf.slice(0, 2).toString() === 'PK', d.suggestedFilename());
ok('zip 里文件名用面板名', names.some((n) => /^membrane-A_600dpi\.png$/.test(n)) && names.some((n) => /^membrane-B_600dpi\.png$/.test(n)), names.join(' | '));

// 4) 删除
await p.evaluate(() => WA.app.removePanel(WA.app.tray[0].id));
const afterDel = await p.evaluate(() => ({ n: WA.app.tray.length, rows: document.querySelectorAll('.tray-item').length }));
ok('删除暂存项', afterDel.n === 1 && afterDel.rows === 1, afterDel.n + ' / ' + afterDel.rows);

// 5) 叠放：条目多到放不下时，列表自己滚动并且最后一条能滚到可见区域
await p.evaluate(() => {
  const app = WA.app;
  for (let i = 0; i < 14; i++) { app.doc.exportOptions.fileBase = 'bulk-' + i; app.refresh(); app.stashPanel(); }
});
await p.waitForTimeout(300);
const box = await p.evaluate(() => {
  const el = document.querySelector('.tray-list');
  const cs = getComputedStyle(el);
  el.scrollTop = el.scrollHeight;
  const last = document.querySelectorAll('.tray-item')[document.querySelectorAll('.tray-item').length - 1];
  const lr = last.getBoundingClientRect(), cr = el.getBoundingClientRect();
  return {
    overflow: cs.overflowY,
    scrollable: el.scrollHeight > el.clientHeight + 4,
    lastVisible: lr.bottom <= cr.bottom + 2 && lr.top >= cr.top - 2,
    count: document.querySelectorAll('.tray-item').length
  };
});
ok('条目多时列表可滚动', box.overflow === 'auto' && box.scrollable, box.overflow + ' / ' + box.count + ' 项');
ok('滚到底能看到最后一条（不被截断）', box.lastVisible === true);

ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await b.close();
console.log('\n阶段 19 ' + (fail ? '失败：' + fail + '/' + (pass + fail) : '全过：' + pass + ' 项'));
process.exit(fail ? 1 : 0);
