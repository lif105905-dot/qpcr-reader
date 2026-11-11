/**
 * The amplification chart as a picture: the same curves the screen draws, rendered off-screen for
 * a file rather than for a window.
 *
 * Same three transformations the melt figure makes, for the same reasons (see `meltFigure.ts`):
 * transparent background, dark print ink with type scaled to the canvas, and 300 dpi worth of
 * pixels for an 8-inch-wide figure. `buildChart` grows a `print` mode for this — see
 * `BuildChartConfig.print`.
 *
 * One thing is drawn here rather than inherited: **the threshold line and the Cq rings**. On
 * screen they live in an SVG overlay layer over the plot (uPlot's own plugin surface), which is
 * not part of the canvas that gets read back. Without this pass, a figure of a quantification run
 * would show the curves but not the crossing that gave each curve its Cq — the one annotation the
 * plot exists to communicate. They are drawn from the same `CqMarker` positions and the same
 * `plotDelta` projection the overlay uses, so the file agrees with the screen pixel for pixel.
 */

import uPlot from "uplot";
import { safeFileBase } from "@zpcrweb/core";
import {
  buildChart,
  type BuildChartConfig,
  type SeriesMeta,
} from "../uplot/chart";

/** The figure's width in CSS pixels — the layout's unit, exactly as in `meltFigure.ts`. */
const FIGURE_CSS_WIDTH = 1200;

/** Height as a fraction of width: the amplification plot is wider than tall on screen too. */
const FIGURE_ASPECT = 0.62;

/** The physical width the file is written for; the 300 dpi tag follows from it. */
const FIGURE_INCHES = 8;

/** The on-screen width these chart sizes were tuned for (see `BuildChartConfig.print`). */
const REFERENCE_CSS_WIDTH = 800;

/** The dotted threshold rule, matching the overlay's `THRESHOLD_LINE_DASH` rhythm. */
const THRESHOLD_INK = "#1a1a1a";
const THRESHOLD_DASH = [3, 4];

export interface CurveFigureInput extends Omit<
  BuildChartConfig,
  "width" | "height" | "onHover" | "print" | "bands"
> {
  /** Baseline-subtracted value to rule across the plot, or `null` for no line. The caller passes
   * the same value the screen is showing (`standingThresholdValue`), so the file and the window
   * cannot disagree about where the threshold sits. */
  thresholdLine: number | null;
  /** Draw the Cq rings. Off for an overlaid log view where they'd clutter, which is also the only
   * case the screen hides them in. */
  drawCqRings?: boolean;
}

export interface CurveFigure {
  canvas: HTMLCanvasElement;
  dpi: number;
}

/** `<run name>_amplification.tif` — the Cq CSV's sibling, so the pair sit together. */
export function curveImageFilename(dataFile: string): string {
  const runName = safeFileBase(dataFile.replace(/\.(zpcr|pcrd)$/i, "")) || "run";
  return `${runName}_amplification.tif`;
}

/**
 * Render the amplification chart to a canvas — transparent background, print ink, 300 dpi — ready
 * for `encodeTiff` in `./tiff.ts`.
 */
export async function renderCurveFigure(input: CurveFigureInput): Promise<CurveFigure> {
  if (input.wellCurves.length === 0) throw new Error("renderCurveFigure: no curves to draw");

  const width = FIGURE_CSS_WIDTH;
  const height = Math.round(width * FIGURE_ASPECT);
  const scale = width / REFERENCE_CSS_WIDTH;

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;background:transparent;`;
  document.body.append(host);

  try {
    const built = buildChart({
      ...input,
      bands: false,
      width,
      height,
      onHover: () => {},
      print: { scale },
    });

    let markReady: (u: uPlot) => void = () => {};
    const whenReady = new Promise<uPlot>((resolve) => {
      markReady = resolve;
    });
    built.options.hooks = { ready: [markReady] };

    const plot = new uPlot(built.options, built.data, host);
    try {
      await whenReady;
      drawAnnotations(plot, built.meta, built.cqMarkers, input.thresholdLine, input.drawCqRings !== false, scale);

      const source = plot.ctx.canvas;
      const canvas = document.createElement("canvas");
      canvas.width = source.width;
      canvas.height = source.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("renderCurveFigure: no 2d context");
      ctx.drawImage(source, 0, 0);

      return { canvas, dpi: Math.round(canvas.width / FIGURE_INCHES) };
    } finally {
      plot.destroy();
    }
  } finally {
    host.remove();
  }
}

/** The threshold rule and the Cq rings, in the plot's own pixel space. */
function drawAnnotations(
  plot: uPlot,
  meta: SeriesMeta[],
  markers: { x: number; y: number; color: string }[],
  threshold: number | null,
  drawRings: boolean,
  scale: number,
): void {
  const ctx = plot.ctx;
  const ratio = ctx.canvas.width / plot.width;
  // Draw in CSS pixels: the canvas is already scaled by the device ratio, so doing the strokes in
  // the plot's own units keeps a 1 px rule 1 px on every screen.
  ctx.save();
  ctx.scale(ratio, ratio);

  if (threshold != null) {
    // Every curve shares one `plotDelta` in the "Relative" view; the first well's is that value,
    // and using it reproduces the overlay's own row arithmetic (see `chart.ts`'s threshold pass).
    const delta = meta.find((m) => m.kind === "well" && m.plotDelta)?.plotDelta?.[0] ?? 0;
    const y = plot.valToPos(threshold + delta, "y");
    if (Number.isFinite(y)) {
      const left = plot.valToPos(plot.scales.x!.min!, "x");
      const right = plot.valToPos(plot.scales.x!.max!, "x");
      ctx.save();
      ctx.strokeStyle = THRESHOLD_INK;
      ctx.lineWidth = 1.4;
      ctx.setLineDash(THRESHOLD_DASH.map((n) => n * Math.max(1, scale * 0.8)));
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (drawRings) {
    for (const m of markers) {
      const x = plot.valToPos(m.x, "x");
      const y = plot.valToPos(m.y, "y");
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      ctx.beginPath();
      ctx.arc(x, y, 4.5 * Math.max(1, scale * 0.8), 0, Math.PI * 2);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  ctx.restore();
}
