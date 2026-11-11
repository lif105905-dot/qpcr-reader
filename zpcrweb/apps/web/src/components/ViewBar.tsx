/**
 * The **view bar** — the app's tab strip, and the counterpart of the **file bar** below it
 * (`FileBar.tsx`). Those two names are how the rest of the codebase and its docs refer to these
 * surfaces; see `apps/web/ARCHITECTURE.md`, "Files, loaded files, and the one selection".
 *
 * The strip leads with what this app is *for*, matching the two screens of the original
 * software that hold the answers:
 *
 * - **Files** — the catalog, every file the browser holds (`FilesTableView.tsx`). Not tied to the
 *   selection, so it is always enabled: with nothing selected it is where you go to select
 *   something.
 * - **Quantification / Melt** — the two lenses on the **one selected file**: the amplification
 *   curves with their Cq values, and the melt curves that say whether the product was the right
 *   one. Both are disabled when nothing is selected, and greyed out per file when they don't
 *   apply (`App.tsx`'s `enabledViewsFor`). Melt is the same view as Quantification with the melt
 *   plate-read step selected — see `App.tsx`'s `selectView`.
 * - **More** — everything else: Overview, Protocol, Plates, Reference, Calibration, Raw and the
 *   instrument itself. These are consulted while setting a run up or chasing a problem rather than
 *   on the way to a number, so they are one click away in a popover instead of seven tabs wide.
 *
 * **The tabs are the same whatever the selection is.** A tab that doesn't apply is disabled,
 * never removed: a set that changed shape per file moved every other tab under the pointer each
 * time the selection changed, and hid the fact that this is the app's fixed set of lenses rather
 * than a per-file menu. Greying out says "not for this file"; disappearing says nothing at all.
 */
import { useRef, useState } from "react";
import type { ViewId } from "../state/useZpcrStore";
import {
  CalibrationIcon,
  CurvesIcon,
  FilesIcon,
  MeltIcon,
  MoreIcon,
  InstrumentIcon,
  OverviewIcon,
  PlatesIcon,
  ProtocolIcon,
  RawIcon,
  ReferenceIcon,
} from "./ViewIcons";

interface Tab {
  id: ViewId;
  label: string;
  Icon: () => React.ReactElement;
}

/**
 * The two panels this app is *for*, in strip order — the two screens of the original software
 * people actually work in: amplification curves with their Cq values, and the melt curves that
 * say whether the product was the right one. Everything else is a lens on how the run was
 * recorded rather than on what it measured, so it lives behind {@link MORE_VIEWS}.
 */
const PRIMARY_VIEWS: Tab[] = [
  { id: "curves", label: "Quantification", Icon: CurvesIcon },
  { id: "melt", label: "Melt", Icon: MeltIcon },
];

/**
 * The rest of the file views — still one click away, just not in the way. These are the things
 * consulted while setting a run up or chasing a problem, not on the way to a number: the
 * protocol it ran, the plate map, the reference row, the calibration, the raw archive and the
 * instrument itself.
 */
const MORE_VIEWS: Tab[] = [
  { id: "overview", label: "Overview", Icon: OverviewIcon },
  { id: "protocol", label: "Protocol", Icon: ProtocolIcon },
  { id: "plates", label: "Plates", Icon: PlatesIcon },
  { id: "reference", label: "Reference", Icon: ReferenceIcon },
  { id: "calibration", label: "Calibration", Icon: CalibrationIcon },
  { id: "raw", label: "Raw", Icon: RawIcon },
  // The cycler on the other end of the USB cable. Not a lens on this file either, but it belongs
  // with the other "consulted while setting a run up" views rather than on the working strip.
  { id: "instrument", label: "Instrument", Icon: InstrumentIcon },
];

/** The catalog tab, in its own group and always enabled — see the module comment. */
const FILES_VIEW: Tab = { id: "files", label: "Files", Icon: FilesIcon };

/** The instrument tab, likewise its own group and likewise always enabled: the cycler is there or
 * not there regardless of what the file bar has selected. */
const INSTRUMENT_VIEW: Tab = { id: "instrument", label: "Instrument", Icon: InstrumentIcon };

