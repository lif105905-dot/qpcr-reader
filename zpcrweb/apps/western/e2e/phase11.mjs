/* 阶段 11：侧边文字属性卡（成图区内弹出，对齐参考图） */
import { chromium } from 'playwright';
import path from 'node:path';

const SAMPLE = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + path.resolve('src/index.html'));
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(SAMPLE));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img);
await page.waitForTimeout(250);

const figPoint = (ax, ay) => page.evaluate(([fx, fy]) => {
  const v = WA.figureview.view;
  const r = WA.figureview.canvas.getBoundingClientRect();
  const img = v.sc.layout.img;
  return { x: r.left + (img.x + img.w * fx) * v.scale, y: r.top + (img.y + img.h * fy) * v.scale };
}, [ax, ay]);

// 1) 点「侧边文字」卡片：直接建一条并弹属性卡（不用再去图上点）
await page.locator('.ann-tile[data-tool="text"]').click();
await page.waitForTimeout(220);
ok('点卡片即弹属性卡', (await page.locator('.fig-pop').count()) === 1);
ok('点卡片即建了一条文字', (await page.evaluate(() => WA.app.doc.annotations.filter((a) => a.kind === 'text').length)) === 1);
ok('属性卡标题是「侧边文字」', (await page.locator('.fig-pop h4').textContent()).trim() === '侧边文字');
ok('有位置/左右位置/字号/颜色四项', (await page.locator('.fig-pop [data-role="pop-side"]').count()) === 1
  && (await page.locator('.fig-pop [data-role="pop-offset"]').count()) === 1
  && (await page.locator('.fig-pop [data-role="pop-size"]').count()) === 1
  && (await page.locator('.fig-pop [data-role="pop-color"]').count()) === 1);

// 2) 编辑各字段
await page.locator('[data-role="pop-text"]').fill('IB: anti-HA');
await page.selectOption('[data-role="pop-side"]', 'below');
await page.locator('[data-role="pop-offset"]').evaluate((el) => { el.value = '25'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.locator('[data-role="pop-size"]').fill('8');
await page.selectOption('[data-role="pop-color"]', '#b00020');
await page.waitForTimeout(150);
const ann = await page.evaluate(() => WA.app.doc.annotations.filter((a) => a.kind === 'text')[0]);
ok('文字写进去了', ann.text === 'IB: anti-HA', ann.text);
ok('位置 = 胶图下方', ann.side === 'below', ann.side);
ok('左右位置 = 25%', Number(ann.offsetPct) === 25, String(ann.offsetPct));
ok('字号 = 8 pt', Number(ann.fontPt) === 8, String(ann.fontPt));
ok('颜色 = 深红', ann.color === '#b00020', ann.color);

// 3) 完成关闭，再点文字能重新打开
await page.locator('[data-act="pop-done"]').click();
await page.waitForTimeout(120);
ok('「完成」后卡片关闭', (await page.locator('.fig-pop').count()) === 0);
const p1 = await page.evaluate(() => {
  const v = WA.figureview.view;
  const r = WA.figureview.canvas.getBoundingClientRect();
  const img = v.sc.layout.img;
  const t = WA.app.doc.annotations.filter((a) => a.kind === 'text')[0];
  const size = t.fontPt || 9;
  const ty = img.y + img.h + size * 1.5;
  return { x: r.left + (img.x + img.w * (t.offsetPct / 100)) * v.scale, y: r.top + ty * v.scale };
});
await page.mouse.click(p1.x, p1.y);
await page.waitForTimeout(180);
ok('再点文字能重新打开', (await page.locator('.fig-pop').count()) === 1);

// 4) 删除
await page.locator('[data-act="pop-del"]').click();
await page.waitForTimeout(150);
ok('删除后标注消失', (await page.evaluate(() => WA.app.doc.annotations.filter((a) => a.kind === 'text').length)) === 0);

// 5) 直接拖动文字改左右位置，且不会拖出图框
await page.locator('.ann-tile[data-tool="text"]').click();
await page.waitForTimeout(200);
await page.locator('[data-role="pop-text"]').fill('Coomassie');
await page.locator('[data-act="pop-done"]').click();
await page.waitForTimeout(150);
const geo = await page.evaluate(() => {
  const v = WA.figureview.view;
  const img = v.sc.layout.img;
  const r = WA.figureview.canvas.getBoundingClientRect();
  return { x: r.left + (img.x + img.w * 0.5) * v.scale, y: r.top + (img.y + img.h + 13.5) * v.scale, w: img.w * v.scale };
});
await page.mouse.move(geo.x, geo.y);
await page.mouse.down();
await page.mouse.move(geo.x + geo.w * 0.3, geo.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(180);
const moved = await page.evaluate(() => WA.app.doc.annotations.filter((a) => a.kind === 'text')[0].offsetPct);
ok('按住文字可以拖动改位置', moved > 60, String(Math.round(moved)));
const cur = await page.evaluate(() => {
  const v = WA.figureview.view;
  const img = v.sc.layout.img;
  const r = WA.figureview.canvas.getBoundingClientRect();
  const t = WA.app.doc.annotations.filter((a) => a.kind === 'text')[0];
  const size = t.fontPt || 9;
  return {
    x: r.left + (img.x + img.w * (t.offsetPct / 100)) * v.scale,
    y: r.top + (img.y + img.h + size * 1.5) * v.scale,
    w: img.w * v.scale,
  };
});
await page.mouse.move(cur.x, cur.y);
await page.mouse.down();
// 拖到画布最右边（越出图片区域）→ 必须被夹在 100%
const edge = await page.evaluate(() => WA.figureview.canvas.getBoundingClientRect().right - 2);
await page.mouse.move(edge, cur.y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(180);
const clamped = await page.evaluate(() => WA.app.doc.annotations.filter((a) => a.kind === 'text')[0].offsetPct);
ok('拖不出图框（最大 100%）', clamped <= 100 && clamped > 90, String(Math.round(clamped)));

// 6) 字号留空 = 跟随全局（点这条文字打开属性卡后读取数据）
const now = await page.evaluate(() => {
  const v = WA.figureview.view;
  const img = v.sc.layout.img;
  const r = WA.figureview.canvas.getBoundingClientRect();
  const t = WA.app.doc.annotations.filter((a) => a.kind === 'text')[0];
  const size = t.fontPt || 9;
  return {
    x: r.left + Math.min(img.x + img.w * (t.offsetPct / 100), r.right - r.left - 4) * v.scale,
    y: r.top + (img.y + img.h + size * 1.5) * v.scale,
  };
});
await page.mouse.click(now.x, now.y);
await page.waitForTimeout(220);
await page.locator('[data-act="pop-done"]').click();
await page.waitForTimeout(150);
const ann2 = await page.evaluate(() => WA.app.doc.annotations.filter((a) => a.kind === 'text')[0]);
ok('字号留空 = null（跟随全局）', ann2.fontPt == null, String(ann2.fontPt));

ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await b.close();
console.log('\n阶段 11 E2E ' + (fail ? '失败' : '全过') + '：' + pass + ' 项' + (fail ? '（' + fail + ' 失败）' : ''));
process.exit(fail ? 1 : 0);
