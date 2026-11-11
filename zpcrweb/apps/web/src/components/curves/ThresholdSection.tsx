import { useEffect, useRef, useState } from "react";
import { CQ_METHODS, DEFAULT_CQ_METHOD, cqMethodInfo, type CqMethod } from "@zpcrweb/core";
import { CFX_THRESHOLD_MULTIPLIER } from "../../state/analysisSettings";
import type { AutoThresholdMethod } from "@zpcrweb/core";
import { ResetIcon } from "../ResetIcon";

/** One curve — a single well/fluorophore pair — under its fluorophore in the threshold list. */
export interface ThresholdCurveRow {
  /** `curveKey(row, col, fluor)`: the key a per-curve override is filed under. */
  key: string;
  wellLabel: string;
  /** The cycle range this curve's own baseline-region auto-detection settled on (`threshold.md`
   * §3) — per-curve, so two wells of one dye routinely differ. */
  beginCycle: number;
  endCycle: number;
  /** §5.1's median-absolute-second-difference noise estimate: this curve's contribution to the
   * group median. */
  noise: number;
  /** The whole corrected curve sits above this curve's threshold, so no crossing exists — see
   * `threshold.md` §6. */
  aboveThreshold: boolean;
  /** The threshold this curve's Cq was actually taken against. */
  threshold: number;
  /** Its own override, when it has one — what makes it differ from the group's threshold. */
  override: number | undefined;
}

/** One fluorophore's threshold row, plus the curves it was derived from. */
export interface ThresholdGroupRow {
  fluor: string;
  /** The optical channel this dye is read on — what a hover highlights in channel space, where
   * there is no dye-space curve to isolate. */
  channel: number | undefined;
  /** The group's threshold: its override, or §5.1's auto value. Independent of any per-curve
   * override, which replaces the number a single curve uses without moving the group. */
  threshold: number | undefined;
  override: number | undefined;
  curves: ThresholdCurveRow[];
}

interface Props {
  groups: ThresholdGroupRow[];
  /** Which rule places each fluorophore's automatic threshold — see `DEFAULT_AUTO_THRESHOLD_METHOD`. */
  autoThresholdMethod: AutoThresholdMethod;
  onAutoThresholdMethodChange: (value: AutoThresholdMethod) => void;
  multiplier: number;
  onMultiplierChange: (value: number) => void;
  /** Which rule reports each Cq (`cqMethod.ts`). Every rule but the default starts from the
   * threshold crossing and may only move it earlier, so the thresholds below still decide which
   * wells have a Cq at all. */
  cqMethod: CqMethod;
  onCqMethodChange: (value: CqMethod) => void;
  /** `raw` empty clears the override, putting the fluorophore back on its auto threshold. */
  onGroupOverride: (fluor: string, raw: string) => void;
  /** `raw` empty clears the override, putting the curve back on its group's threshold. */
  onCurveOverride: (curveKey: string, raw: string) => void;
  /** Hovering a fluorophore's row: isolate its curves and mark its threshold. `null` on leave. */
  onHoverGroup: (group: ThresholdGroupRow | null) => void;
  /** Hovering one curve's row: isolate that curve and mark its threshold *and* its baseline
   * region/noise — the diagnostic only makes sense one curve at a time. */
  onHoverCurve: (group: ThresholdGroupRow, curve: ThresholdCurveRow) => void;
  /**
   * One curve to show: expand its fluorophore, scroll its row into view and mark it. Set while its
   * Cq marker is being dragged on the chart (see `CurvesView`'s `beginCqDrag`) — the drag is
   * editing this row's value, so the row it is editing has to be on screen. `null` the rest of the
   * time. The expansion is left behind afterwards, like any the user opened themselves.
   */
  revealCurve?: { fluor: string; key: string } | null;
}

/**
 * The Curves rail's Threshold section: §5.1's auto-threshold multiplier, then one row per
 * fluorophore — expandable to the individual curves behind it.
 *
 * Both levels are editable, and a per-curve override wins (see
 * `CqTableOptions.curveThresholdOverrides`). The nesting is the explanation: a fluorophore's
 * threshold is a median over exactly the curves listed under it, each with its own baseline region
 * and noise, so the row that looks wrong and the number to fix it are in the same place. An
 * overridden field is tinted, so a manual value never reads as something the run computed.
 *
 * This replaced a hover card that listed every contributing well: the same information, but
 * transient, read-only, and long enough to run off the screen on a full plate.
 */
