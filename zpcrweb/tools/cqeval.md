# `cqeval.mjs`

Scores the Cq methods (`packages/core/src/cqMethod.ts`, `threshold.md` §11) against a corpus of
real runs, and draws every positive curve with each method's Cq marked, so a method is judged on
both the numbers and the picture.

## Usage

```sh
npx vite-node tools/cqeval.mjs [--set cfx|biomeme|all] [--methods id,id] [--csv out.csv]
                               [--plots dir] [--only changed|tooEarly]
```

| Flag | Meaning |
|------|---------|
| `--set` | `cfx` (default): every `.zpcr`/`.pcrd` under the lab repo plus `samples/`, deduplicated by name, gradient tests excluded. `biomeme`: every `.bmrun`, likewise. `all`: both. |
| `--methods` | registered method ids to score (default: every method but `threshold`) |
| `--csv` | one row per positive curve: the threshold Cq, `rise3`/`rise5`, the device's own Cq (Biomeme), and each method's Cq |
| `--plots` | write contact sheets (PNG + the HTML they were shot from) into this directory |
| `--only` | plot only curves some method moved by > 0.05 cycles, or only those flagged `tooEarly` |

The lab repo is found at `~/lab/MolBioLab`, or wherever `MOLBIOLAB` points.

## What the summary means

Each run is analysed as the app opens it — its own `zpcrweb.json` thresholds honoured, a `.pcrd`'s
persisted threshold seeding the override, a Biomeme run on this library's Cq rather than the
device's. Only **positives** (a threshold Cq exists) are scored: by contract a method cannot give a
negative a Cq, so `negatives` is the same for every method.

| Metric | Meaning |
|---|---|
| `meanShift` / `medianShift` / `p90Shift` / `maxShift` | threshold Cq − method Cq, in cycles: how much earlier the method calls. Never negative. |
| `unchanged` | curves the method left on the threshold Cq (it returned `null`, or the contract clamped it) |
| `tooEarly` | curves whose Cq lands more than a cycle before `rise3` — reported where the data are still indistinguishable from noise |
| `medianLeadOverRise3` | median of `rise3 − Cq`; negative means the Cq is still after the 3σ rise |
| `repSd*` | median (and mean) standard deviation of Cq over replicate groups — ≥ 2 positive wells sharing run, sample, target and dye, NTC/NRT excluded |

`riseK` is the fractional cycle at which the corrected curve last rises through `K × σ` (its own
§5.1 noise) before the threshold Cq — the data's own "this is where it visibly lifts".

## The plots

Each curve gets a linear and a log tile side by side. The white ring is the threshold Cq, coloured
rings each method's; the dashed line is the threshold, the dotted line 3σ. The log tile floors the
curve at σ/2, so the baseline reads as a flat floor and the knee is easy to see.

## Using it as a library

`cqeval-lib.mjs` exports `loadCorpus`, `scoreRefiner`, `printSummaries`, `rowsCsv` and
`writePlots`. A parameter sweep imports them and scores candidate refiners directly — through
`applyRefiner`, so a candidate is held to exactly the contract a registered method is:

```js
import { loadCorpus, scoreRefiner, printSummaries } from "./tools/cqeval-lib.mjs";
const runs = loadCorpus({ set: "cfx" });
printSummaries([{ name: "mine", ...scoreRefiner(runs, (input) => input.thresholdCq - 1) }]);
```

`loadCorpus({ settingsPatch })` overrides analysis settings for every run — e.g.
`{ thresholdMultiplier: 10 }`, which is how `threshold.md` §C.1 priced simply lowering the threshold.

## Design notes

- **vite-node, not `dist/`.** The library is read from source, so a method being written is scored
  without a build, and several method files can be scored at once without racing over one `dist/`.
  vite-node also drops the script from `process.argv`, which is why the CLI and the library are two
  files rather than one guarded by an "am I main" check.
- **Plots are Chrome screenshots of plain SVG**, not the app's chart: a tile needs a second marker
  per method and a log floor the app doesn't draw, and nothing here is a user-facing picture.
