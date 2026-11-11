/**
 * Score every registered Cq method (`packages/core/src/cqMethod.ts`) against a corpus of real
 * runs — see `tools/cqeval.md`. Run through vite-node, so the library is read from source:
 *
 *   npx vite-node tools/cqeval.mjs --set cfx|biomeme|all [--methods a,b] [--csv out.csv]
 *                                  [--plots dir] [--only changed|tooEarly]
 *
 * The scoring itself lives in `cqeval-lib.mjs`, which a parameter-sweep script imports directly.
 */

import { writeFileSync } from "node:fs";
import { CQ_METHODS } from "../packages/core/src/index.ts";
import { loadCorpus, printSummaries, rowsCsv, scoreRefiner, writePlots } from "./cqeval-lib.mjs";


const args = process.argv.slice(2).filter((a) => a !== "--");
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const set = opt("--set", "cfx");
const methodsArg = opt("--methods", "all");
const methods = CQ_METHODS.filter((m) => m.refine && (methodsArg === "all" || methodsArg.split(",").includes(m.id)));
const runs = loadCorpus({ set });
console.error(`${runs.length} runs, ${runs.reduce((a, r) => a + r.curves.length, 0)} positive curves`);
const named = methods.map((m) => ({ name: m.id, ...scoreRefiner(runs, m.refine) }));
if (named.length === 0) {
  console.error("no refining methods registered");
  process.exit(0);
}
printSummaries(named);
const csv = opt("--csv");
if (csv) writeFileSync(csv, rowsCsv(named));
const plots = opt("--plots");
if (plots) {
  const only = opt("--only");
  const files = writePlots(named, plots, {
    filter: only === "changed" ? (_, rs) => rs.some((r) => r.shift > 0.05) : only === "tooEarly" ? (_, rs) => rs.some((r) => r.tooEarly) : () => true,
  });
  console.error(`wrote ${files.length} sheets to ${plots}`);
}
