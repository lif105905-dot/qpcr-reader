/* 阶段 10：按最严格投稿要求导出 —— 矢量 PDF、投稿包、尺寸/分辨率预设、投稿检查 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const SAMPLE = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa10-'));
let pass = 0; let fail = 0;
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
await page.evaluate(() => { WA.lanes.setCount(WA.app.doc, 4); WA.app.doc.title = 'Fig1'; WA.app.refresh(); });
await page.waitForTimeout(250);

// 1) 尺寸/分辨率预设存在
ok('有宽度预设', (await page.locator('[data-role="fig-width"] option').count()) === 5);
ok('有分辨率预设', (await page.locator('[data-role="fig-dpi"] option').count()) === 3);

// 2) 切双栏 174 mm → 成图变宽
const w85 = await page.evaluate(() => WA.figureview.view.sc.widthPt);
await page.selectOption('[data-role="fig-width"]', '174');
await page.waitForTimeout(200);
const w174 = await page.evaluate(() => WA.figureview.view.sc.widthPt);
ok('切到 174 mm 后成图变宽', w174 > w85 * 1.8, Math.round(w85) + ' → ' + Math.round(w174));

// 3) 投稿检查：故意把字号设 4 pt
await page.evaluate(() => { WA.app.doc.style.fontPt = 4; WA.app.refresh(); });
await page.waitForTimeout(120);
const issuesSmall = await page.evaluate(() => WA.app.submissionIssues().map((i) => i.text).join(' | '));
ok('字号 4 pt 会报错', /小于期刊下限/.test(issuesSmall), issuesSmall);
await page.evaluate(() => { WA.app.doc.style.fontPt = 9; WA.app.doc.exportOptions.dpi = 300; WA.app.doc.style.antibody = 'anti-X'; WA.app.refresh(); });
await page.waitForTimeout(120);
const issues300 = await page.evaluate(() => WA.app.submissionIssues().map((i) => i.text).join(' | '));
ok('300 dpi 给建议提升', /建议 600 dpi/.test(issues300), issues300);
await page.evaluate(() => { WA.app.doc.exportOptions.dpi = 600; WA.app.refresh(); });
await page.waitForTimeout(120);
const issuesOk = await page.evaluate(() => WA.app.submissionIssues().length);
ok('达标后检查为空', issuesOk === 0, issuesOk);

// 4) 矢量 PDF：界面上已去掉 PDF 按钮（按用户要求只留 PNG/SVG/TIFF/原图），
//    但导出管线仍然必须支持 PDF —— 直接调 API 验证，不放宽任何断言
await page.evaluate(() => { WA.app.doc.exportOptions.fileBase = 'DAXX fig1'; WA.app.paintStyle(); });
const dl1 = page.evaluate(async () => {
  const b64Of = (bytes) => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const r = await WA.exporters.run(WA.app, 'pdf', { collect: true });
  return { name: r.name, b64: b64Of(r.bytes) };
});
const f1 = await dl1;
const pdfPath = path.join(tmp, 'fig.pdf');
fs.writeFileSync(pdfPath, Buffer.from(f1.b64, 'base64'));
ok('可以用自定义文件名导出', /^DAXX_fig1\.pdf$/.test(f1.name), f1.name);
const pdf = fs.readFileSync(pdfPath, 'latin1');
ok('PDF 是矢量（有 /F1 与 Tj）', pdf.includes('/F1') && pdf.includes('Tj'));
ok('PDF 里图像是 XObject', pdf.includes('/Subtype /Image'));
ok('PDF 文件头正确', pdf.startsWith('%PDF-'));

// 5) 投稿包：六个条目（按钮同样已从界面移除，改走 API）
const f2 = await page.evaluate(async () => {
  const b64Of = (bytes) => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const r = await WA.exporters.run(WA.app, 'pack', { collect: true });
  return { b64: b64Of(r.bytes) };
});
const zipPath = path.join(tmp, 'pack.zip');
fs.writeFileSync(zipPath, Buffer.from(f2.b64, 'base64'));
const zbuf = fs.readFileSync(zipPath);
const names = [];
for (let i = 0; i + 30 < zbuf.length; i++) {
  if (zbuf.readUInt32LE(i) === 0x04034b50) {
    const nlen = zbuf.readUInt16LE(i + 26);
    names.push(zbuf.toString('utf8', i + 30, i + 30 + nlen));
  }
}
ok('投稿包是 zip', zbuf.slice(0, 2).toString() === 'PK');
ok('包含 TIFF', names.some((n) => /\.tiff$/.test(n)), names.length + ' 项');
ok('包含 SVG 与 PDF', names.some((n) => /\.svg$/.test(n)) && names.some((n) => /\.pdf$/.test(n)));
ok('包含原始未裁剪图', names.some((n) => n.startsWith('original_')));
ok('包含处理日志 JSON', names.some((n) => /\.json$/.test(n)));
ok('包含 README 检查清单', names.some((n) => /README\.txt$/.test(n)));


// 「抗体说明」不再是投稿检查项（DNA 凝胶不需要抗体）；凝胶工作区连输入行也隐藏
const antibodyCheck = await page.evaluate(() => {
  WA.app.doc.style.antibody = '';
  return WA.app.submissionIssues().map((i) => i.text).join(' | ');
});
ok('投稿检查里不再有抗体提示', antibodyCheck === '' || !/抗体/.test(antibodyCheck), antibodyCheck || '(空)');

const gelState = await page.evaluate(() => {
  WA.app.openMode('gel');
  WA.app.refresh();
  const wrap = document.querySelector('[data-role=antibody-wrap]');
  return {
    hidden: wrap ? getComputedStyle(wrap).display === 'none' : true,
    issues: WA.app.submissionIssues().map((i) => i.text).join(' | ')
  };
});
ok('凝胶工作区隐藏抗体输入行', gelState.hidden, '');
ok('凝胶工作区也不提抗体', !/抗体/.test(gelState.issues), gelState.issues || '(空)');


// 没问题时不再显示「✓ 投稿检查通过」小字（整行隐形但保留高度，避免跳动）
const okLine = await page.evaluate(() => {
  while (WA.app.submissionIssues().length) {
    const it = WA.app.submissionIssues()[0];
    if (it.text.indexOf('字号') >= 0) WA.app.doc.style.fontPt = 7;
    else if (it.text.indexOf('线宽') >= 0) WA.app.doc.style.lineWidthPt = 0.5;
    else if (it.text.indexOf('dpi') >= 0) WA.app.doc.exportOptions.dpi = 600;
    else if (it.text.indexOf('栏宽') >= 0) WA.app.doc.exportOptions.widthMm = 85;
    else break;
    WA.app.refresh();
  }
  const b = document.querySelector('[data-role=sub-issues]');
  return { text: b.textContent.trim(), vis: getComputedStyle(b).visibility, issues: WA.app.submissionIssues().length, h: Math.round(b.getBoundingClientRect().height) };
});
ok('全部达标时不显示任何检查文字', okLine.issues === 0 && okLine.text === '' && okLine.vis === 'hidden', JSON.stringify(okLine));
ok('检查行仍占位（不跳动）', okLine.h >= 14, String(okLine.h) + 'px');


// 导出尺寸/比例：TIFF 必须写对 X/Y 分辨率（否则 PPT/预览里会被按错 dpi 摆放，比例还歪）
const meta = await page.evaluate(async () => {
  const cv = document.createElement('canvas'); cv.width = 40; cv.height = 20;
  const gray = new Uint8Array(40 * 20).fill(200);
  const tif = WA.exporter.tiffGray8(40, 20, gray, 600);
  const dv = new DataView(tif.buffer);
  const xres = dv.getUint32(8 + 2 + 9 * 12 + 8, true);   // 282 的 value 字段（RATIONAL 偏移）
  const ratX = dv.getUint32(xres, true), ratXd = dv.getUint32(xres + 4, true);
  const png = WA.exporter.pngWithDpi(new Uint8Array([0]), 300);
  return { ratX, ratXd, ifd: dv.getUint16(8, true), pngLen: png.length };
});
ok('TIFF 写了 XResolution=600/1', meta.ratX === 600 && meta.ratXd === 1, meta.ratX + '/' + meta.ratXd);
ok('TIFF 的 IFD 有 12 个标签（含 YResolution/单位）', meta.ifd === 12, String(meta.ifd));


ok('无 JS 报错', errors.length === 0, errors.join(' | '));
await b.close();
console.log('\n阶段 10 E2E ' + (fail ? '失败' : '全过') + '：' + pass + ' 项' + (fail ? '（' + fail + ' 失败）' : ''));
process.exit(fail ? 1 : 0);
