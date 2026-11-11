/**
 * Reading CFX Manager's own Cq export, so the app can put the instrument's numbers beside its own.
 *
 * The export this accepts is `Export → Quantification Cq Results` saved as CSV (or the plate view's
 * copy, which has the same two columns that matter). Only two columns are used — `Well` and `Cq` —
 * because that is all the comparison needs: the app already knows each well's target, and the point
 * of importing is to look at Bio-Rad's number, not to re-read the plate map from a spreadsheet.
 *
 * Kept free of any dependency on the core library: a `Record<string, number>` keyed by well label
 * (`"A1"`) is enough for the table, and it survives being stored in the file's settings as JSON.
 */

/** Split one CSV line, honouring double quotes and the doubled quotes that escape them. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** `"A1"`, `"a1 "`, `"Well A1"` → `"A1"`. Returns null for anything that is not a well position. */
export function normaliseWellLabel(raw: string): string | null {
  const m = /([A-Pa-p])\s*([0-9]{1,2})/.exec(raw.trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()}${Number(m[2])}`;
}

/**
 * Parse a CFX Cq CSV into well label → Cq.
 *
 * The header row is found rather than assumed: CFX puts a title line above it in some exports, and
 * a file whose first line is not the header is common enough to be worth handling. Rows without a
 * well or without a finite Cq are skipped — blanks in that column mean the instrument reported no
 * Cq for that well, which is exactly what the app already shows as `—`.
 */
export function parseCfxCqCsv(text: string): Record<string, number> {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  let header: string[] | null = null;
  let wellCol = -1;
  let cqCol = -1;

  for (const line of lines) {
    const cells = splitCsvLine(line).map((c) => c.trim().toLowerCase());
    const w = cells.indexOf("well");
    const c = cells.findIndex((x) => x === "cq" || x === "ct");
    if (w >= 0 && c >= 0) {
      header = cells;
      wellCol = w;
      cqCol = c;
      break;
    }
  }
  if (!header) return {};

  const start = lines.findIndex((l) => {
    const cells = splitCsvLine(l).map((c) => c.trim().toLowerCase());
    return cells[wellCol] === "well" || (cells.indexOf("well") >= 0 && cells.indexOf("cq") >= 0);
  });

  const out: Record<string, number> = {};
  for (let i = start + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const well = normaliseWellLabel(cells[wellCol] ?? "");
    if (!well) continue;
    const value = Number((cells[cqCol] ?? "").replace(/[^0-9.eE+-]/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    // A well can appear once per fluorophore; the app compares an imported Cq against the well's
    // own number, so the first finite one wins rather than being overwritten.
    if (out[well] == null) out[well] = value;
  }
  return out;
}

/** CFX's "Quantification Amplification Results_<dye>.csv": an empty leading column, then
 * `Cycle`, then one column per well. Unlike the Cq results this is the *baseline-corrected*
 * curve the software analysed, which makes it the best reference we can get without its code. */
export interface CfxAmplification {
  /** Cycle numbers, in file order. */
  cycles: number[];
  /** Well label → corrected RFU at each cycle, same order as `cycles`. */
  curves: Record<string, number[]>;
}

/** A CFX amplification sheet, or null when the text is not one. */
export function parseCfxAmplificationCsv(text: string): CfxAmplification | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 3) return null;

  const header = splitCsvLine(lines[0]!).map((c) => c.trim());
  const cycleCol = header.findIndex((c) => c.toLowerCase() === "cycle");
  if (cycleCol < 0) return null;

  const wellCols: { well: string; col: number }[] = [];
  header.forEach((cell, col) => {
    const well = normaliseWellLabel(cell);
    if (well) wellCols.push({ well, col });
  });
  if (wellCols.length === 0) return null;

  const cycles: number[] = [];
  const curves: Record<string, number[]> = {};
  for (const { well } of wellCols) curves[well] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const cycle = Number(cells[cycleCol] ?? "");
    if (!Number.isFinite(cycle)) continue;
    cycles.push(cycle);
    for (const { well, col } of wellCols) {
      const value = Number(cells[col] ?? "");
      curves[well]!.push(Number.isFinite(value) ? value : NaN);
    }
  }
  return cycles.length > 0 ? { cycles, curves } : null;
}

/**
 * The one threshold a plate was analysed with, recovered from the exported curves and the Cq
 * values: where a well's curve passes through its own Cq, that height *is* the threshold. CFX
 * uses a single value for the whole plate, so the median of those heights is it — and taking the
 * median rather than a mean keeps a mis-paired well from dragging the answer.
 */
export function thresholdFromCfxCurves(
  amp: CfxAmplification,
  cq: Record<string, number>,
): number | null {
  const heights: number[] = [];
  for (const [well, values] of Object.entries(amp.curves)) {
    const target = cq[well];
    if (target == null) continue;
    // Interpolate the curve at the (fractional) Cq cycle.
    let hit: number | null = null;
    for (let i = 1; i < amp.cycles.length; i++) {
      const x0 = amp.cycles[i - 1]!;
      const x1 = amp.cycles[i]!;
      if (!(x1 >= target && x0 <= target)) continue;
      const y0 = values[i - 1]!;
      const y1 = values[i]!;
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
      hit = x1 === x0 ? y1 : y0 + ((y1 - y0) * (target - x0)) / (x1 - x0);
      break;
    }
    if (hit != null && Number.isFinite(hit)) heights.push(hit);
  }
  if (heights.length === 0) return null;
  heights.sort((a, b) => a - b);
  const mid = heights.length >> 1;
  return heights.length % 2 === 1 ? heights[mid]! : (heights[mid - 1]! + heights[mid]!) / 2;
}
