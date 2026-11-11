/* 把 src/index.html 里的外链脚本与样式内联，产出单文件 HTML（离线双击可用）。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
let html = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8');

const inline = (code) => code.replace(/<\/script>/g, '<\\/script>');

html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, rel) => {
  const file = path.resolve(srcDir, rel);
  const code = fs.readFileSync(file, 'utf8');
  return '<script>\n' + inline(code) + '\n</script>';
});

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, rel) => {
  const file = path.resolve(srcDir, rel);
  const css = fs.readFileSync(file, 'utf8');
  return '<style>\n' + css + '\n</style>';
});

const out = path.join(root, 'dist', 'WesternAnalysis.html');
fs.writeFileSync(out, html, 'utf8');
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log('built', path.relative(root, out), kb + ' KB');
if (/<script src=/.test(html)) { console.error('还有外链脚本没内联'); process.exit(1); }
if (/<link rel="stylesheet"/.test(html)) { console.error('还有外链样式没内联'); process.exit(1); }
