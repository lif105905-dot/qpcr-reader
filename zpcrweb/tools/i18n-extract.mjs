import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = "apps/web/src";
const ATTRS = new Set(["title", "label", "placeholder", "aria-label", "alt", "aria-description"]);
const PROPS = new Set(["label", "title", "description", "hint", "placeholder", "tooltip", "caption", "message", "heading", "subheading", "emptyText", "note", "ariaLabel"]);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(e.name)) files.push(p);
  }
})(ROOT);

const found = new Map();
for (const file of files) {
  const code = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const add = (s, kind) => {
    const t = s.trim();
    if (!t || t.length < 2) return;
    if (!/[A-Za-z]/.test(t)) return;
    if (/^[\w.-]+$/.test(t) && t.length < 4) return;
    if (!found.has(t)) found.set(t, { kind, count: 0, files: new Set() });
    const e = found.get(t); e.count++; e.files.add(file);
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.getText(sf).trim();
      if (raw && /[A-Za-z]/.test(raw)) add(raw, "jsx");
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (ATTRS.has(name) && node.initializer && ts.isStringLiteral(node.initializer)) add(node.initializer.text, "attr");
    } else if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sf).replace(/["']/g, "");
      if (PROPS.has(name) && ts.isStringLiteral(node.initializer)) add(node.initializer.text, "prop");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
const rows = [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log("unique:", rows.length);
const out = rows.map(([text, e]) => ({ text, kind: e.kind, count: e.count, files: [...e.files].map(f => f.replace("apps/web/src/", "")) }));
fs.writeFileSync("/tmp/i18n_candidates.json", JSON.stringify(out, null, 1));
for (const r of rows.slice(0, 40)) console.log(`${r[1].kind.padEnd(5)} ${String(r[1].count).padStart(3)}  ${r[0].slice(0, 90)}`);
