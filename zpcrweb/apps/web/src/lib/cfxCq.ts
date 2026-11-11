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
