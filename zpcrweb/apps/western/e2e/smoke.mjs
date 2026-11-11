
// 阶段 1 冒烟：首页两张卡 → 进编辑器 → 回首页；主题切换并记住。
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page_url = 'file://' + path.resolve(here, '../src/index.html');

const checks = [];
function ok(name, cond, extra) {
  checks.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) });
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--allow-file-access-from-files']
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(page_url);
await page.waitForSelector('.mode-card');

ok('首页有 2 张模式卡', (await page.locator('.mode-card').count()) === 2);
const names = await page.locator('.mode-card .mode-name').allInnerTexts();
ok('卡片是 Western blot / 凝胶', names.join('|').includes('Western blot') && names.join('|').includes('凝胶'), names.join('|'));

await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.editor');
ok('进入编辑器', (await page.getAttribute('html', 'data-screen')) === 'editor');
ok('三栏都在', (await page.locator('.pane').count()) === 3);
ok('模式标签正确', (await page.locator('.mode-tag').innerText()).includes('Western blot'));

await page.locator('[data-act="home"]').click();
await page.waitForSelector('.home');
ok('能回到首页', (await page.getAttribute('html', 'data-screen')) === 'home');

// 主题：切深色 → 立刻生效并写入 localStorage
await page.locator('.mode-card[data-mode="gel"]').click();
await page.waitForSelector('.editor');
await page.locator('.theme-switch button[data-theme="dark"]').click();
ok('深色立即生效', (await page.getAttribute('html', 'data-theme')) === 'dark');
ok('偏好写入 localStorage', (await page.evaluate(() => localStorage.getItem('wa-theme'))) === 'dark');
await page.locator('.theme-switch button[data-theme="light"]').click();
ok('浅色立即生效', (await page.getAttribute('html', 'data-theme')) === 'light');
await page.locator('.theme-switch button[data-theme="system"]').click();
const pref = await page.getAttribute('html', 'data-theme-pref');
ok('跟随系统可切换', pref === 'system', pref);

// 重新加载：偏好应记忆（这次是 system）
await page.reload();
await page.waitForSelector('.mode-card');
ok('重载后回首页（每次都回首页）', (await page.getAttribute('html', 'data-screen')) === 'home');
ok('主题偏好在重载后保留', (await page.getAttribute('html', 'data-theme-pref')) === 'system');

ok('无 JS 报错', errors.length === 0, errors.join(' | '));

await browser.close();

let bad = 0;
for (const c of checks) {
  if (!c.pass) bad++;
  console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name + (c.extra ? '  [' + c.extra + ']' : ''));
}
console.log(bad === 0 ? '\nE2E 全过：' + checks.length + ' 项' : '\nE2E 失败：' + bad + '/' + checks.length);
process.exit(bad === 0 ? 0 : 1);
