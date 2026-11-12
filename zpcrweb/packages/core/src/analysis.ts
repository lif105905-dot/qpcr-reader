/**
 * Analytical transforms over curve data. Kept in the library (not the UI) so they are
 * covered by the test suite and shared by any consumer.
 */

import {
  BASELINE_END_MARGIN,
  baselineRegion,
  endPointRfu,
  fitLinearBaseline,
  smoothPlateauTail,
  subtractBaseline,
  type BaselineMode,
  type BaselineRegion,
  type LinearBaselineFit,
} from "./baseline.js";
import {
  autoThreshold,
  baselineNoise,
  computeCq,
  curvatureEstimate,
  resolveThreshold,
  type AutoThresholdOptions,
} from "./threshold.js";
import { refineCq, type CqMethod } from "./cqMethod.js";

export interface CurveBaselineResult {
  baselineRegion: BaselineRegion;
  correctedValues: number[];
  /** §5.2 noise estimate — how much the corrected curve jitters over `baselineRegion`. */
  noise: number;
  /** Endpoint rise relative to the baseline: the curve's last corrected value minus the mean
   * corrected value over `baselineRegion` (≈ the last value itself, since baseline subtraction
   * already centers the region near zero — computed explicitly so it stays correct for `"Raw"`
   * mode too, which does no subtraction). Distinct from `CqTableEntry.endRfu`, which averages the
   * last five cycles and is what the instrument reports. */
  deltaRfu: number;
  /** The line actually fitted over `baselineRegion` — `rfu = intercept + slope × cycle` — so
   * callers can plot the baseline itself. Always the linear fit, whatever `mode` is. */
  baselineFit: LinearBaselineFit;
}

/**
 * How many times {@link baselineCorrectCurve} may re-fit. The region depends on the Cq and the Cq
 * depends on the region, so the pair is iterated to a fixed point.
 *
 * **6, measured** (`threshold.md` §B.4). Across the five committed runs most curves never move
 * their region at all, an amplifying one settles in 3–5 passes, and exactly one curve of the 1056
 * oscillates indefinitely between two adjacent regions — the cap is for that one, and raising it
 * to 200 changes no Cq anywhere. The loop itself is not removable: without it the run §A.8
 * measures against lands 7.36 cycles off CFX rather than 0.107.
 */
const MAX_BASELINE_PASSES = 6;

/**
 * Baseline-correct one curve and derive its per-well metrics (`threshold.md` §3–§5).
 *
 * The region is chosen by `baselineRegion`: the whole run for a well with no Cq, stopping two
 * cycles short of the Cq for one that has it. Since the Cq is what the correction is *for*, the
 * two are iterated — correct over the whole run, take a Cq, re-fit ending before it, repeat until
 * the region stops moving. `threshold` is the value that provisional Cq is taken against; pass
 * `null` to skip the refinement entirely (the whole-run baseline), which is what the first pass of
 * {@link computeCqTable} does before any threshold exists.
 *
 * Nothing here is smoothed. CFX's exported corrected curves are unsmoothed white noise about their
 * baselines even though the run persists `pCRDigitalFilter="WeightedMean"` (`threshold.md` §A.6),
 * so the filter named in the file is not applied to the curve that gets analysed.
 */
export function baselineCorrectCurve(
  cycles: number[],
  values: number[],
  mode: BaselineMode,
  threshold: number | null = null,
  declaredWindow: BaselineRegion | null = null,
  driftCorrection = false,
  endMargin: number = BASELINE_END_MARGIN,
): CurveBaselineResult {
  // A window the document declares for itself (`Zpcr.declaredBaselineWindow`) is used verbatim:
  // it is the instrument's own Data-Window baseline, so there is nothing left to search for, and
  // re-deriving it from a provisional Cq only moves it away from what CFX reports.
  // CFX's "Baseline Drift Correction" is a second pass over the *corrected* values: whatever
  // slope is left inside the window gets subtracted too. `LinearBaseLineNormalized` already
  // removed it from the raw curve, so there is nothing left to do there.
  const correct = (
    r: BaselineRegion,
    raw: number[],
    m: BaselineMode,
  ): number[] => {
    const once = subtractBaseline(cycles, raw, r, m);
    if (!driftCorrection || m === "LinearBaseLineNormalized") return once;
    const drift = fitLinearBaseline(cycles, once, r);
    return once.map((v, i) => v - (drift.slope * cycles[i]! + drift.intercept));
  };

  let region = declaredWindow ?? baselineRegion(cycles, null, endMargin);
  let correctedValues = correct(region, values, mode);

  if (declaredWindow == null && threshold != null) {
    for (let pass = 0; pass < MAX_BASELINE_PASSES; pass++) {
      const next = baselineRegion(cycles, computeCq(cycles, correctedValues, threshold), endMargin);
      if (next.beginCycle === region.beginCycle && next.endCycle === region.endCycle) break;
      region = next;
      correctedValues = correct(region, values, mode);
    }
  }

  const noise = baselineNoise(cycles, correctedValues, region);
  let regionSum = 0;
  let regionCount = 0;
  for (let i = 0; i < cycles.length; i++) {
    if (cycles[i]! >= region.beginCycle && cycles[i]! <= region.endCycle) {
      regionSum += correctedValues[i]!;
      regionCount++;
    }
  }
  const baselineMean = regionCount > 0 ? regionSum / regionCount : 0;

  return {
    baselineRegion: region,
    correctedValues,
    noise,
    deltaRfu: (correctedValues.at(-1) ?? 0) - baselineMean,
    baselineFit: fitLinearBaseline(cycles, values, region),
  };
}

