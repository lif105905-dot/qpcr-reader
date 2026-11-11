/**
 * Cq *methods* — which rule turns a well's analysed curve into its reported Cq (`threshold.md` §11).
 *
 * `"threshold"` is §6's crossing rule, measured exactly against CFX's own output, and the default.
 * Every other method is a **refinement of it**: it is handed the curve together with the
 * threshold Cq the plate's analysis already found, and may move that Cq *earlier*, towards where
 * the curve visibly leaves its baseline. {@link refineCq} enforces the contract, so no method can
 * break it:
 *
 * - **No threshold Cq ⇒ no Cq.** A method never creates a call the threshold rule didn't make,
 *   so switching methods can never add a positive.
 * - **Never later than the threshold Cq, never before the analysed range** (cycle
 *   {@link BASELINE_BEGIN_CYCLE}). A result outside that, or not finite, falls back to the
 *   threshold Cq.
 * - **Nothing upstream moves.** Baseline regions, noise and thresholds are all placed with the
 *   threshold Cq (`computeCqTable`), so a method changes the reported number and nothing else —
 *   the threshold section, the baseline overlay and every other well's Cq are untouched.
 */

import { BASELINE_BEGIN_CYCLE, type BaselineRegion, type LinearBaselineFit } from "./baseline.js";
import { logKnee } from "./cqMethods/logKnee.js";
import { logTakeoff } from "./cqMethods/logTakeoff.js";
import { sigmoidFit } from "./cqMethods/sigmoidFit.js";

/** Everything a refinement may look at, for one curve. Arrays are indexed alike, one per read. */
export interface CqRefineInput {
  cycles: number[];
  /** The curve as analysed, before baseline subtraction (dye-space RFU, background included). */
  values: number[];
  /** `values` minus the fitted baseline — what the threshold Cq was read from. */
  corrected: number[];
  baselineFit: LinearBaselineFit;
  baselineRegion: BaselineRegion;
  /** §5.1's per-curve noise σ over the baseline region. */
  noise: number;
  /** The threshold the Cq was taken against. */
  threshold: number;
  /** §6's Cq for this curve — always non-null here. */
  thresholdCq: number;
}

/** A refinement: returns a Cq, or `null` to keep the threshold Cq. */
export type CqRefiner = (input: CqRefineInput) => number | null;

export interface CqMethodInfo {
  id: string;
  /** Short name for a menu. */
  label: string;
  /** One sentence for a tooltip — what the method reports, in a user's terms. */
  description: string;
  /** `null` for `"threshold"`, which is the crossing itself. */
  refine: CqRefiner | null;
}

/** The registry. Order is menu order; the first entry is the default. */
export const CQ_METHODS: readonly CqMethodInfo[] = [
  {
    id: "threshold",
    label: "Single threshold",
    description:
      "Cq is where the baseline-corrected curve crosses its threshold — CFX Maestro's default " +
      "“Single Threshold” mode.",
    refine: null,
  },
  {
    id: "logTakeoff",
    label: "Log takeoff",
    description:
      "Follows the curve's early exponential rise back to where it takes off from the baseline — " +
      "typically about 1.3 cycles before the threshold crossing, at most 3, with replicates as " +
      "tight as the threshold gives.",
    refine: (i) => logTakeoff(i),
  },
  {
    id: "logKnee",
    label: "Log-space knee",
    description:
      "Moves the Cq back to the corner where the curve bends up off its floor on a log axis — " +
      "typically about 1.8 cycles earlier, at most 3. The earliest of the methods, and slightly " +
      "noisier between replicates.",
    refine: (i) => logKnee(i),
  },
  {
    id: "sigmoidFit",
    label: "Curve fit",
    description:
      "Fits a smooth amplification curve to each well and reports where the fitted signal takes " +
      "off — about a cycle earlier, and left at the threshold crossing when the fit is poor. " +
      "Similar in spirit to CFX Maestro's “Regression” mode.",
    refine: (i) => sigmoidFit(i),
  },
];

export type CqMethod = string;

export const DEFAULT_CQ_METHOD: CqMethod = "threshold";

export function cqMethodInfo(id: CqMethod | undefined): CqMethodInfo {
  return CQ_METHODS.find((m) => m.id === id) ?? CQ_METHODS[0]!;
}

export function isCqMethod(id: unknown): id is CqMethod {
  return typeof id === "string" && CQ_METHODS.some((m) => m.id === id);
}

/**
 * The reported Cq for one curve under `method`, enforcing the contract in this module's header.
 * `input.thresholdCq` may be `null` here (no call), in which case the answer is `null` whatever
 * the method.
 */
export function refineCq(
  method: CqMethod | undefined,
  input: Omit<CqRefineInput, "thresholdCq"> & { thresholdCq: number | null },
): number | null {
  return applyRefiner(cqMethodInfo(method).refine, input);
}

/** {@link refineCq} for a refiner that isn't (yet) in the registry — what an evaluation script
 * scores a candidate with, so it is held to exactly the contract a shipped method is. */
export function applyRefiner(
  refine: CqRefiner | null,
  input: Omit<CqRefineInput, "thresholdCq"> & { thresholdCq: number | null },
): number | null {
  const { thresholdCq } = input;
  if (thresholdCq == null) return null;
  if (!refine) return thresholdCq;
  let cq: number | null;
  try {
    cq = refine({ ...input, thresholdCq });
  } catch {
    return thresholdCq;
  }
  if (cq == null || !Number.isFinite(cq)) return thresholdCq;
  if (cq > thresholdCq) return thresholdCq;
  if (cq < BASELINE_BEGIN_CYCLE) return thresholdCq;
  return cq;
}
