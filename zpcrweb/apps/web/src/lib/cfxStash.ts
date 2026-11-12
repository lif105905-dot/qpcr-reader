/**
 * CFX's own Cq tables, kept aside until the run they belong to is opened.
 *
 * A plate folder holds one `.pcrd` and a family of CSVs that CFX exported from it. The ones we can
 * use are `… -  Quantification Cq Results_0.csv` (per-well Cq, the numbers the instrument showed)
 * and `… -  Quantification Amplification Results_SYBR.csv` (its baseline-corrected curves). Neither
 * is a file the app can open on its own — they describe a run, they are not one — so dropping them
 * has always been a no-op. This stash is what lets a folder drop do the obvious thing instead:
 * remember the tables by the run name in their filename, and hand them to the run when it opens.
 *
 * Matching is by stem, because CFX names every export `<run> -  <report>.csv` and the run file is
 * `<run>.pcrd`. `admin_2026-11-06 22-47-10_BR009578.pcrd` pairs with
 * `admin_2026-11-06 22-47-10_BR009578 -  Quantification Cq Results_0.csv`.
 */

/** The part of a CFX export name that identifies the run: everything before ` -  ` if present. */
export function cfxRunStem(fileName: string): string {
  const base = fileName.replace(/^.*[/\\]/, "");
  const dash = base.indexOf(" -");
  const stem = dash > 0 ? base.slice(0, dash) : base;
  return stem.replace(/\.(pcrd|zpcr|csv|txt)$/i, "");
}

/** Whether a name looks like CFX's per-well Cq export. */
export function isCfxCqName(fileName: string): boolean {
  return /quantification\s+cq\s+results/i.test(fileName) && /\.csv$/i.test(fileName);
}

/** Whether a name looks like CFX's amplification (baseline-corrected curve) export. */
export function isCfxAmplificationName(fileName: string): boolean {
  return /quantification\s+amplification\s+results/i.test(fileName) && /\.csv$/i.test(fileName);
}

/** Cq tables waiting for their run, by run stem. Two exports of one run replace each other. */
const cqByStem = new Map<string, Map<string, number>>();
const amplificationTextByStem = new Map<string, string>();

export function stashCfxCq(fileName: string, values: Map<string, number>): void {
  if (values.size === 0) return;
  cqByStem.set(cfxRunStem(fileName), values);
}

export function stashCfxAmplification(fileName: string, text: string): void {
  amplificationTextByStem.set(cfxRunStem(fileName), text);
}

/** The Cq table that came with this run, if the user dropped one. */
export function stashedCfxCq(runName: string): Map<string, number> | null {
  return cqByStem.get(cfxRunStem(runName)) ?? null;
}

/** The amplification CSV that came with this run, if the user dropped one. */
export function stashedCfxAmplification(runName: string): string | null {
  return amplificationTextByStem.get(cfxRunStem(runName)) ?? null;
}