/**
 * Baseline-correct a curve that will never be quantified — a raw per-channel trace, a dark
 * overlay — for display alongside the ones that are.
 *
 * Such a curve has no threshold group to take a threshold from, so the region refinement is driven
 * by the curve's own noise instead: correct over the whole run, take {@link autoThreshold} of that
 * one noise estimate, and re-correct. That is the same rule {@link computeCqTable} applies, with a
 * cohort of one, and it is here rather than inlined in the app so a plotted baseline and a
 * quantified one can never drift apart.
 */
export function correctCurveForDisplay(
  cycles: number[],
  values: number[],
  mode: BaselineMode,
  options: AutoThresholdOptions = {},
  driftCorrection = false,
  endMargin: number = BASELINE_END_MARGIN,
): CurveBaselineResult {
  const wholeRun = baselineCorrectCurve(cycles, values, mode, null, null, driftCorrection, endMargin);
  return baselineCorrectCurve(
    cycles,
    values,
    mode,
    autoThreshold([wholeRun.noise], options),
    null,
    driftCorrection,
    endMargin,
  );
}

/** Default baseline mode for every Cq in the app: `threshold.md` §4's `LinearBaseLineNormalized`.
 * Baselining is not a user choice — what the Curves view *plots* is (see its `CurveView` setting),
 * but that never feeds a Cq. */
export const ANALYSIS_BASELINE_MODE: BaselineMode = "LinearBaseLineNormalized";

/** One curve entering {@link computeCqTable}. */
export interface CqTableCurve {
  /** Identity of the curve — one well/fluorophore pair — and the key its result is filed under.
   * Duplicates are dropped (first wins) so a repeated pair can neither be double-counted in its
   * group's noise cohort nor end up with two different Cq values. */
  key: string;
  /** Threshold group (`threshold.md` §5.2): one threshold per group, resolved from the median
   * baseline noise across that group's curves. Normally the fluorophore. */
  group: string;
  cycles: number[];
  values: number[];
  /** Whether this curve joins its group's noise cohort — default `true`. Set `false` for a curve
   * that should still *get* a Cq but shouldn't influence the group's threshold, i.e. a well/fluor
   * pair the plate never loaded (real signal isn't expected there, so its noise shouldn't set the
   * bar for wells that were loaded). Never use it to reflect a display filter: that's exactly the
   * subset-dependence this table exists to eliminate. A group whose curves *all* opt out falls
   * back to using them all, rather than resolving a meaningless zero threshold. */
  contributesToThreshold?: boolean;
}

/** One well/fluorophore pair's analysis result — every Cq-related number the UI shows for it. */
export interface CqTableEntry extends CurveBaselineResult {
  group: string;
  /** The threshold this curve's Cq was taken against: its {@link group}'s value, unless a
   * per-curve override replaced it — see {@link thresholdSource}. */
  threshold: number;
  /** The threshold resolved for {@link group} as a whole, reported separately so a UI can show
   * what the group is on even when every curve in it overrides. */
  groupThreshold: number;
  /** Where {@link threshold} came from: §5.1's auto value, an override on the whole {@link group},
   * or one on this curve alone (which outranks both). */
  thresholdSource: "auto" | "group" | "curve";
  /** The reported Cq: {@link thresholdCq}, or the {@link CqTableOptions.cqMethod} refinement of
   * it — never later than it, and never present when it is absent (`cqMethod.ts`). */
  cq: number | null;
  /** §6's threshold-crossing Cq, whatever the method. Baseline regions, the plateau filter and
   * every threshold are placed with this, so switching methods moves only {@link cq}. */
  thresholdCq: number | null;
  /** The end-point RFU (`threshold.md` §7): the mean of the last five cycles of the corrected
   * curve, after `LinearBaseLineNormalizedCurveFit`'s plateau filter. Reproduces CFX's own
   * `End RFU` exactly. Some assays report this instead of a Cq. */
  endRfu: number;
}

