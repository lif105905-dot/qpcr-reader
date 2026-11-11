// 阶段 5：六类标注（含拖动）+ 导出五格式落盘。
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = 'file://' + path.resolve(here, '../src/index.html');
const sample = process.env.SAMPLE_TIFF || path.resolve(process.env.HOME, 'Documents/wb-studio/samples/membrane_A_long_30s.tiff');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-export-'));

const checks = [];
const ok = (n, c, e) => checks.push({ name: n, pass: !!c, extra: e === undefined ? '' : String(e) });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(pageUrl);
await page.locator('.mode-card[data-mode="blot"]').click();
await page.waitForSelector('.canvas-wrap');
page.once('filechooser', (fc) => fc.setFiles(sample));
await page.locator('.btn', { hasText: '打开图片' }).click();
await page.waitForFunction(() => window.WA.app.img, null, { timeout: 15000 });

// 4 条泳道
const num = page.locator('.num input[type=number]').first();
await num.fill('4');
await num.dispatchEvent('change');
await page.waitForTimeout(50);

// 成图区坐标助手
async function figPoint(fx, fy) {
  return page.evaluate(([ax, ay]) => {
    const cv = document.querySelector('.fig-canvas');
    const r = cv.getBoundingClientRect();
    const v = WA.figureview.view;
    const img = v.sc.layout.img;
    const x = img.x + img.w * ax;
    const y = img.y + img.h * ay;
    return { x: r.left + x * v.scale, y: r.top + y * v.scale };
  }, [fx, fy]);
}
async function figLanePoint(i, row) {
  return page.evaluate(([idx, rw]) => {
    const cv = document.querySelector('.fig-canvas');
    const r = cv.getBoundingClientRect();
    const v = WA.figureview.view;
    const img = v.sc.layout.img;
    const x = img.x + WA.app.doc.laneCenters[idx] * img.w;
    const y = rw === 'name' ? v.sc.layout.namesBaseline : (rw === 'cond' ? v.sc.layout.condBaseline : img.y + img.h * 0.4);
    return { x: r.left + x * v.scale, y: r.top + y * v.scale };
  }, [i, row]);
}

