import type { AnalysisRow } from "@zpcrweb/core";

/** Row letter for a plate row index — `A` for 0, and so on past `H` for an unusual plate. */
const rowLetter = (r: number) => String.fromCharCode(65 + r);

/** One CSV field: quoted only when it would otherwise break the row apart. */
const field = (text: string) =>
  /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/**
 * The run's Cq values written out as the plate they were read on: a header row of column numbers,
 * then one row per plate row, starting with its letter. This is the shape a spreadsheet expects —
 * paste it in and it lands on an 8×12 grid without being rearranged — which is why the app draws
 * the same arrangement on screen (see `CqPlate`).
 *
 * A well with nothing to report is left blank rather than filled with a placeholder: a blank cell
 * is what "no Cq" means in a spreadsheet, and `N/A` would have to be stripped before any formula
 * could read the column. A well holding several targets is only ambiguous when the plate is
 * multiplex, so the export becomes one labelled block per target in that case, and stays a single
 * clean grid when it isn't.
 *
 * Numbers keep two decimals: enough to read a Cq, and the same precision the instrument's own
 * exports carry.
 */
export function cqPlateCsv(rows: AnalysisRow[]): string {
  let maxRow = 7;
  let maxCol = 11;
  const byTarget = new Map<string, Map<string, number | null>>();
  for (const r of rows) {
    maxRow = Math.max(maxRow, r.row);
    maxCol = Math.max(maxCol, r.col);
    let wells = byTarget.get(r.target);
    if (!wells) {
      wells = new Map();
      byTarget.set(r.target, wells);
    }
    // A well can carry more than one curve for a target on a multi-dye plate; the smallest Cq is
    // the one that crossed first, and the one a single cell can honestly hold.
    const key = `${r.row},${r.col}`;
    const previous = wells.get(key);
    if (previous == null || (r.cq != null && r.cq < previous)) wells.set(key, r.cq);
  }

  const targets = [...byTarget.keys()].sort((a, b) => a.localeCompare(b));
  const header = ["", ...Array.from({ length: maxCol + 1 }, (_, c) => String(c + 1))];

  const block = (wells: Map<string, number | null>) => {
    const lines = [header.join(",")];
    for (let r = 0; r <= maxRow; r++) {
      const cells: string[] = [rowLetter(r)];
      for (let c = 0; c <= maxCol; c++) {
        const cq = wells.get(`${r},${c}`);
        cells.push(cq == null ? "" : cq.toFixed(2));
      }
      lines.push(cells.join(","));
    }
    return lines;
  };

  if (targets.length <= 1) {
    const only = targets[0];
    const wells = only == null ? new Map<string, number | null>() : byTarget.get(only)!;
    return block(wells).join("\n") + "\n";
  }

  // A target that never crossed anywhere is a whole block of blanks; on a multiplex plate those
  // outnumber the useful ones and bury them, so only targets with at least one value get a block.
  const sections: string[] = [];
  for (const target of targets) {
    const wells = byTarget.get(target)!;
    const hasValue = [...wells.values()].some((cq) => cq != null);
    if (!hasValue) continue;
    sections.push(`Target,${field(target)}`);
    sections.push(...block(wells));
    sections.push("");
  }
  if (sections.length === 0) sections.push(...block(new Map()));
  return sections.join("\n").replace(/\n+$/, "\n");
}

/** `<run file> Cq plate.csv` beside the run it came from, so two exports never collide. */
export function cqPlateCsvFilename(dataFile: string): string {
  const base = dataFile.replace(/\.[^./\\]+$/, "") || "run";
  return `${base} Cq plate.csv`;
}
