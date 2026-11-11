/**
 * The live thermal chart: block temperature against elapsed run time, built from the status-poll
 * samples an active run is producing right now (`useLiveThermalHistory`) — contrast
 * `thermalChart.ts`, which plots a *finished* run's recorded profile from its `.alf` report.
 *
 * Deliberately simpler than that one: `STATUS?` reports a temperature and an elapsed second, not a
 * step or a phase, so there's no ramp/hold/read decomposition to draw — one line, and a tooltip
 * with just those two numbers.
 *
 * Where no poll arrived (a mid-run connect, a sleeping computer — `useLiveThermalHistory`'s gaps)
 * the line **breaks** rather than joining across, and the span is shaded: a straight line over
 * minutes of cycling the block never did is worse than saying nothing. When the run's report could
 * fill a gap, that stretch is a second, dashed series — the report's setpoints, not a measurement,
 * so it is drawn visibly different from the polls.
 */
import uPlot from "uplot";
import type { ThermalFillPoint, ThermalGap } from "@zpcrweb/core";
import { elapsedLabel, timeSplits } from "./thermalChart";
import type { LiveThermalSample } from "../../state/useLiveThermalHistory";

const TRACE_COLOR = "#22d3ee";
const FILL_COLOR = "rgba(34,211,238,0.6)";
const GAP_SHADE = "rgba(138,160,192,0.08)";

export interface LiveThermalTooltipData {
  atSeconds: number;
  temperatureC: number;
  /** `poll` for a `STATUS?` reading, `report` for a point filled in from the run's report. */
  source: "poll" | "report";
  left: number;
  top: number;
}

/**
 * x, the polls, and the report's fill — one aligned table, each series null where it has nothing.
 * Every gap gets a row with no poll in it even when nothing fills it, which is what breaks the
 * polled line there instead of letting uPlot join across.
 */
export function liveThermalData(
  samples: readonly LiveThermalSample[],
  gaps: readonly ThermalGap[],
  stretches: readonly (readonly ThermalFillPoint[])[],
): uPlot.AlignedData {
  const rows = new Map<number, { poll: number | null; fill: number | null }>();
  const row = (x: number) => {
    let r = rows.get(x);
    if (!r) rows.set(x, (r = { poll: null, fill: null }));
    return r;
  };
  for (const s of samples) row(s.atSeconds).poll = s.blockTempC;
  for (const g of gaps) row((g.fromS + g.toS) / 2);
  // A stretch's ends coincide with the polls either side of its gap, so they share those rows and
  // the dashed line meets the solid one.
  for (const stretch of stretches) for (const p of stretch) row(p.atSeconds).fill = p.tempC;
  const xs = [...rows.keys()].sort((a, b) => a - b);
  return [xs, xs.map((x) => rows.get(x)!.poll), xs.map((x) => rows.get(x)!.fill)] as uPlot.AlignedData;
}

/**
 * Where the x-axis ends when the run's length isn't known yet — long enough that the first minute
 * of a run doesn't draw a wildly-rescaling axis, short enough to be an honest placeholder.
 */
const FALLBACK_SPAN_S = 600;

export function buildLiveThermalChart(cfg: {
  width: number;
  height: number;
  /** The run's expected total length (`useLiveThermalHistory`), or null while it's unknown. */
  estimatedTotalS: number | null;
  /** Spans with no poll in them — shaded. */
  gaps: readonly ThermalGap[];
  onHover: (t: LiveThermalTooltipData | null) => void;
}): uPlot.Options {
  return {
    width: cfg.width,
    height: cfg.height,
    series: [
      { label: "t" },
      { label: "block", stroke: TRACE_COLOR, width: 2, points: { show: false } },
      { label: "report", stroke: FILL_COLOR, width: 1.5, dash: [5, 4], points: { show: false } },
    ],
    scales: {
      x: {
        time: false,
        /**
         * The whole run, from zero, rather than just the part of it that has happened — so the
         * trace advances across a still frame and its position reads as progress, instead of the
         * axis restretching every poll to keep the line filling the plot.
         *
         * `max` still wins if the run outlives its estimate: the estimate runs optimistic (see
         * `LiveThermalHistory.estimatedTotalS`), and a trace running off the right edge would be
         * worse than an axis that grows late in a long run.
         */
        range: (_u, _min, max) => [0, Math.max(cfg.estimatedTotalS ?? FALLBACK_SPAN_S, max)],
      },
      y: {
        range: (_u, min, max) => {
          const pad = Math.max(2, (max - min) * 0.15);
          return [min - pad, max + pad];
        },
      },
    },
    axes: [
      {
        stroke: "#8aa0c0",
        grid: { stroke: "rgba(120,200,255,0.06)", width: 1 },
        ticks: { stroke: "rgba(120,200,255,0.12)", width: 1 },
        splits: (u, _i, min, max) =>
          timeSplits(min, max, Math.max(3, Math.floor(u.bbox.width / devicePixelRatio / 90))),
        values: (_u, splits) => splits.map((v) => elapsedLabel(v, true)),
        font: "11px ui-monospace, monospace",
      },
      {
        stroke: "#8aa0c0",
        grid: { stroke: "rgba(120,200,255,0.06)", width: 1 },
        ticks: { stroke: "rgba(120,200,255,0.12)", width: 1 },
        values: (_u, splits) => splits.map((v) => `${v}`),
        font: "11px ui-monospace, monospace",
        size: 38,
      },
    ],
    cursor: { focus: { prox: 24 }, points: { show: true, size: 5, stroke: TRACE_COLOR, fill: TRACE_COLOR } },
    legend: { show: false },
    hooks: {
      drawClear: [
        (u: uPlot) => {
          const { top, height } = u.bbox;
          u.ctx.save();
          u.ctx.fillStyle = GAP_SHADE;
          for (const g of cfg.gaps) {
            const x0 = u.valToPos(g.fromS, "x", true);
            u.ctx.fillRect(x0, top, u.valToPos(g.toS, "x", true) - x0, height);
          }
          u.ctx.restore();
        },
      ],
      setCursor: [
        (u: uPlot) => {
          const idx = u.cursor.idx;
          const { left, top } = u.cursor;
          if (idx == null || left == null || top == null || left < 0) {
            cfg.onHover(null);
            return;
          }
          const x = u.data[0]?.[idx];
          const poll = u.data[1]?.[idx];
          const fill = u.data[2]?.[idx];
          if (x == null || (poll == null && fill == null)) {
            cfg.onHover(null);
            return;
          }
          cfg.onHover(
            poll != null
              ? { atSeconds: x, temperatureC: poll, source: "poll", left, top }
              : { atSeconds: x, temperatureC: fill!, source: "report", left, top },
          );
        },
      ],
    },
  };
}
