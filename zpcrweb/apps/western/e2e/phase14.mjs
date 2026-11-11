// 阶段 14：撤销/重做 + 项目保存/打开
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
const SAMPLE = '/Users/lijiehui/Documents/wb-studio/samples/membrane_A_long_30s.tiff';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 920 }, acceptDownloads: true })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('file://' + path.resolve('src/index.html'));
await p.locator('.mode-card[data-mode="blot"]').click();
await p.waitForSelector('.canvas-wrap');
const choose = async (sel, file) => { p.once('filechooser', (fc) => fc.setFiles(file)); await p.locator(sel).click(); };
await choose('.btn:has-text("打开图片")', SAMPLE);
await p.waitForFunction(() => window.WA.app.img);
await p.waitForTimeout(250);

const state = () => p.evaluate(() => ({
  ann: WA.app.doc.annotations.length,
  groups: WA.app.doc.annotations.filter((a) => a.kind === 'group').length,
  name0: WA.app.doc.laneNames[0],
  undo: document.querySelector('[data-act=undo]').disabled ? 0 : 1,
  redo: document.querySelector('[data-act=redo]').disabled ? 0 : 1,
}));

let s0 = await state();
ok('初始不可撤销', s0.undo === 0);

// ① 加分组 → 可撤销
await p.evaluate(() => {
  const d = WA.app.doc;
  WA.annotations.add(d, { kind: 'group', lanes: [0, 1], name: '36#' });
  WA.app.refresh();
});
await p.waitForTimeout(700);
let s1 = await state();
ok('加分组后可撤销', s1.undo === 1 && s1.groups === 1, JSON.stringify(s1));

// ② 撤销 → 分组消失；按钮状态切换
await p.locator('[data-act=undo]').click();
await p.waitForTimeout(200);
let s2 = await state();
ok('撤销后分组消失', s2.groups === 0, JSON.stringify(s2));
ok('撤销后可重做', s2.redo === 1);

// ③ 重做 → 分组回来
await p.locator('[data-act=redo]').click();
await p.waitForTimeout(200);
let s3 = await state();
ok('重做后分组回来', s3.groups === 1);

// ④ 快捷键 ⌘Z
await p.evaluate(() => { WA.app.doc.laneNames[0] = 'ZZ'; WA.app.refresh(); });
await p.waitForTimeout(700);
await p.keyboard.press('Meta+z');
await p.waitForTimeout(200);
let s4 = await state();
ok('⌘Z 撤销泳道改名', s4.name0 !== 'ZZ', s4.name0);

// ⑤ 保存项目 → 下载 .wan.json 且含原图
const dlp = p.waitForEvent('download');
await p.locator('[data-act="save-proj"]').click();
const dl = await dlp;
const saved = '/tmp/t14-project.json';
await dl.saveAs(saved);
ok('保存项目文件名是 .wan.json', /\.wan\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
const raw = fs.readFileSync(saved, 'utf8');
let payload = {};
try { payload = JSON.parse(raw); } catch (e) {}
ok('项目文件含 doc 与内嵌原图', !!payload.doc && !!payload.image && payload.image.data.length > 1000,
  `${(raw.length / 1024 / 1024).toFixed(1)} MB, image=${payload.image ? (payload.image.data.length / 1024 / 1024).toFixed(1) + ' MB' : 'none'}`);

// ⑥ 打开项目 → 分组与泳道恢复
await p.evaluate(() => { WA.app.doc.annotations = []; WA.app.doc.laneNames = ['x', 'y']; WA.app.refresh(); });
await p.waitForTimeout(200);
await choose('[data-act="open-proj"]', saved);
await p.waitForTimeout(1200);
const s6 = await p.evaluate(() => ({
  groups: WA.app.doc.annotations.filter((a) => a.kind === 'group').length,
  laneCount: WA.app.doc.laneCount,
  hasImg: !!WA.app.img,
  projName: document.querySelector('.mode-tag') ? true : true,
}));
ok('打开项目后分组恢复', s6.groups === 1, JSON.stringify(s6));
ok('打开项目后图片也恢复', s6.hasImg && s6.laneCount > 0);

// ⑦ 项目文件坏掉时给出提示而不是崩溃
const bad = '/tmp/t14-bad.json';
fs.writeFileSync(bad, '{"nope":1}');
const alertTxt = await p.evaluate(() => new Promise((res) => {
  const old = window.alert; window.alert = (m) => { window.alert = old; res(String(m)); };
  WA.app.openProject(new File(['{"nope":1}'], 'bad.json', { type: 'application/json' }));
  setTimeout(() => res(''), 800);
}));
ok('坏项目文件有明确报错', /不是 Western analysis 的项目文件/.test(alertTxt), alertTxt.slice(0, 40));

ok('无 JS 报错', errs.length === 0, errs[0] || '');
await b.close();
console.log(`\n阶段 14 E2E ${fail === 0 ? '全过' : '失败'}：${pass} 项${fail ? '，失败 ' + fail : ''}`);
process.exit(fail ? 1 : 0);
