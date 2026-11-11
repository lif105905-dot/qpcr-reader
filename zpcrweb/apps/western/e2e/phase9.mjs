// 阶段 9：Marker 面板（参考 GelFigure 版式）——自定义 ladder、按条带对位、面板元素
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(here, '../../wb-studio/samples/membrane_A_long_30s.tiff');
const checks = [];
const ok = (name, pass, extra) => { checks.push({ name, pass, extra: extra == null ? '' : String(extra) }); };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + path.resolve(here, '../src/index.html'));
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(SAMPLE));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img);

// 1 面板结构
ok('有「孔 N」与「吻合 %」', await page.locator('.mk-hole').count() === 1 && await page.locator('[data-role="mk-match"]').count() === 1, '');
ok('有「所在泳道」与「型号」下拉', await page.locator('.marker-lane-select').count() === 1 && await page.locator('.ladder-select').count() === 1, '');

// 2 条带清单可折叠且带徽章
ok('条带清单是 details（可折叠）', await page.locator('details.mk-details').filter({ hasText: '条带（显示' }).count() === 1, '');
await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('.band-chk input')];
  boxes.slice(0, 3).forEach((b) => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
});
ok('勾选后徽章变「已选」', (await page.locator('.band-badge').first().textContent()) === '已选', await page.locator('.band-badge').first().textContent());
const bandSummary = page.locator('details.mk-details').filter({ hasText: '条带（显示' }).locator('summary');
ok('摘要显示 显示 3/总', /显示 3\//.test(await bandSummary.textContent()), await bandSummary.textContent());

// 3 自定义 ladder
const customDetails = page.locator('details.mk-details').filter({ hasText: '自定义 Ladder' });
await customDetails.locator('summary').click();
await page.locator('input[placeholder*="名称"]').fill('测试 ladder');
await page.locator('input[placeholder*="分子量"]').fill('180,130,100');
await customDetails.locator('.btn', { hasText: '添加' }).click();
const custom = await page.evaluate(() => WA.ladders.loadCustom().map((l) => l.name));
ok('自定义 ladder 已保存', custom.includes('测试 ladder'), custom.join(','));

// 4 按条带重新对位（改变刻度位置并给出吻合度）
const before = await page.evaluate(() => WA.app.doc.marker.points.map((p) => +p.y.toFixed(3)).join(','));
await page.locator('.mk-card .btn', { hasText: '按条带重新对位' }).click();
await page.waitForTimeout(150);
const after = await page.evaluate(() => WA.app.doc.marker.points.map((p) => +p.y.toFixed(3)).join(','));
ok('「按条带重新对位」会移动刻度', before !== after, before + ' -> ' + after);
ok('给出吻合度百分比', /吻合 \d+%/.test(await page.locator('[data-role="mk-match"]').textContent()), await page.locator('[data-role="mk-match"]').textContent());

// 5 备份
const dl = page.waitForEvent('download');
await page.locator('.mk-btns .btn', { hasText: '备份 Marker 库' }).click();
const file = await dl;
ok('备份导出 JSON', /marker-ladders\.json$/.test(file.suggestedFilename()), file.suggestedFilename());

ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await browser.close();

let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name + (c.extra ? '  [' + c.extra + ']' : '')); }
console.log(bad === 0 ? '\n阶段 9 E2E 全过：' + checks.length + ' 项' : '\n阶段 9 E2E 失败：' + bad + '/' + checks.length);
process.exit(bad === 0 ? 0 : 1);
