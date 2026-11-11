import { useMemo } from "react";
import { formatCq, type AnalysisRow } from "@zpcrweb/core";
import { channelColor } from "../../lib/channelColors";

interface Props {
  /** The same rows the rail's chips filtered — one per (target, well) pair, already narrowed to
   * what is on screen. */
  rows: AnalysisRow[];
  /** Clicking a well isolates it, exactly as the Well column of the detail table does. */
  onPickWell: (row: number, col: number) => void;
}

/** Row letter for a plate row index — `A` for 0, and so on past `H` for an unusual plate. */
const rowLetter = (r: number) => String.fromCharCode(65 + r);

/**
 * The run's Cq values laid out as the plate they were read on — the arrangement the instrument's
 * own software calls *Quantification Data*, and the one people copy into a spreadsheet.
 *
 * Why this exists next to the detail table: the table answers "what did this curve measure", and
 * sorts by target or Cq to answer questions across wells. This answers "what is in row B", which
 * is what you need while checking a plate against the pipetting sheet — and it is the only
 * arrangement whose shape survives a copy-paste into Excel unchanged.
 *
 * A well can hold more than one target (a multiplex plate, or several dyes on one well), so a
 * cell lists every value it has, one per line, each in its optical channel's colour so the cell
 * still reads as "these came from different places". Wells with no value are drawn empty rather
 * than omitted: the grid's whole point is that every position is present, including the ones that
 * did not amplify.
 */
export function CqPlate({ rows, onPickWell }: Props) {
  const { byWell, rowCount, colCount } = useMemo(() => {
    const byWell = new Map<string, AnalysisRow[]>();
    let maxRow = 7;
    let maxCol = 11;
    for (const r of rows) {
      maxRow = Math.max(maxRow, r.row);
      maxCol = Math.max(maxCol, r.col);
      const key = `${r.row},${r.col}`;
      const list = byWell.get(key);
      if (list) list.push(r);
      else byWell.set(key, [r]);
    }
    // One target per line, in a stable order, so a cell doesn't reshuffle between renders.
    for (const list of byWell.values()) list.sort((a, b) => a.target.localeCompare(b.target));
    return { byWell, rowCount: maxRow + 1, colCount: maxCol + 1 };
  }, [rows]);

  return (
    <div className="cqplate-wrap">
      <table className="cqplate">
        <thead>
          <tr>
            <th className="cqplate__corner mono">Cq</th>
            {Array.from({ length: colCount }, (_, c) => (
              <th key={c} className="cqplate__head mono">
                {c + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }, (_, r) => (
            <tr key={r}>
              <th className="cqplate__head cqplate__head--row mono">{rowLetter(r)}</th>
              {Array.from({ length: colCount }, (_, c) => {
                const cell = byWell.get(`${r},${c}`);
                const label = `${rowLetter(r)}${c + 1}`;
                if (!cell) {
                  return (
                    <td key={c} className="cqplate__cell is-empty" aria-label={`Well ${label}: no reading`} />
                  );
                }
                return (
                  <td key={c} className="cqplate__cell">
                    <button
                      type="button"
                      className="cqplate__pick"
                      onClick={() => onPickWell(r, c)}
                      title={cell
                        .map((x) => `${x.target}: ${x.cq == null ? "no Cq" : formatCq(x.cq)}`)
                        .join("\n")}
                      aria-label={`Well ${label}`}
                    >
                      {cell.map((x) => (
                        <span
                          key={`${x.target}-${x.fluor}`}
                          className={"cqplate__value mono" + (x.cq == null ? " is-none" : "")}
                          style={{ color: channelColor(x.channel) }}
                        >
                          {formatCq(x.cq)}
                        </span>
                      ))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