export function ThresholdSection({
  groups,
  autoThresholdMethod,
  onAutoThresholdMethodChange,
  multiplier,
  onMultiplierChange,
  cqMethod,
  onCqMethodChange,
  onGroupOverride,
  onCurveOverride,
  onHoverGroup,
  onHoverCurve,
  revealCurve = null,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (fluor: string) => {
    const next = new Set(expanded);
    next.has(fluor) ? next.delete(fluor) : next.add(fluor);
    setExpanded(next);
  };

  // Revealing a curve is two steps that can't happen in one pass: expanding its fluorophore is a
  // state change, and its row only exists to be scrolled to once that render has landed. Hence two
  // effects, the second re-running on `expanded`.
  const revealFluor = revealCurve?.fluor;
  const revealKey = revealCurve?.key;
  const revealRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (revealFluor == null) return;
    setExpanded((prev) => (prev.has(revealFluor) ? prev : new Set(prev).add(revealFluor)));
  }, [revealFluor]);
  useEffect(() => {
    if (revealKey == null) return;
    // `nearest`: scroll the rail (and only as far as it takes) rather than yanking the row to the
    // middle of it — the pointer is mid-drag over the chart, and a rail that jumps under a drag
    // reads as the app losing its place.
    revealRef.current?.scrollIntoView({ block: "nearest" });
  }, [revealKey, expanded]);

  const method = cqMethodInfo(cqMethod);

  return (
    <>
      {/* The Cq method sits above the threshold controls because it is downstream of them: the
          threshold decides *whether* a well has a Cq, the method only *where* it is reported
          (`threshold.md` §11). */}
      <div className="threshold-k">
        <label className="threshold-k__head">
          <span>Cq method</span>
          <select
            className="threshold-method"
            value={method.id}
            onChange={(e) => onCqMethodChange(e.currentTarget.value)}
          >
            {CQ_METHODS.map((m) => (
              <option key={m.id} value={m.id} title={m.description}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="threshold-k__foot">
          <span className="threshold-k__hint">{method.description}</span>
          <button
            type="button"
            className="rail__link"
            disabled={method.id === DEFAULT_CQ_METHOD}
            onClick={() => onCqMethodChange(DEFAULT_CQ_METHOD)}
          >
            重置
          </button>
        </div>
      </div>

      {/* Which rule places the line. CFX reads it off the curve's steepest rise; this library
          shipped a multiple of the baseline noise. Both are offered because neither always wins:
          the curvature rule reproduces CFX to 0.08 cycles on a plate that plateaus, and the
          multiplier is the only option on one that never does (see `AutoThresholdMethod`). */}
      <div className="threshold-k">
        <label className="threshold-k__head">
          <span>自动阈值方式</span>
          <select
            className="threshold-method"
            value={autoThresholdMethod}
            onChange={(e) => onAutoThresholdMethodChange(e.currentTarget.value as AutoThresholdMethod)}
          >
            <option value="curvature">曲率（与 CFX 一致）</option>
            <option value="noise">噪声倍数</option>
          </select>
        </label>
        <div className="threshold-k__foot">
          <span className="threshold-k__hint">
            {autoThresholdMethod === "curvature"
              ? "取曲线拐点处的荧光值，和 CFX 软件等同"
              : "阈值 = 倍数 × 基线噪声中位数"}
          </span>
        </div>
      </div>

      {/* §5.1's `k` in `threshold = k × median baseline noise`. Adjustable because the calibrated
          default rests on two anchors from a single run (see `AutoThresholdOptions.multiplier`),
          and because it is the one number that moves every Cq on the plate — the per-group
          thresholds below update live as it moves, so its effect is visible rather than inferred.
          Overridden groups and curves ignore it; the curvature rule doesn't use it at all, so the
          slider is absent while that rule is selected. */}
      {autoThresholdMethod === "noise" && (
      <div className="threshold-k">
        <div className="threshold-k__head">
          <span>Auto threshold</span>
          <span className="threshold-k__value mono">{multiplier}× noise</span>
        </div>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={multiplier}
          aria-label="Auto-threshold multiplier, in multiples of median baseline noise"
          onChange={(e) => onMultiplierChange(Number(e.currentTarget.value))}
        />
        <div className="threshold-k__foot">
          <span className="threshold-k__hint mono">默认 {CFX_THRESHOLD_MULTIPLIER}×</span>
          <button
            type="button"
            className="rail__link"
            disabled={multiplier === CFX_THRESHOLD_MULTIPLIER}
            onClick={() => onMultiplierChange(CFX_THRESHOLD_MULTIPLIER)}
          >
            重置
          </button>
        </div>
      </div>
      )}

      <p className="rail__hint">
        在图上直接拖动那条虚线也能改阈值——和原版一样，松手后 Cq 立刻重算。
      </p>

      {/* Keyed by fluorophore, not target: a threshold is derived from baseline noise, which is a
          property of the dye and the optics rather than of the biological label on the well — see
          `RunAnalysis.thresholdGroupOf`. */}
      <div className="analysis__thresholds">
        {groups.map((g) => {
          const isOpen = expanded.has(g.fluor);
          const isAuto = g.override === undefined;
          // The field always carries a value — the live auto threshold when there's no override —
          // rather than sitting empty behind a placeholder. An empty number input steps from 0, so
          // one press of the down arrow used to jump the threshold from (say) 210 to
          // nothing-or-zero; seeded this way the arrows nudge from where the threshold actually is.
          // Whole RFU only: a threshold is a level on a curve running to thousands, and sub-unit
          // steps are below anything the reading means.
          const shown = isAuto ? (g.threshold != null ? Math.round(g.threshold) : "") : g.override;
          return (
            <div key={g.fluor} className="analysis__threshold-group">
              <div
                className="analysis__threshold-row mono"
                onMouseEnter={() => onHoverGroup(g)}
                onMouseLeave={() => onHoverGroup(null)}
              >
                <button
                  type="button"
                  className="analysis__threshold-chevron"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Hide" : "Show"} the curves behind ${g.fluor}'s threshold`}
                  title={`${isOpen ? "Hide" : "Show"} the ${g.curves.length} curves behind this threshold`}
                  disabled={g.curves.length === 0}
                  onClick={() => toggle(g.fluor)}
                >
                  <span className={"rail__chevron" + (isOpen ? " is-open" : "")} aria-hidden="true">
                    ▸
                  </span>
                </button>
                <span>{g.fluor}</span>
                <input
                  type="number"
                  step={1}
                  value={shown}
                  className={isAuto ? "is-auto" : "is-override"}
                  aria-label={`${g.fluor} threshold in RFU`}
                  onChange={(e) => onGroupOverride(g.fluor, e.currentTarget.value)}
                />
                <button
                  type="button"
                  className="rail__link rail__icon-btn"
                  disabled={isAuto}
                  aria-label={`Reset ${g.fluor} to its automatic threshold`}
                  title={`Reset ${g.fluor} to its automatic threshold`}
                  onClick={() => onGroupOverride(g.fluor, "")}
                >
                  <ResetIcon />
                </button>
              </div>
              {isOpen &&
                g.curves.map((c) => {
                  const curveAuto = c.override === undefined;
                  const curveShown = curveAuto ? Math.round(c.threshold) : c.override;
                  const isRevealed = c.key === revealKey;
                  return (
                    <div
                      key={c.key}
                      ref={isRevealed ? revealRef : undefined}
                      className={
                        "analysis__threshold-row analysis__threshold-row--curve mono" +
                        (isRevealed ? " is-revealed" : "")
                      }
                      onMouseEnter={() => onHoverCurve(g, c)}
                      onMouseLeave={() => onHoverGroup(null)}
                    >
                      <span className="analysis__threshold-well">{c.wellLabel}</span>
                      {/* The two numbers a threshold is actually made of, per curve: the cycles its
                          baseline was fitted over, and the noise that came out of them. */}
                      <span
                        className="analysis__threshold-region"
                        title={
                          c.aboveThreshold
                            ? "Baseline region (cycles) — the whole corrected curve sits above this threshold, so it never crosses"
                            : "Baseline region (cycles)"
                        }
                      >
                        {c.beginCycle}&ndash;{c.endCycle}
                        {c.aboveThreshold ? " ⚠" : ""}
                      </span>
                      <span className="analysis__threshold-noise" title="Baseline noise (σ)">
                        σ{c.noise.toFixed(1)}
                      </span>
                      <input
                        type="number"
                        step={1}
                        value={curveShown}
                        className={curveAuto ? "is-auto" : "is-override"}
                        aria-label={`${g.fluor} threshold in RFU for well ${c.wellLabel}`}
                        onChange={(e) => onCurveOverride(c.key, e.currentTarget.value)}
                      />
                      <button
                        type="button"
                        className="rail__link rail__icon-btn"
                        disabled={curveAuto}
                        aria-label={`Reset well ${c.wellLabel} to ${g.fluor}'s threshold`}
                        title={`Reset well ${c.wellLabel} to ${g.fluor}'s threshold`}
                        onClick={() => onCurveOverride(c.key, "")}
                      >
                        <ResetIcon />
                      </button>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </>
  );
}
