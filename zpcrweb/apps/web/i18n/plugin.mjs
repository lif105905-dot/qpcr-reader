/**
 * Compile-time UI translation.
 *
 * The app's source stays English — that is what upstream reads, what the docs quote, and what the
 * tests assert against. This plugin swaps the *displayed* text for Chinese during the build, using
 * one dictionary (`zh-CN.json`) so every string a user can see lives in a single file that can be
 * reviewed, diffed and extended without touching a hundred components.
 *
 * What it rewrites, and nothing else:
 *   - JSX text:                <b>Plate</b>          → <b>{"板"}</b>
 *   - string literals:         "Plate"               → "板"
 *   - template strings:        `Hold ${t} °C for ${x}` → `在 ${t} °C 保持 ${x}`
 *
 * The second rule catches attributes (`title="Plate"`), object properties (`{ label: "Plate" }`)
 * and bare expressions (`{title ?? "Plate"}`) in one go. It is safe because the dictionary is a
 * hand-curated list of prose: identifiers, format names, view ids and every other non-prose string
 * is simply absent from it, and an absent key means the source is left untouched.
 *
 * Template strings are looked up with `{0}`, `{1}` … standing in for their substitutions, so one
 * key covers every value the app can interpolate into it. A template that matches is rebuilt as a
 * self-contained arrow function, which keeps the original evaluation order and needs no import.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const DICT = JSON.parse(fs.readFileSync(path.join(here, "zh-CN.json"), "utf8"));

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&ndash;": "–",
  "&mdash;": "—",
  "&times;": "×",
  "&middot;": "·",
  "&hellip;": "…",
  "&rarr;": "→",
  "&larr;": "←",
  "&deg;": "°",
};

function normalise(raw) {
  let text = raw;
  for (const [entity, character] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(character);
  }
  return text.replace(/\s+/g, " ").trim();
}

function applyEdits(code, edits) {
  let out = code;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** `在 {0} °C 保持 {1}` + `[a, b]` → `"在 "+a+" °C 保持 "+b` */
function buildTemplate(text, expressions) {
  const parts = [];
  const pattern = /\{(\d+)\}/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push({ literal: text.slice(last, match.index) });
    parts.push({ expression: expressions[Number(match[1])] });
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push({ literal: text.slice(last) });

  const params = expressions.map((_, index) => `__v${index}`);
  let next = 0;
  const body = parts
    .map((part) => (part.literal !== undefined ? JSON.stringify(part.literal) : params[next++]))
    .join(" + ");
  return `((${params.join(", ")}) => ${body})(${expressions.join(", ")})`;
}

/**
 * `.ts` files hold display strings too (`cqMethod.ts`'s method names, `sampleType.ts`'s labels,
 * `runDefinition.ts`'s step descriptions), but they also hold identifiers, view ids, file kinds and
 * dictionary keys that must never change. Only these modules are display-only, so only these are
 * translated; every other `.ts` file is left alone.
 */
const TS_DISPLAY_MODULES = [
  "/apps/web/src/lib/sampleType.ts",
  "/apps/web/src/lib/rightAxis.ts",
  "/apps/web/src/lib/alfSummary.ts",
  "/apps/web/src/lib/uplot/chart.ts",
  "/apps/web/src/lib/uplot/thermalChart.ts",
  "/apps/web/src/lib/uplot/liveThermalChart.ts",
  "/packages/core/src/cqMethod.ts",
  "/packages/core/src/temps.ts",
  "/packages/core/src/runDefinition.ts",
  "/packages/core/src/prcl.ts",
];

/**
 * The JSX attributes whose **value** is user-visible text, and so may be translated.
 *
 * Everything else is left alone on purpose. `value="Raw"` on an `<option>` is an enum, not a
 * label, and rewriting it to 原始 silently broke the baseline selector: the option rendered in
 * Chinese but selected nothing the analysis recognised. The same trap sits in `id`, `name`,
 * `data-*` and `type`, so the rule is a whitelist rather than a blacklist — a new attribute is
 * untranslated until someone names it here.
 */
const TRANSLATABLE_ATTRIBUTES = new Set([
  "title",
  "label",
  "aria-label",
  "placeholder",
  "alt",
]);

function isTranslatable(id) {
  if (id.includes("/node_modules/") || id.endsWith(".d.ts")) return false;
  if (id.endsWith(".tsx") || id.endsWith(".jsx")) return true;
  if (!id.endsWith(".ts")) return false;
  return TS_DISPLAY_MODULES.some((suffix) => id.endsWith(suffix));
}

/**
 * @param {{ dictionary?: Record<string, string> }} [options]
 * @returns {import("vite").Plugin}
 */
export default function i18nPlugin(options = {}) {
  const dictionary = options.dictionary ?? DICT;

  return {
    name: "zpcrweb-i18n",
    enforce: "pre",
    transform(code, id) {
      if (!isTranslatable(id)) return null;
      if (!code.includes(">") && !code.includes("`") && !code.includes('"')) return null;

      const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const edits = [];
      const claimed = new Set();

      const translate = (text) => dictionary[normalise(text)];

      const visit = (node) => {
        if (ts.isJsxText(node)) {
          const raw = node.getText(source);
          const trimmed = raw.trim();
          if (trimmed) {
            const zh = translate(trimmed);
            if (zh) {
              const start = node.getStart(source);
              const lead = raw.length - raw.trimStart().length;
              edits.push({
                start: start + lead,
                end: start + lead + trimmed.length,
                text: `{${JSON.stringify(zh)}}`,
              });
            }
          }
        } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
          const zh = translate(node.text);
          if (zh && !claimed.has(node.getStart(source))) {
            claimed.add(node.getStart(source));
            edits.push({ start: node.getStart(source), end: node.getEnd(), text: JSON.stringify(zh) });
          }
        } else if (ts.isTemplateExpression(node)) {
          const expressions = node.templateSpans.map((span) => span.expression.getText(source));
          let key = node.head.text;
          for (const [index, span] of node.templateSpans.entries()) {
            key += `{${index}}${span.literal.text}`;
          }
          const zh = translate(key);
          if (zh && !claimed.has(node.getStart(source))) {
            claimed.add(node.getStart(source));
            edits.push({
              start: node.getStart(source),
              end: node.getEnd(),
              text: buildTemplate(zh, expressions),
            });
            return; // do not translate the expressions themselves twice
          }
        } else if (ts.isStringLiteral(node)) {
          // Skip the literal that names a property or a JSX attribute: `{ "label": "Plate" }` keeps
          // its key, and only the value is translated.
          const parent = node.parent;
          const isName =
            (ts.isPropertyAssignment(parent) && parent.name === node) ||
            (ts.isJsxAttribute(parent) && parent.name === node);
          // A JSX attribute's value is translated only for the display attributes above: an
          // `<option value="Raw">` is an enum, and translating it breaks the control.
          const jsxAttr = ts.isJsxAttribute(parent) ? parent : null;
          const isOpaqueAttributeValue =
            jsxAttr != null && !TRANSLATABLE_ATTRIBUTES.has(jsxAttr.name.getText(source));
          if (!isName && !isOpaqueAttributeValue && !claimed.has(node.getStart(source))) {
            const zh = translate(node.text);
            if (zh) {
              claimed.add(node.getStart(source));
              edits.push({
                start: node.getStart(source),
                end: node.getEnd(),
                text: JSON.stringify(zh),
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
      if (edits.length === 0) return null;
      return { code: applyEdits(code, edits), map: null };
    },
  };
}
