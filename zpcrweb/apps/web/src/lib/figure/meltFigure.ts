/**
 * The melt chart as a picture: the same curves the screen draws, rendered off-screen for a file
 * rather than for a window.
 *
 * What "for a file" changes, and why each one is not optional:
 *
 * - **Transparent background.** The app's chart sits on a dark panel; a figure pasted onto a white
 *   page cannot carry that panel with it. uPlot leaves the canvas transparent unless it is given a
 *   background, so drawing into a host with no CSS background is all it takes.
 * - **Dark ink.** The screen's axes are #8aa0c0, chosen to glow on the dark panel. On white paper
 *   they are close to invisible, so print mode inks the frame in near-black (see
 *   `BuildMeltChartConfig.print`).
 * - **300 dpi worth of pixels.** The layout is the same — same axis sizes, same margins — drawn
 *   into a canvas `devicePixelRatio` times larger than the CSS size, which is exactly how uPlot
 *   already scales itself for a retina screen. A 2400 px canvas written with a 300 dpi tag is an
 *   8-inch-wide figure.
 * - **The Tm labels.** On screen they live in an SVG layer over the plot, which is not part of the
 *   canvas read back, so they are drawn here instead — from the same `MeltSeriesMeta` and the same
 *   interpolation, so the dot lands on the peak exactly as the on-screen label does.
 *
 * Nothing else is different: the same series, the same colours, the same highlighted/visible set
 * the caller passes, so the file says what the screen said.
 */

import uPlot from "uplot";
import { safeFileBase } from "@zpcrweb/core";
import {
  buildMeltChart,
  MAX_TM_MARKERS,
  valueAtTemperature,
  type MeltSeriesMeta,
  type MeltPlotCurve,
} from "../uplot/meltChart";
import type { MeltView } from "../../state/useZpcrStore";

/** The figure's width in CSS pixels. This — not the device pixels it becomes — is what the
 * layout is computed in: uPlot sizes axes and picks tick intervals in CSS pixels, so a fixed
 * width is what makes the export look the same on a retina screen (2400 px wide) and a 1× one
 * (1200 px wide). Only the resolution differs between them. */
const FIGURE_CSS_WIDTH = 1200;

/** Height as a fraction of width. Close to the on-screen chart's shape, so the export is the
 * picture the user was looking at rather than a reflowed one. */
const FIGURE_ASPECT = 0.6;

/** The physical width the file is written for — a figure's width on a page. The 300 dpi tag
 * follows from it: a 2400 px canvas at 8 inches is 300 dpi, which is what a journal asks for. */
const FIGURE_INCHES = 8;

/** The width a chart is drawn at on screen, and what the type sizes in `meltChart.ts` are tuned
 * for. The export divides by it to grow the labels in proportion to the bigger canvas. */
const REFERENCE_CSS_WIDTH = 800;

/** The ink the exported labels are written in — the same near-black print mode asks the chart's
 * axes to use, so a Tm label does not look like a visitor from another figure. */
const PRINT_INK = "#1a1a1a";

export interface MeltFigureInput {
  /** The curves on screen — `MeltChart`'s own `curves` prop, so the file matches the plot. */
  curves: MeltPlotCurve[];
  /** The melt's temperature axis, shared by every curve of the step. */
  temperaturesC: number[];
  view: MeltView;
}

export interface MeltFigure {
  canvas: HTMLCanvasElement;
  /** Pixels per inch, for the file's resolution tags. The canvas is 8 inches wide by design. */
  dpi: number;
}

/** `<run name>_melt.tif` — the melt CSV's name with the image extension, so the pair sit together
 * in whatever folder they are saved to. The run name is the instrument's own data file name, the
 * same one `meltCsvFilename` uses. */
export function meltImageFilename(dataFile: string): string {
  const runName = safeFileBase(dataFile.replace(/\.(zpcr|pcrd)$/i, "")) || "run";
  return `${runName}_melt.tif`;
}

/** Where a Tm label goes: just above the peak it names, flipped inside the plot where the peak is
 * near the right edge, and stepped up a line at a time where it would collide with one already
 * placed. A replicate group's peaks can be a fraction of a degree and a few RFU apart. */
interface LabelBox {
  left: number;
  right: number;
  y: number;
}

/**
 * Draw the melting temperatures onto a rendered plot's canvas.
 *
 * Only when few enough curves are plotted to tell the labels apart — the same `MAX_TM_MARKERS`
 * limit the on-screen overlay applies, and for the same reason: a plate's worth of overlapping
 * "82.5 °C"s says less than none.
 */
