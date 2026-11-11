/* 阶段 12：分组分层（大组在小族上方） */
import { chromium } from 'playwright';
import path from 'node:path';

const SAMPLE = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + path.resolve('src/index.html'));
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(SAMPLE));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img);

// 4 道 + 嵌套分组：A=[0,1] B=[2,3] AB=[0..3]
await page.evaluate(() => {
  const d = WA.app.doc;
  WA.lanes.setCount(d, 4);
  d.laneNames = ['1', '2', '3', '4'];
  WA.annotations.add(d, { kind: 'group', lanes: [0, 1], name: 'A' });
  WA.annotations.add(d, { kind: 'group', lanes: [2, 3], name: 'B' });
  WA.annotations.add(d, { kind: 'group', lanes: [0, 1, 2, 3], name: 'AB' });
  WA.app.refresh();
});
await page.waitForTimeout(250);

const geo = await page.evaluate(() => {
  const sc = WA.render.scene(WA.app.doc, { cropW: WA.app.img.w, cropH: WA.app.img.h });
  const texts = sc.items.filter((i) => i.kind === 'text');
  const find = (t) => texts.filter((i) => i.text === t)[0];
  return {
    levels: sc.layout.groupLevelCount,
    AB_y: find('AB') && find('AB').y,
    A_y: find('A') && find('A').y,
    B_y: find('B') && find('B').y,
    groupBaselines: sc.layout.groupBaselines,
    imgY: sc.layout.img.y,
  };
});
ok('嵌套组算出 2 层', geo.levels === 2, String(geo.levels));
ok('大组 AB 在小组上方', geo.AB_y < geo.A_y && geo.AB_y < geo.B_y,
  'AB=' + Math.round(geo.AB_y) + ' A=' + Math.round(geo.A_y));
ok('A、B 在同一层', Math.abs(geo.A_y - geo.B_y) < 0.5, 'A=' + Math.round(geo.A_y) + ' B=' + Math.round(geo.B_y));
ok('小组在图上方（不压图）', geo.A_y < geo.imgY, Math.round(geo.A_y) + ' < ' + Math.round(geo.imgY));
ok('两条组基线都在标题下', geo.groupBaselines.length === 2 && geo.groupBaselines[0] < geo.groupBaselines[1]);

// 只留 A、B（不重叠）→ 回到一层
await page.evaluate(() => {
  WA.app.doc.annotations = WA.app.doc.annotations.filter((a) => !(a.kind === 'group' && a.name === 'AB'));
  WA.app.refresh();
});
await page.waitForTimeout(200);
const geo2 = await page.evaluate(() => {
  const sc = WA.render.scene(WA.app.doc, { cropW: WA.app.img.w, cropH: WA.app.img.h });
  return { levels: sc.layout.groupLevelCount, baselines: sc.layout.groupBaselines.length };
});
ok('删掉大组后回到 1 层', geo2.levels === 1 && geo2.baselines === 1, JSON.stringify(geo2));

// 导出仍然正常
const dl = page.waitForEvent('download');
await page.locator('.export-btn[data-fmt="png"]').click();
const saved = await dl;
const fname = saved.suggestedFilename();
ok('导出 PNG 落盘', /_600dpi\.png$/.test(fname) && !/\.tiff_.*_600dpi/.test(fname), fname);

ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await b.close();
console.log('\n阶段 12 E2E ' + (fail ? '失败' : '全过') + '：' + pass + ' 项' + (fail ? '（' + fail + ' 失败）' : ''));
process.exit(fail ? 1 : 0);
