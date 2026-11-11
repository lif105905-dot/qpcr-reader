// 单文件产物的冒烟：能打开、能导图、能导出。
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const file = path.resolve('/Users/lijiehui/Documents/wb-next/dist/WesternAnalysis.html');
const sample = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-bundle-'));
const checks = [];
const ok = (n, c, e) => checks.push({ name: n, pass: !!c, extra: e === undefined ? '' : String(e) });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + file);
ok('单文件能打开', (await page.locator('.mode-card').count()) >= 2);
await page.locator('.mode-card[data-mode="blot"]').click();
page.once('filechooser', (fc) => fc.setFiles(sample));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img, null, { timeout: 15000 });
ok('单文件能导图', (await page.evaluate(() => WA.app.img.width)) === 1600);
const dl = page.waitForEvent('download', { timeout: 30000 });
await page.locator('.export-btn[data-fmt="png"]').click();
const d = await dl;
await d.saveAs(path.join(outDir, d.suggestedFilename()));
ok('单文件能导出', fs.statSync(path.join(outDir, d.suggestedFilename())).size > 1000, d.suggestedFilename());
ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await browser.close();
let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name + (c.extra ? '  [' + c.extra + ']' : '')); }
console.log(bad === 0 ? '\n单文件冒烟全过：' + checks.length + ' 项' : '\n单文件冒烟失败：' + bad);
process.exit(bad === 0 ? 0 : 1);