function drawMeltingTemperatures(
  plot: uPlot,
  meta: MeltSeriesMeta[],
  temperaturesC: number[],
  ratio: number,
  scale: number,
): void {
  const called = meta.filter((m) => m.plot.curve.tmC != null);
  if (called.length === 0 || called.length > MAX_TM_MARKERS) return;

  const ctx = plot.ctx;
  const fontPx = Math.round(12 * scale * ratio);
  const lineH = Math.round(fontPx * 1.25);
  const dotR = 3.2 * scale * ratio;
  const gap = 5 * scale * ratio;
  const right = plot.bbox.left + plot.bbox.width;

  ctx.save();
  // The marks are placed in device pixels (`valToPos(..., true)`), which is the canvas's own
  // coordinate space — no scaling transform, whatever the last draw left behind.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${fontPx}px ui-monospace, monospace`;
  ctx.textBaseline = "alphabetic";

  const placed: LabelBox[] = [];
  for (const m of called) {
    const tm = m.plot.curve.tmC as number;
    const x = plot.valToPos(tm, "x", true);
    const peak = valueAtTemperature(temperaturesC, m.values, tm);
    if (!Number.isFinite(x) || peak == null) continue;
    const y = plot.valToPos(peak, "y", true);
    if (!Number.isFinite(y)) continue;

    // A ring around the peak: the dot marks the Tm without hiding the curve underneath, and its
    // colour is the curve's own so it still reads as that line's label.
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.3 * scale * ratio;
    ctx.strokeStyle = m.color;
    ctx.stroke();

    const text = `${tm.toFixed(1)} °C`;
    const flip = x > right - fontPx * 4.2;
    const textW = ctx.measureText(text).width;
    const left = flip ? x - gap - textW : x + gap;

    let labelY = y - gap;
    for (let attempt = 0; attempt < 6; attempt++) {
      const hit = placed.some(
        (b) => b.left < left + textW && left < b.right && Math.abs(b.y - labelY) < lineH,
      );
      if (!hit) break;
      labelY -= lineH;
    }
    placed.push({ left, right: left + textW, y: labelY });

    ctx.fillStyle = PRINT_INK;
    ctx.textAlign = "left";
    ctx.fillText(text, left, labelY);
  }
  ctx.restore();
}

/**
 * Render the melt chart to a canvas — transparent background, print ink, 300 dpi — ready for
 * {@link encodeTiff} in `./tiff.ts`.
 *
 * The plot is built into a detached host so none of this touches the layout of the page the user
 * is looking at, and destroyed once its pixels have been copied out.
 */
export async function renderMeltFigure(input: MeltFigureInput): Promise<MeltFigure> {
  if (input.curves.length === 0) throw new Error("renderMeltFigure: no curves to draw");

  const width = FIGURE_CSS_WIDTH;
  const height = Math.round(width * FIGURE_ASPECT);
  const scale = width / REFERENCE_CSS_WIDTH;

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;background:transparent;`;
  document.body.append(host);

  try {
    const built = buildMeltChart({
      curves: input.curves,
      temperaturesC: input.temperaturesC,
      view: input.view,
      width,
      height,
      onHover: () => {},
      print: { scale },
    });

    // `ready` fires once the first draw has completed. The constructor draws synchronously, so
    // this resolves on the same tick in practice — but waiting on the hook is what guarantees the
    // canvas holds pixels, rather than the timing happening to be right.
    let markReady: (u: uPlot) => void = () => {};
    const whenReady = new Promise<uPlot>((resolve) => {
      markReady = resolve;
    });
    built.options.hooks = { ready: [markReady] };

    const plot = new uPlot(built.options, built.data, host);
    try {
      await whenReady;
      // The canvas the plot drew into may be 2× the CSS size (retina) or 1× — read the ratio off
      // it rather than trusting `devicePixelRatio` to be the same number uPlot used.
      const ratio = plot.ctx.canvas.width / width;
      drawMeltingTemperatures(plot, built.meta, input.temperaturesC, ratio, scale);

      // Copied out before the plot is destroyed: `destroy()` drops the canvas along with the
      // rest of its DOM, and a detached canvas is a worse thing to hand back than a fresh one.
      const source = plot.ctx.canvas;
      const canvas = document.createElement("canvas");
      canvas.width = source.width;
      canvas.height = source.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("renderMeltFigure: no 2d context");
      ctx.drawImage(source, 0, 0);

      return { canvas, dpi: Math.round(canvas.width / FIGURE_INCHES) };
    } finally {
      plot.destroy();
    }
  } finally {
    host.remove();
  }
}