export interface CqTableOptions {
  /** Manual per-group threshold overrides, keyed by {@link CqTableCurve.group}. A group with no
   * entry uses the auto threshold. On a `.pcrd` the run's own persisted
   * `thresholdOverrideValue` is what seeds these. */
  thresholdOverrides?: ReadonlyMap<string, number>;
  /**
   * Manual per-*curve* threshold overrides, keyed by {@link CqTableCurve.key} — the finest grain a
   * threshold can be set at, and the highest precedence.
   *
   * A group threshold is a median over a cohort (§5.1), which is the right default precisely
   * because it refuses to follow any single well — but that also means one well with an unusual
   * baseline can't be corrected without moving every other well with it. This is the escape hatch.
   * An overridden curve still joins its group's noise cohort: its noise is a real measurement, and
   * dropping it would silently change every *other* curve's threshold.
   */
  curveThresholdOverrides?: ReadonlyMap<string, number>;
  /** §5.1 auto-threshold tuning for groups with no override — see {@link AutoThresholdOptions}. */
  autoThreshold?: AutoThresholdOptions;
  /** Baseline subtraction mode; defaults to {@link ANALYSIS_BASELINE_MODE} and should normally be
   * left alone, so every view reports the same Cq. */
  baselineMode?: BaselineMode;
  /** Remove the residual linear drift inside the baseline window on top of {@link baselineMode}
   * (CFX's "Baseline Drift Correction"). A no-op for `LinearBaseLineNormalized`, which already
   * subtracts the fitted line — it is the constant-subtraction and raw modes that keep a slope. */
  baselineDriftCorrection?: boolean;
  /** Which rule reports the Cq (`cqMethod.ts`). Default `"threshold"`, §6's crossing. */
  cqMethod?: CqMethod;
  /** A baseline window the source document declares for itself, used verbatim for every curve
   * instead of `baselineRegion`'s Cq-dependent search — see {@link Zpcr.declaredBaselineWindow}.
   * Omitted (the default) keeps this library's own measured heuristic. */
  baselineWindow?: BaselineRegion;
  /** How many cycles before its Cq a per-well baseline ends, when no `baselineWindow` is given.
   * Default {@link BASELINE_END_MARGIN} (2); the app passes 4, which is what reproduces CFX's own
   * split on `2026-11-09` at a fixed threshold (mean |ΔCq| 0.11 vs 0.45 at 2). */
  baselineEndMargin?: number;
}

/**
 * **The** Cq computation: baseline-correct every curve, resolve one threshold per group from that
 * group's own noise cohort (§5.1), and derive each curve's Cq (§6) — one entry per `key`.
 *
 * Two passes, because each stage needs the other's answer:
 *
 * 1. Correct every curve over the **whole run** and resolve each group's threshold from the noise
 *    that gives.
 * 2. Re-correct each curve with that threshold, so an amplifying well's baseline stops before its
 *    own Cq (`baselineCorrectCurve`), and re-resolve the thresholds from the improved noise. The
 *    reported Cq is taken against those.
 *
 * The second pass matters because a strongly amplifying well baselined over the whole run has a
 * wildly overstated noise, which drags its group's median — and hence every well's threshold.
 *
 * Callers are expected to build this over a run's *whole* plate, once, and read individual entries
 * out of it. A Cq is not a property of a curve alone: its group's threshold is the median baseline
 * noise over the curves handed in, so computing it again over a filtered subset (only the plotted
 * wells, only the enabled targets, …) yields a *different, equally defensible* Cq for the very same
 * well. Filter the returned table for display; never re-derive it from a subset.
 */
