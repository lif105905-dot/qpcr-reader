/* 阶段 18：自动识别（泳道 + 转正）。 */
import { chromium } from 'playwright';
import path from 'node:path';

const SAMPLE = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n + (x ? '  [' + x + ']' : '')); } else { fail++; console.log('  ✗ ' + n + (x ? '  [' + x + ']' : '')); } };

const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + path.resolve('src/index.html'));
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(SAMPLE));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img);
await page.waitForTimeout(500);

const d1 = await page.evaluate(() => ({
  lanes: WA.app.doc.laneCount,
  centers: WA.app.doc.laneCenters.slice(),
  auto: WA.app.doc.autoLanes !== false,
  info: WA.app.doc.detectInfo || null
}));
ok('导入后自动识别出泳道（样本是 8 道）', d1.lanes === 8, 'lanes=' + d1.lanes);
ok('自动模式标记为开', d1.auto === true, '');
ok('中线数量与条数一致且递增', d1.centers.length === d1.lanes && d1.centers.every((c, i) => i === 0 || c > d1.centers[i - 1]), '');
ok('识别记录里有步距', !!d1.info && d1.info.pitchPx > 0, JSON.stringify(d1.info));

// 手动改条数 → 退出自动
await page.locator('.num input[type=number]').first().fill('5');
await page.locator('.num input[type=number]').first().dispatchEvent('change');
await page.waitForTimeout(120);
const d2 = await page.evaluate(() => ({ lanes: WA.app.doc.laneCount, auto: WA.app.doc.autoLanes }));
ok('手动改条数后退出自动识别', d2.lanes === 5 && d2.auto === false, 'lanes=' + d2.lanes);

// 重新识别 → 回到 8 道
await page.locator('.btn', { hasText: '重新识别' }).click();
await page.waitForTimeout(600);
const d3 = await page.evaluate(() => ({ lanes: WA.app.doc.laneCount, auto: WA.app.doc.autoLanes !== false }));
ok('点「重新识别」恢复自动结果', d3.lanes === 8 && d3.auto === true, 'lanes=' + d3.lanes);

// 关掉开关 → 不再自动
await page.locator('[data-role="lane-auto"]').uncheck();
await page.waitForTimeout(100);
ok('关掉「导入时自动识别」开关', await page.evaluate(() => WA.app.doc.autoLanes === false), '');
ok('无 JS 报错', errs.length === 0, errs.join(' | '));

await b.close();
console.log('\n阶段 18 E2E ' + (fail ? '失败：' + fail + '/' + (pass + fail) : '全过：' + pass + ' 项'));
process.exit(fail ? 1 : 0);