// 1) 分组横线：在成图区拖过第 1、2 道泳道名
const n1 = await figLanePoint(0, 'name');
const n2 = await figLanePoint(1, 'name');
await page.mouse.move(n1.x, n1.y);
await page.mouse.down();
await page.mouse.move(n2.x, n2.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(80);
await page.locator('.fig-inline').fill('Ctrl');
await page.keyboard.press('Enter');
await page.waitForTimeout(80);

// 2) 条件行：点卡片加一行 → 点药名格子输 EGF → 点 1、3 道格子两下成 +
await page.locator('.ann-tile[data-tool="condition"]').click();
await page.waitForTimeout(120);
const drugPt = await page.evaluate(() => {
  const cv = document.querySelector('.fig-canvas');
  const r = cv.getBoundingClientRect();
  const v = WA.figureview.view;
  const lay = v.sc.layout;
  return { x: r.left + (lay.img.x - 20) * v.scale, y: r.top + lay.condBaseline * v.scale };
});
await page.mouse.click(drugPt.x, drugPt.y);
await page.waitForTimeout(120);
if (await page.locator('.fig-inline').count()) {
  await page.locator('.fig-inline').fill('EGF');
  await page.keyboard.press('Enter');
}
for (const i of [0, 2]) {
  const pt = await figLanePoint(i, 'cond');
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(40);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(40);
}

// 3) 目标条带：点卡片后在图上点一下（自动带出 kDa）
await page.locator('.ann-tile[data-tool="band"]').click();
const bandPos = await figPoint(0.5, 0.4);
await page.mouse.click(bandPos.x, bandPos.y);
await page.waitForTimeout(120);

// 4) 区域框：拖一个框
await page.locator('.ann-tile[data-tool="box"]').click();
const b0 = await figPoint(0.2, 0.3); const b1 = await figPoint(0.5, 0.6);
await page.mouse.move(b0.x, b0.y); await page.mouse.down(); await page.mouse.move(b1.x, b1.y, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(120);

// 5) 侧边括号：左侧上下拖
await page.locator('.ann-tile[data-tool="bracket"]').click();
const k0 = await figPoint(0.02, 0.2); const k1 = await figPoint(0.02, 0.7);
await page.mouse.move(k0.x, k0.y); await page.mouse.down(); await page.mouse.move(k1.x, k1.y, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(120);

// 6) 侧边文字：点卡片后在图上点一下并输入
await page.locator('.ann-tile[data-tool="text"]').click();
const t0 = await figPoint(0.15, 0.85);
await page.mouse.click(t0.x, t0.y);
await page.waitForTimeout(150);
if (await page.locator('.fig-pop').count()) {
  await page.locator('[data-role="pop-text"]').fill('anti-pERK 30s');
  await page.locator('[data-act="pop-done"]').click();
  await page.waitForTimeout(80);
}
await page.waitForTimeout(60);

const kinds = await page.evaluate(() => WA.app.doc.annotations.map((a) => a.kind).sort().join(','));
ok('六类标注都能加', kinds.split(',').sort().join() === 'band,box,bracket,condition,group,text', kinds);

// 拖动侧边文字：位置改变
const before = await page.evaluate(() => WA.app.doc.annotations.filter((a) => a.kind === 'text')[0]);
const textPos = await page.evaluate(() => {
  const t = WA.canvasview.geometry();
  const r = WA.canvasview.cropPx();
  const a = WA.app.doc.annotations.filter((x) => x.kind === 'text')[0];
  const p = WA.canvasmath.toScreen({ x: r.x + a.x * r.w, y: r.y + a.y * r.h }, t);
  const box = WA.canvasview.canvas.getBoundingClientRect();
  return { x: box.left + p.x, y: box.top + p.y };
});
await page.mouse.move(textPos.x, textPos.y);
await page.mouse.down();
await page.mouse.move(textPos.x + 5, textPos.y + 60, { steps: 6 });
await page.mouse.up();
const after = await page.evaluate(() => WA.app.doc.annotations.filter((a) => a.kind === 'text')[0]);
ok('侧边文字可拖动', Math.abs(after.y - before.y) > 0.02, before.y.toFixed(3) + ' → ' + after.y.toFixed(3));

// 标注列表有 6 行
ok('标注列表 6 行', (await page.locator('.ann-row').count()) === 6);

// 成图随标注更新（像素差）
const dark = await page.evaluate(() => {
  const c = document.querySelector('.fig-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 60) n++;
  return n;
});
ok('成图有标注像素', dark > 500, dark);

// 导出五格式
for (const fmt of ['png', 'svg', 'tiff', 'pdf', 'pptx']) {
  // 界面上 PDF 按钮已按用户要求撤掉，但导出管线仍必须支持 → 用 API 导出同样的产物
  let fname;
  const btn = page.locator(`.export-btn[data-fmt="${fmt}"]`);
  if (await btn.count()) {
    const dl = page.waitForEvent('download', { timeout: 20000 });
    await btn.click();
    const d = await dl;
    fname = d.suggestedFilename();
    await d.saveAs(path.join(outDir, fname));
  } else {
    const r = await page.evaluate(async (f) => {
      const b64Of = (bytes) => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
      const x = await WA.exporters.run(WA.app, f, { collect: true });
      return { name: x.name, b64: b64Of(x.bytes) };
    }, fmt);
    fname = r.name;
    fs.writeFileSync(path.join(outDir, fname), Buffer.from(r.b64, 'base64'));
  }
  const file = path.join(outDir, fname);
  const size = fs.statSync(file).size;
  const head = fs.readFileSync(file).subarray(0, 12);
  let magic = '';
  if (fmt === 'png') magic = head[0] === 0x89 && head[1] === 0x50 ? 'png' : 'bad';
  if (fmt === 'tiff') magic = head[0] === 0x49 && head[1] === 0x49 ? 'tiff' : 'bad';
  if (fmt === 'pdf') magic = head.toString('latin1').startsWith('%PDF') ? 'pdf' : 'bad';
  if (fmt === 'svg') magic = head.toString('utf8').startsWith('<svg') ? 'svg' : 'bad';
  if (fmt === 'pptx') magic = head[0] === 0x50 && head[1] === 0x4b ? 'zip' : 'bad';
  ok('导出 ' + fmt.toUpperCase() + ' 落盘且格式正确', size > 1000 && magic !== 'bad', fname + ' ' + size + 'B ' + magic);
}

// SVG 里应嵌了图
const svgFile = fs.readdirSync(outDir).filter((f) => f.endsWith('.svg'))[0];
const svgText = fs.readFileSync(path.join(outDir, svgFile), 'utf8');
ok('SVG 内嵌图片', svgText.includes('<image'), svgFile);

// 删一条标注
await page.locator('.ann-row').first().locator('button').click();
ok('删除标注生效', (await page.evaluate(() => WA.app.doc.annotations.length)) === 5);

ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await browser.close();

let bad = 0;
for (const c of checks) { if (!c.pass) bad++; console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.name + (c.extra ? '  [' + c.extra + ']' : '')); }
console.log(bad === 0 ? '\n阶段 5 E2E 全过：' + checks.length + ' 项' : '\n阶段 5 E2E 失败：' + bad + '/' + checks.length);
process.exit(bad === 0 ? 0 : 1);