export function computeCqTable(
  curves: CqTableCurve[],
  options: CqTableOptions = {},
): Map<string, CqTableEntry> {
  const mode = options.baselineMode ?? ANALYSIS_BASELINE_MODE;
  const driftCorrection = options.baselineDriftCorrection ?? false;

  const unique: CqTableCurve[] = [];
  const seen = new Set<string>();
  for (const c of curves) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    unique.push(c);
  }

  /**
   * §5.1: one threshold per group, over that group's whole noise cohort. `applyOverrides` is
   * false when the result is only used to *place* baseline regions — see below.
   */
  const thresholdsFor = (
    baselines: CurveBaselineResult[],
    applyOverrides: boolean,
  ): Map<string, number> => {
    const cohort = new Map<string, number[]>();
    const all = new Map<string, number[]>();
    unique.forEach((c, i) => {
      const noise = baselines[i]!.noise;
      all.set(c.group, [...(all.get(c.group) ?? []), noise]);
      if (c.contributesToThreshold === false) return;
      cohort.set(c.group, [...(cohort.get(c.group) ?? []), noise]);
    });
    const out = new Map<string, number>();
    // Under the curvature rule the line comes from the curves' shapes, not their noise, so each
    // group also carries the steepest-rise value of every well in it. Wells excluded from the noise
    // cohort are excluded here too: a NTC that never rose would drag the median down.
    const shapes = new Map<string, number[]>();
    if (options.autoThreshold?.method === "curvature") {
      unique.forEach((c, i) => {
        if (c.contributesToThreshold === false) return;
        const estimate = curvatureEstimate(baselines[i]!.correctedValues);
        if (estimate === null) return;
        shapes.set(c.group, [...(shapes.get(c.group) ?? []), estimate.value]);
      });
    }
    for (const [group, everyone] of all) {
      out.set(
        group,
        resolveThreshold(cohort.get(group) ?? everyone, {
          overrideValue: applyOverrides ? options.thresholdOverrides?.get(group) : undefined,
          auto: {
            ...options.autoThreshold,
            curvatureEstimates: shapes.get(group),
          },
        }),
      );
    }
    return out;
  };

  // Pass 1: whole-run baselines, and the automatic thresholds they imply.
  const declaredWindow = options.baselineWindow ?? null;
  const endMargin = options.baselineEndMargin ?? BASELINE_END_MARGIN;
  const firstPass = unique.map((c) =>
    baselineCorrectCurve(c.cycles, c.values, mode, null, declaredWindow, driftCorrection, endMargin),
  );
  const placement = thresholdsFor(firstPass, false);

  // Pass 2: re-baseline against that threshold, then re-resolve from the improved noise.
  //
  // Regions are placed with the group's **automatic** threshold, never an override — of either
  // kind. Where a curve stops looking like a baseline is a property of the curve; where a user (or
  // a saved run) chose to draw the line is not, and letting an override move baselines would make
  // one well's edit change its plate-mates' noise, and through the group median their thresholds.
  const baselines = unique.map((c) =>
    baselineCorrectCurve(
      c.cycles,
      c.values,
      mode,
      placement.get(c.group) ?? 0,
      declaredWindow,
      driftCorrection,
      endMargin,
    ),
  );
  const thresholdByGroup = thresholdsFor(baselines, true);

  const table = new Map<string, CqTableEntry>();
  unique.forEach((c, i) => {
    const b = baselines[i]!;
    const curveOverride = options.curveThresholdOverrides?.get(c.key);
    const groupThreshold = thresholdByGroup.get(c.group) ?? 0;
    const threshold = curveOverride ?? groupThreshold;
    const thresholdSource =
      curveOverride !== undefined
        ? "curve"
        : options.thresholdOverrides?.get(c.group) !== undefined
          ? "group"
          : "auto";
    const thresholdCq = computeCq(c.cycles, b.correctedValues, threshold);
    const cq = refineCq(options.cqMethod, {
      cycles: c.cycles,
      values: c.values,
      corrected: b.correctedValues,
      baselineFit: b.baselineFit,
      baselineRegion: b.baselineRegion,
      noise: b.noise,
      threshold,
      thresholdCq,
    });
    // The plateau filter runs after the Cq, which it cannot change (`threshold.md` §A.7), and
    // feeds only the end-point RFU. It starts from the *threshold* Cq — that is the measured rule.
    const endRfu = endPointRfu(smoothPlateauTail(b.correctedValues, thresholdCq));
    table.set(c.key, {
      ...b,
      group: c.group,
      threshold,
      groupThreshold,
      thresholdSource,
      cq,
      thresholdCq,
      endRfu,
    });
  });
  return table;
}