interface Props {
  value: ViewId;
  onChange: (v: ViewId) => void;
  /**
   * Which file views the selected file supports, e.g. `["overview", "plates", "raw"]` for a
   * standalone `.pltd`/`.plt.csv`. An **empty** array is the no-selection case: nothing applies,
   * so every file view greys out and only Files and Instrument remain — the two that were never
   * about the selection.
   */
  enabled: readonly ViewId[];
}

/** `2026-11-11T19:20:31.123Z` → `2026-11-11 19:20`（本地时间），供「更多」菜单底部显示。 */
function buildStamp(): string {
  const d = new Date(__BUILD_STAMP__);
  if (Number.isNaN(d.getTime())) return __BUILD_STAMP__;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ViewBar({ value, onChange, enabled }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  /** Where to draw the menu. Measured rather than positioned in CSS: the strip lives in a
   * horizontally-scrolling box (`.app__views`), and anything absolutely positioned inside it is
   * clipped to that box — the menu would open into a one-row slot. A fixed position derived from
   * the button's own rectangle escapes the clip without a portal. */
  const [morePos, setMorePos] = useState<{ top: number; right: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const toggleMore = () => {
    if (moreOpen) {
      setMoreOpen(false);
      return;
    }
    const rect = moreRef.current?.getBoundingClientRect();
    if (rect) setMorePos({ top: Math.round(rect.bottom + 8), right: Math.round(window.innerWidth - rect.right) });
    setMoreOpen(true);
  };
  /** The hidden view the selection is currently on, if any: the More button then wears its name,
   * so a tab behind the menu is never invisible about being the one in use. */
  const hiddenActive = MORE_VIEWS.find((v) => v.id === value);
  const tab = (v: Tab, off = false) => (
    <button
      key={v.id}
      role="tab"
      aria-selected={value === v.id}
      disabled={off}
      // The label is hidden on a narrow viewport (`app.css`), so name the tab explicitly:
      // `aria-label` keeps it readable to a screen reader either way, and `title` gives a
      // pointer user the word back on hover — and, when the tab is off, the reason it is.
      aria-label={off ? `${v.label} — not available for this file` : v.label}
      title={off ? `${v.label} — not available for this file` : v.label}
      className={"segmented__item" + (value === v.id ? " is-active" : "")}
      onClick={() => onChange(v.id)}
    >
      <v.Icon />
      <span className="segmented__label">{v.label}</span>
    </button>
  );

  return (
    <div className="viewbar" role="tablist" aria-label="View">
      <div className="segmented segmented--files">{tab(FILES_VIEW)}</div>
      <div className="segmented">{PRIMARY_VIEWS.map((v) => tab(v, !enabled.includes(v.id)))}</div>
      <div className="segmented viewbar__more">
        <button
          type="button"
          ref={moreRef}
          className={"segmented__item" + (moreOpen || hiddenActive ? " is-active" : "")}
          aria-expanded={moreOpen}
          aria-label={hiddenActive ? `${hiddenActive.label} — more views` : "More views"}
          title={hiddenActive ? hiddenActive.label : "More views"}
          onClick={toggleMore}
        >
          <MoreIcon />
          <span className="segmented__label">{hiddenActive ? hiddenActive.label : "More"}</span>
        </button>
        {moreOpen && (
          <>
            {/* Clicking anywhere else closes the menu — a panel that only closes on its own
                button is a panel people leave open by accident. */}
            <div className="viewbar__scrim" onClick={() => setMoreOpen(false)} />
            <div
              className="viewbar__pop segmented"
              role="group"
              style={morePos ? { position: "fixed", top: morePos.top, right: morePos.right } : undefined}
            >
              {MORE_VIEWS.map((v) => (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={value === v.id}
                  disabled={v.id === "instrument" ? false : !enabled.includes(v.id)}
                  aria-label={v.label}
                  title={v.label}
                  className={"segmented__item" + (value === v.id ? " is-active" : "")}
                  onClick={() => {
                    setMoreOpen(false);
                    onChange(v.id);
                  }}
                >
                  <v.Icon />
                  <span className="segmented__label">{v.label}</span>
                </button>
              ))}
              <div className="viewbar__stamp">构建 {buildStamp()}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
