import { useEffect, useMemo, useRef, useState } from "react";
import {
  analysisCsv,
  analysisCsvFilename,
  buildAnalysisRows,
  buildMeltRows,
  computeMeltAnalysisFor,
  DEFAULT_CQ_METHOD,
  meltCsv,
  meltCurvesFromFluor,
  meltSegments,
  meltCsvFilename,
  NO_TARGET,
  wellLabel,
  type LedCurve,
  type MeltCurve,
  type SampleType,
  type BaselineMode,
  type Zpcr,
  type TemperatureCurve,
} from "@zpcrweb/core";
import { computeWellTypes } from "../../lib/wellTypes";
import { solveThreshold, type SolvableCurve } from "../../lib/solveThreshold";
import { stashedCfxCq } from "../../lib/cfxStash";
import { SAMPLE_TYPE_META } from "../../lib/sampleType";
import {
  wellKey,
  type AnalysisSource,
  type CurveView,
  type FileSettings,
  type FluorViewMode,
  type MeltView,
  type Scale,
} from "../../state/useZpcrStore";
import { usePltdPassword } from "../../state/pltdPassword";
import { channelColor, channelLabel } from "../../lib/channelColors";
import { curveColor } from "../../lib/fluorColors";
import {
  channelCurveKey,
  curveKey,
  darkCurveKey,
  useRunAnalysis,
} from "../../lib/runAnalysis";
import { downloadBytes, downloadText } from "../../lib/download";
import { cqPlateCsv, cqPlateCsvFilename } from "../../lib/cqPlateCsv";

/** The colours the "paint these curves" row offers. Chosen to stay legible on the dark plot and
 * to be distinguishable from each other at a glance — not to mean anything. A curve's colour is
 * how you find it again while reading the plot, so these are deliberately *not* the channel hues:
 * that palette already says where a curve came from, and overloading it would make a recoloured
 * curve look like it moved channels. */
const CURVE_COLORS: { hex: string; name: string }[] = [
  { hex: "#e6f0ff", name: "白色" },
  { hex: "#22d3ee", name: "青色" },
  { hex: "#3ddc84", name: "绿色" },
  { hex: "#ffa53d", name: "橙色" },
  { hex: "#ff4fa3", name: "品红" },
  { hex: "#a78bfa", name: "紫色" },
  { hex: "#ffe066", name: "黄色" },
  { hex: "#ff5a5a", name: "红色" },
];
import { vesselLabel } from "../../lib/plateNames";
import { ChannelBar } from "../curves/ChannelBar";
import { FluorBar, type FluorChip } from "../curves/FluorBar";
import { SampleBar } from "../curves/SampleBar";
import { useHoverCard, type HoverCardData, type HoverCardRow } from "../curves/HoverCard";
import { WellMatrix } from "../curves/WellMatrix";
import { WellTypeBar, type WellTypeGroup } from "../curves/WellTypeBar";
import { CurveChart, type CqDragTarget } from "../curves/CurveChart";
import { CurveTable } from "../curves/CurveTable";
import { CqPlate } from "../curves/CqPlate";
import { MeltChart } from "../curves/MeltChart";
import { MeltTable } from "../curves/MeltTable";
import { CqRange } from "../curves/CqRange";
import {
  ThresholdSection,
  type ThresholdCurveRow,
  type ThresholdGroupRow,
} from "../curves/ThresholdSection";
import { AuxBar } from "../curves/AuxBar";
import { ledAxis, noRightAxis, selectAux, temperatureAxis } from "../../lib/rightAxis";
import { PasswordPrompt } from "../PasswordPrompt";
import { Toggle } from "../Toggle";
import { Switch } from "../Switch";
import { ResetIcon } from "../ResetIcon";
import {
  parseCfxAmplificationCsv,
  parseCfxCqCsv,
  thresholdFromCfxCurves,
} from "../../lib/cfxCq";
import { DownloadIcon } from "../DownloadIcon";
import { ImageIcon } from "../ImageIcon";
import { UploadIcon } from "../ViewIcons";
import { encodeTiff } from "../../lib/figure/tiff";
import { curveImageFilename, renderCurveFigure } from "../../lib/figure/curveFigure";
import { meltImageFilename, renderMeltFigure } from "../../lib/figure/meltFigure";
import type { HighlightMatch, PlotCurve, PlotDarkCurve } from "../../lib/uplot/chart";
import type { MeltHighlight, MeltPlotCurve } from "../../lib/uplot/meltChart";

/**
 * Stable "no dark curves" reference, for the same reason `CurveChart` keeps one for the factory
 * overlay: `darkCurves` is in the chart's build-effect dependencies, so a fresh `[]` on every
 * render tears the plot down and builds it again — which drops the cursor, the tooltip and any
 * hover in progress. Harmless while nothing in this view re-rendered on a chart hover; not
 * harmless now that hovering a curve marks its well in the rail.
 */
const NO_DARK_CURVES: PlotDarkCurve[] = [];

/**
 * The optical channel a melt is worth reading on: channel 1, the green band SYBR and EvaGreen
 * are read in. What melts is double-stranded product, and an intercalating dye is what reports
 * it; a hydrolysis probe has been cleaved off its quencher since the extension step and its
 * trace across the ramp is thermal quenching, not a transition (`melt.md` §7). So a run that
 * multiplexes probes with an intercalating dye opens its melt on green alone — the rest are
 * still listed in the rail, off, a click from being shown.
 *
 * Deliberately the *channel* and not a list of dye names. Melt mode has to work with no plate
 * and no password (the committed melt sample's plate is encrypted), where a channel index is the
 * only thing there is to select on; and a plate that types its intercalating dye as "FAM" — the
 * common case, since the instrument's own dye list is what people pick from — would defeat a
 * name-based rule while still being read on this channel.
 */
const MELT_CHANNEL = 0;

/** The Baseline section's right-hand value: which window the analysis is actually fitting. */
function windowSummary(
  manual: { beginCycle: number; endCycle: number } | null,
  declared: { beginCycle: number; endCycle: number } | null,
  cfx: boolean,
): string {
  if (manual) return `手动 ${manual.beginCycle}–${manual.endCycle}`;
  if (cfx) return "自动 · CFX 逐孔";
  return declared ? `自动 ${declared.beginCycle}–${declared.endCycle}` : "自动";
}

interface Props {
  zpcr: Zpcr;
  settings: FileSettings;
  onChange: (patch: Partial<FileSettings>) => void;
}

export function CurvesView({ zpcr, settings, onChange }: Props) {
  const [pltdPassword, setPltdPassword] = usePltdPassword();
  // The window the file itself declares (CFX's Baseline Cycles, "Auto Calculated"). It is what
  // the analysis uses until the boxes above are filled in, so it is also what the placeholders
  // and the "自动" summary show.
  const declaredWindow = zpcr.declaredBaselineWindow ?? null;

  // Landscape-phone drawer state (see `.curves__rail`'s media query in app.css). Irrelevant
  // outside that viewport shape — the toggle button and scrim that drive it are `display: none`
  // everywhere else, so the rail just renders as the permanent column it always was.
  const [railOpen, setRailOpen] = useState(false);

  /**
   * The baseline window's two inputs, held as text until both halves are usable.
   *
   * They can't be committed one field at a time: clearing the start, or typing `8` before `20`,
   * leaves a pair the fit cannot use, and pushing that through `onChange` would snap the window
   * back to "auto" mid-edit (and the analysis with it, twice per pair). So the draft is local,
   * committed only when both ends parse and the range is sane, and reseeded whenever the
   * committed window changes from elsewhere (the Auto button, a different file).
   */
  const [winDraft, setWinDraft] = useState<{ begin: string; end: string }>({ begin: "", end: "" });
  useEffect(() => {
    setWinDraft({
      begin: settings.baselineWindow ? String(settings.baselineWindow.beginCycle) : "",
      end: settings.baselineWindow ? String(settings.baselineWindow.endCycle) : "",
    });
  }, [settings.baselineWindow]);
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railOpen]);
  const steps = useMemo(() => zpcr.steps(), [zpcr]);
  // Selected step: the stored one if still valid, else the first step.
  const activeStep =
    settings.step != null && steps.some((s) => s.step === settings.step)
      ? settings.step
      : (steps[0]?.step ?? undefined);

  /**
   * Melt mode. A plate-read step whose reads sweep temperature is a melt curve rather than an
   * amplification one (`melt.md` §2), and almost nothing this view normally does applies to it:
   * there are no cycles, no baseline, no threshold and no Cq. When the selected step is one, the
   * chart, the table, the CSV and most of the rail below switch over.
   *
   * This is the **channel-space** melt, which is always available: it needs no plate definition
   * and no password, which is what lets melt mode work on a run whose plate is encrypted — the
   * committed melt sample being exactly that. `meltFluor` below is the color-separated
   * counterpart, for the View toggle's dye modes.
   */
  const melt = useMemo(
    () => computeMeltAnalysisFor(zpcr, activeStep),
    [zpcr, activeStep],
  );
  const meltMode = melt !== undefined;
  /** Every melt step of the run, so the step selector can name one for what it is rather than by
   * its index — a run's melt is the step people go looking for. */
  const meltSteps = useMemo(() => meltSegments(zpcr), [zpcr]);
  const stepMelt = (step: number) => meltSteps.find((m) => m.step === step);
  /** A ramp endpoint, written the way the instrument's own protocol writes it: 65, not 65.0. */
  const fmtTemp = (c: number) => (Number.isInteger(c) ? String(c) : c.toFixed(1));

  // The run-level derivation this view is built on — plate, targets, color separation and, above
  // all, the run's single Cq table. See `runAnalysis.ts`: the chart, the hover cards and table mode
  // all read Cq values out of that one table and never recompute them for the subset they happen to
  // be showing, which is what used to make them disagree with each other.
  const run = useRunAnalysis(zpcr, settings, pltdPassword, activeStep);
  const {
    plateEntry,
    plate,
    allCurves,
    darkCurves,
    available,
    tubes,
    fluorCals,
    calibrationAvailable,
    wellFluorTargets,
    wellFluors,
    wellSample,
    targetInfos,
    usingTargets,
    dyeSpace,
    hasFileAnalysis,
    groupInfos,
    thresholdGroups,
    loadedFluors,
    allFluorCurves,
    cqTable,
    plainBaselines,
  } = run;

  // The right axis carries instrument temperatures and LED drive currents — real readings, but
  // not what a quantification run is read for, and this app is now the three panels the plate
  // analysis actually needs. The machinery stays (the platerereads still carry the fields, and
  // `rightAxis.ts` still knows how to build those axes), but nothing is ever selected, so the
  // chart is drawn without a second axis and the rail has one less thing on it.
  const rightAxis = useMemo(() => noRightAxis(), []);

  // Dark lines/subtraction only concern the enabled, available channels. Each carries its
  // display baseline from the run's analysis, like every other plotted series — the "Relative"
  // view baselines the dark overlay too.
  const enabledDark = useMemo(
    () =>
      darkCurves
        .filter((d) => available.includes(d.channel) && settings.enabledChannels.has(d.channel))
        .map((d) => ({ ...d, analysis: plainBaselines.get(darkCurveKey(d.channel)) })),
    [darkCurves, available, settings.enabledChannels, plainBaselines],
  );

  // ---- Plate-derived selection state -----------------------------------------------------
  // The dye-space curves themselves come from `useRunAnalysis` above (see calibration.md); what's
  // left here is the per-view selection/labelling state built on top of the plate.

  // Per-well sample type, for coloring the well-selection grid to match the Plates view — see
  // `computeWellTypes`; shared with AnalysisView's well matrix.
  const wellTypes = useMemo(() => computeWellTypes(plate), [plate]);

  // Wells holding at least one positive curve — one the run's Cq table gave a Cq, i.e. it crossed
  // its threshold — mapped to the *lowest* such Cq, which is what fades the grid's `+` (see
  // `plusOpacity`). Read from that table rather than from the plotted subset, so the mark doesn't
  // come and go as the rail's filters change: a well is positive or it isn't.
  const positiveWells = useMemo(() => {
    const m = new Map<string, number>();
    for (const [key, e] of cqTable) {
      if (e.cq == null) continue;
      // `curveKey` is `row,col,fluor` — the well key is its first two fields.
      const [row, col] = key.split(",");
      const k = wellKey(Number(row), Number(col));
      const prev = m.get(k);
      if (prev == null || e.cq < prev) m.set(k, e.cq);
    }
    return m;
  }, [cqTable]);

  const fullWellSet = useMemo(() => {
    const s = new Set<string>();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) s.add(wellKey(r, c));
    return s;
  }, []);

  // The set of wells the plate definition actually loads (a real, loaded tube) — the default
  // selection for a newly opened file, and what the "reset" button next to Wells restores.
  // `loaded`, not `sampleType !== "empty"`: a well can carry a non-"empty" sampleType (e.g. the
  // default "unknown"/wcSample) while still having no fluor loaded into it.
  const nonEmptyWellSet = useMemo(() => {
    if (!plate) return null;
    const s = new Set<string>();
    for (const w of plate.wells) if (w.loaded) s.add(wellKey(w.row, w.col));
    return s.size > 0 ? s : null;
  }, [plate]);

  const setsEqual = <T,>(a: Set<T>, b: Set<T>) =>
    a.size === b.size && [...a].every((k) => b.has(k));

  // Apply the plate-derived default exactly once per plate, and only while the selection still
  // looks like the untouched "all wells" default — so a file whose selection was already
  // customized (including a restore from storage) is left alone.
  const appliedDefaultForPlate = useRef<typeof plate>(undefined);
  useEffect(() => {
    if (!plate || !nonEmptyWellSet) return;
    if (appliedDefaultForPlate.current === plate) return;
    appliedDefaultForPlate.current = plate;
    if (setsEqual(settings.enabledWells, fullWellSet)) {
      onChange({ enabledWells: nonEmptyWellSet });
    }
  }, [plate, nonEmptyWellSet, fullWellSet, settings.enabledWells, onChange]);

  const resetWells = () => onChange({ enabledWells: nonEmptyWellSet ?? fullWellSet });

  // Channels assigned to a fluor in the plate configuration — the default selection for a newly
  // opened file's raw Channels view (calibration off), and what its reset button restores.
  const plateChannelSet = useMemo(() => {
    if (!plate) return null;
    // Fluors whose channel is unknown select nothing: this drives which raw optical channels to
    // show, and there is no channel to show for them (see `PlateFluor.channel`).
    const s = new Set<number>();
    for (const f of plate.fluors) if (f.channel !== undefined) s.add(f.channel);
    return s.size > 0 ? s : null;
  }, [plate]);

  const defaultEnabledChannels = useMemo(() => {
    if (!plateChannelSet) return new Set(available);
    const s = new Set(available.filter((ch) => plateChannelSet.has(ch)));
    return s.size > 0 ? s : new Set(available);
  }, [available, plateChannelSet]);

  // Same apply-once-per-plate pattern as the wells default above.
  const appliedChannelDefaultForPlate = useRef<typeof plate>(undefined);
  useEffect(() => {
    if (!plate || !plateChannelSet) return;
    if (appliedChannelDefaultForPlate.current === plate) return;
    appliedChannelDefaultForPlate.current = plate;
    if (setsEqual(settings.enabledChannels, new Set([0, 1, 2, 3, 4]))) {
      onChange({ enabledChannels: defaultEnabledChannels });
    }
  }, [plate, plateChannelSet, defaultEnabledChannels, settings.enabledChannels, onChange]);

  // ---- The melt's own series selection ----------------------------------------------------
  // A melt and an amplification step disagree about which dyes are worth plotting, so they keep
  // separate selections (`FileSettings.meltEnabledChannels`/`meltDisabledFluors`). Everything
  // below computes what a melt defaults to; the rail reads `seriesChannels`/`seriesHiddenFluors`
  // and writes whichever pair the current step owns.

  /** Optical channel of each of the plate's dyes — the dye's own calibration first
   * (`FluorCalibration.primaryChannel`, the optical fact), falling back to whatever the plate
   * recorded, and absent for a dye neither knows (a `.plt.csv` opened with no run, say). */
  const channelOfFluor = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of fluorCals) {
      const ch = f.primaryChannel ?? f.channel;
      if (ch != null) m.set(f.fluor, ch);
    }
    for (const f of plate?.fluors ?? []) {
      if (f.channel !== undefined && !m.has(f.fluor)) m.set(f.fluor, f.channel);
    }
    return m;
  }, [fluorCals, plate]);

  /** Whether any dye on this plate is read on the melt channel. When none is, every default
   * below falls back to showing everything: narrowing to a channel the run never used would
   * leave an empty plot with no visible reason for it. */
  const hasMeltChannel = useMemo(
    () => [...channelOfFluor.values()].includes(MELT_CHANNEL),
    [channelOfFluor],
  );

  /** A melt's default channel selection: the intercalating dye's channel alone — unless this
   * plate names channels and none of them is that one, in which case there is nothing green to
   * narrow to and the amplification default is the honest answer. A run with no plate at all
   * (an encrypted one, the ordinary case for a melt) still narrows: a channel index is all there
   * is to go on, and it is the channel the dye would be read on. */
  const defaultMeltChannels = useMemo(() => {
    if (channelOfFluor.size > 0 && !hasMeltChannel) return defaultEnabledChannels;
    return available.includes(MELT_CHANNEL) ? new Set([MELT_CHANNEL]) : new Set<number>(available);
  }, [available, channelOfFluor, hasMeltChannel, defaultEnabledChannels]);

  /** The same default in dye space, as the opt-out set the rail's chips use: every chip whose
   * dyes are all read on some other channel starts off.
   *
   * Keyed for *both* view modes at once — fluorophore names and target names — because one
   * `disabledFluors`-shaped set backs both, and each mode only ever looks up its own keys. A
   * target spanning several dyes counts as green if any one of them is: a group holding both the
   * probe and the dye has something to show in a melt. */
  const defaultMeltDisabledFluors = useMemo(() => {
    const off = new Set<string>();
    if (!hasMeltChannel) return off;
    const onMeltChannel = (fluors: string[]) =>
      fluors.some((f) => channelOfFluor.get(f) === MELT_CHANNEL);
    for (const f of fluorCals) if (!onMeltChannel([f.fluor])) off.add(f.fluor);
    for (const g of groupInfos) if (!onMeltChannel(g.fluors)) off.add(g.target);
    return off;
  }, [hasMeltChannel, channelOfFluor, fluorCals, groupInfos]);

  /** The melt's live selection: the user's, once they have touched it, and the default until
   * then — computed rather than seeded, so a plate or a calibration that arrives after the view
   * first rendered still moves the default rather than being locked out by it. */
  const meltChannels = settings.meltEnabledChannels ?? defaultMeltChannels;
  const meltHiddenFluors = settings.meltDisabledFluors ?? defaultMeltDisabledFluors;

  /** What the rail's chips show and filter on, for whichever kind of step is selected. */
  const seriesChannels = meltMode ? meltChannels : settings.enabledChannels;
  const seriesHiddenFluors = meltMode ? meltHiddenFluors : settings.disabledFluors;

  const resetChannels = () =>
    onChange(
      meltMode ? { meltEnabledChannels: null } : { enabledChannels: defaultEnabledChannels },
    );
  const resetFluors = () =>
    onChange(meltMode ? { meltDisabledFluors: null } : { disabledFluors: new Set<string>() });

  const calibrationOn = settings.calibration ?? calibrationAvailable;
  /** Names the plastic the calibration warnings below are talking about — both of them, on a
   * plate that mixes vessels, since each has its own calibration and either can be the one
   * missing. */
  const vessels = vesselLabel(tubes);
  const fluorViewMode: FluorViewMode = settings.fluorViewMode;
  /** Table mode replaces the chart with the run's Cq/ΔRFU table (the former Analysis view). It is
   * dye-space-only for the same reason the "Target" mode is: a per-target Cq needs color
   * separation. */
  const tableMode = calibrationOn && fluorViewMode === "table";
  /** How dye-space curves are grouped and labelled. Table mode groups by target, like "target"
   * mode — so the rail's chips, the threshold overrides and the table's rows all key on the same
   * label, whichever of the two is showing. */
  const groupByTarget = fluorViewMode !== "fluorophore";

  /** Whether targetInfos carries a {@link NO_TARGET} group — i.e. whether untargeted curves have
   * a chip to be labelled and toggled by, rather than falling back to their fluor name. */
  const hasNoTargetGroup = useMemo(
    () => targetInfos.some((t) => t.target === NO_TARGET),
    [targetInfos],
  );

  // Label a dye-space curve for display/toggling: its fluor name normally, or in target view
  // mode the target assigned to it in its own well — {@link NO_TARGET} when it has none (which
  // also covers the curves `showUnloadedFluors` draws for pairs the plate never loads), or the
  // fluor name when this plate has no targets at all.
  const labelForFluorCurve = (row: number, col: number, dye: string): string =>
    groupByTarget
      ? (wellFluorTargets.get(wellKey(row, col))?.get(dye) ?? (hasNoTargetGroup ? NO_TARGET : dye))
      : dye;

  /** Targets loaded as more than one dye. A duplex that reads one gene with both a probe and an
   * intercalating dye is the case that matters: two curves per well, one target name between
   * them, and nothing in the label to say which is which. The `(none)` catch-all is usually one
   * of these too, since it collects every untargeted dye on the plate. */
  const multiFluorTargets = useMemo(
    () => new Set(groupInfos.filter((g) => g.fluors.length > 1).map((g) => g.target)),
    [groupInfos],
  );

  /** How one curve is *written* — the label above, with the dye appended where the label alone
   * names more than one curve in a well. Only ever a display string: the grouping key stays
   * `labelForFluorCurve`, so a chip still toggles the whole target and a hover still isolates
   * it. In fluorophore mode the label is already the dye, so there is nothing to add. */
  const displayLabelForFluorCurve = (row: number, col: number, dye: string): string => {
    const label = labelForFluorCurve(row, col, dye);
    return groupByTarget && multiFluorTargets.has(label) ? `${label} · ${dye}` : label;
  };

  // Hovering a target/fluor chip or a well-grid cell in the rail highlights the matching
  // curve(s) in the chart, the same way hovering the chart itself dims every other curve.
  const [hoverHighlight, setHoverHighlight] = useState<HighlightMatch | null>(null);

  // Hovering a row in the Threshold rail also marks that threshold on the chart: a dotted line at
  // its RFU, plus — for a single curve's row — that curve's baseline region and σ (see CurveChart's
  // `thresholdLine`/`thresholdRegions` props). Set alongside `hoverHighlight` so isolating the
  // curves and marking their threshold always appear together.
  //
  // What's stored is *which* row is hovered, not the RFU it had when the pointer arrived: the
  // threshold's own input sits inside the hovered row, so typing or arrow-stepping it changes the
  // number without any pointer event to refresh a snapshot, and a captured value would leave the
  // line behind at the old level. Resolved against `thresholdRows` on every render below, the line
  // tracks the edit — and the auto-multiplier slider — live.
  const [hoverThreshold, setHoverThreshold] = useState<{
    fluor: string;
    /** Set when a single curve's row is hovered; absent for the fluorophore's own row. */
    curveKey?: string;
    regions: boolean;
  } | null>(null);

  // A hovered item should be shown even when it's individually disabled — the "peek" a rail
  // hover is supposed to give — so the visibility filters below let the hovered well/channel/
  // target/sample bypass its own disabled check (but only its own; hovering a disabled target
  // doesn't also reveal wells the user turned off).
  //
  // `plateRows`/`cellLabel` mirror `WellMatrix`'s own row-count-aware labelling (see that
  // component's doc comment) rather than always using core's `wellLabel()`: a Biomeme run's
  // synthesized plate is a single row, and `WellMatrix` sends hover labels with no row letter
  // for one — this has to construct the same string to recognize them.
  const plateRows = plate?.rows ?? 8;
  const cellLabel = (row: number, col: number) =>
    plateRows === 1 ? String(col + 1) : wellLabel(row, col);
  const isHoveredWell = (row: number, col: number) =>
    hoverHighlight?.kind === "wells" && hoverHighlight.labels.includes(cellLabel(row, col));

  // The well the pointer is on *in the chart* (see `CurveChart`/`MeltChart`'s `onHoverWell`),
  // which is a highlight the rail doesn't drive and so isn't in `hoverHighlight`.
  const [hoveredChartWell, setHoveredChartWell] = useState<string | null>(null);

  /** Display label → well key, over the plate's own shape, for turning a label-keyed highlight
   * back into the keys the grid draws in. Built from `cellLabel` rather than core's
   * `wellLabel()` for the single-row reason above. */
  const wellKeyByLabel = useMemo(() => {
    const m = new Map<string, string>();
    const cols = plate?.columns ?? 12;
    for (let r = 0; r < plateRows; r++)
      for (let c = 0; c < cols; c++) m.set(cellLabel(r, c), wellKey(r, c));
    return m;
    // `cellLabel` is a pure function of `plateRows`, which is already a dependency.
  }, [plateRows, plate?.columns]);

  /**
   * Wells the grid rings without the pointer being in it: whichever well or wells are highlighted
   * anywhere else — a curve hovered on the chart, a curve or well hovered in the Threshold rail,
   * a sample-type selector. A highlight that dims every other curve should also say *where* the
   * surviving curves sit on the plate; that answer is a cell away and was being left unsaid.
   */
  const peekWells = useMemo(() => {
    const labels =
      hoverHighlight?.kind === "curve"
        ? [hoverHighlight.label]
        : hoverHighlight?.kind === "wells"
          ? hoverHighlight.labels
          : [];
    const keys = new Set<string>();
    for (const l of [...labels, hoveredChartWell]) {
      const k = l == null ? undefined : wellKeyByLabel.get(l);
      if (k) keys.add(k);
    }
    return keys;
  }, [hoverHighlight, hoveredChartWell, wellKeyByLabel]);

  /**
   * The plate's sample types, each with the wells carrying it — the quick selectors in the Wells
   * heading row ("turn the NTCs off"). Only types actually on the plate get a selector, in
   * `SAMPLE_TYPE_META`'s own order so the row is stable as the file changes, and the whole bar
   * disappears when there's no plate to type the wells by.
   *
   * Built here rather than in `WellTypeBar` because the labels have to be this plate's labels:
   * a hover highlight speaks in display labels, which a single-row plate writes differently
   * (see `cellLabel`).
   */
  const wellTypeGroups = useMemo<WellTypeGroup[]>(() => {
    if (!wellTypes) return [];
    const byType = new Map<SampleType, WellTypeGroup>();
    const cols = plate?.columns ?? 12;
    for (let r = 0; r < plateRows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = wellKey(r, c);
        const type = wellTypes.get(key);
        if (!type) continue;
        let g = byType.get(type);
        if (!g) byType.set(type, (g = { type, keys: [], labels: [] }));
        g.keys.push(key);
        g.labels.push(cellLabel(r, c));
      }
    }
    return (Object.keys(SAMPLE_TYPE_META) as SampleType[])
      .map((t) => byType.get(t))
      .filter((g): g is WellTypeGroup => g !== undefined);
    // `cellLabel` is a pure function of `plateRows`, already a dependency.
  }, [wellTypes, plate?.columns, plateRows]);

  /** Clicking a sample-type selector: all of that type's wells off if every one was on,
   * otherwise all on — the same rule the grid's row/column headers follow. */
  const toggleWellType = (g: WellTypeGroup) => {
    const allOn = g.keys.every((k) => settings.enabledWells.has(k));
    const next = new Set(settings.enabledWells);
    for (const k of g.keys) (allOn ? next.delete(k) : next.add(k));
    onChange({ enabledWells: next });
  };

  const isHoveredChannel = (channel: number) =>
    hoverHighlight?.kind === "channel" && hoverHighlight.channel === channel;
  const isHoveredSample = (sample: string | undefined) =>
    !!sample && hoverHighlight?.kind === "sample" && hoverHighlight.sample === sample;
  const isHoveredTarget = (label: string) =>
    hoverHighlight?.kind === "target" && hoverHighlight.dyeLabel === label;

  // Target/table mode chips come from `groupInfos` — the threshold groups themselves — so a plate
  // with no targets at all still gets chips (its groups are its fluorophores; see `usingTargets`)
  // rather than an empty bar.
  const chipItems: FluorChip[] = useMemo(
    () =>
      groupByTarget
        ? groupInfos.map((g) => ({
            key: g.target,
            label: g.target,
            sublabel: usingTargets ? g.fluors.join(", ") : channelLabel(g.channel ?? 0),
            // One dye colors the chip; a target spanning several has no one dye to borrow from.
            fluor: g.fluors.length === 1 ? g.fluors[0] : null,
            // A dye-space source has no `.Dcal` calibration to have matched — see `dyeSpace`.
            calibrated: dyeSpace || !!g.curve,
          }))
        : fluorCals.map((f) => ({
            key: f.fluor,
            label: f.fluor,
            sublabel: channelLabel(f.channel),
            fluor: f.fluor,
            calibrated: dyeSpace || !!f.curve,
          })),
    [groupByTarget, groupInfos, usingTargets, fluorCals, dyeSpace],
  );

  /** The chip keys the *enabled* wells can actually produce — every dye those wells load, mapped
   * through the same labelling the curves themselves use. With "Unloaded" on, a well can draw any
   * of the plate's dyes, so every chip stays reachable. */
  const wellReachableKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!plate) return keys;
    for (const w of plate.wells) {
      if (!settings.enabledWells.has(wellKey(w.row, w.col))) continue;
      const dyes = settings.showUnloadedFluors
        ? plate.fluors.map((f) => f.fluor)
        : (w.fluors?.map((f) => f.fluor) ?? []);
      for (const dye of dyes) keys.add(labelForFluorCurve(w.row, w.col, dye));
    }
    return keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    plate,
    settings.enabledWells,
    settings.showUnloadedFluors,
    groupByTarget,
    hasNoTargetGroup,
    wellFluorTargets,
  ]);

  /** What the rail actually lists: only targets/fluorophores some enabled well can show. Turning
   * a well off takes its target off the bar with it, so the list describes the selection on
   * screen rather than the whole plate. The unfiltered `chipItems` still backs double-click
   * solo, so isolating one target also disables the ones currently hidden. */
  const visibleChipItems = useMemo(
    () => chipItems.filter((c) => wellReachableKeys.has(c.key)),
    [chipItems, wellReachableKeys],
  );

  // Distinct sample names actually assigned to a well on this plate, in plate order — declared
  // names with no well (`plate.samples`) are left out since there'd be nothing to toggle.
  const sampleList = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    if (plate) {
      for (const w of plate.wells) {
        if (w.sample && !seen.has(w.sample)) {
          seen.add(w.sample);
          list.push(w.sample);
        }
      }
    }
    return list;
  }, [plate]);

  /** The same list, narrowed to samples sitting in an enabled well — see `visibleChipItems`. */
  const visibleSampleList = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    if (plate) {
      for (const w of plate.wells) {
        if (!w.sample || seen.has(w.sample)) continue;
        if (!settings.enabledWells.has(wellKey(w.row, w.col))) continue;
        seen.add(w.sample);
        list.push(w.sample);
      }
    }
    return list;
  }, [plate, settings.enabledWells]);

  const sampleVisible = (row: number, col: number): boolean => {
    const sample = wellSample.get(wellKey(row, col));
    return !sample || !settings.disabledSamples.has(sample) || isHoveredSample(sample);
  };

  const toggleSample = (name: string) => {
    const next = new Set(settings.disabledSamples);
    next.has(name) ? next.delete(name) : next.add(name);
    onChange({ disabledSamples: next });
  };

  // ---- Channel-space (raw) curves --------------------------------------------------------

  const visibleChannel = useMemo(
    () =>
      allCurves.filter(
        (c) =>
          available.includes(c.channel) &&
          (settings.enabledChannels.has(c.channel) || isHoveredChannel(c.channel)) &&
          (settings.enabledWells.has(wellKey(c.row, c.col)) || isHoveredWell(c.row, c.col)) &&
          sampleVisible(c.row, c.col),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      allCurves,
      available,
      settings.enabledChannels,
      settings.enabledWells,
      settings.disabledSamples,
      wellSample,
      hoverHighlight,
    ],
  );

  /** The rail's filters, as one predicate over a well/fluor pair — shared by the plotted dye-space
   * curves and by table mode's rows, so the two always show the same set. The "is this pair
   * actually loaded" check is deliberately *not* here: it's a data-validity gate the chart can
   * bypass ("Unloaded") and the table never applies (it only lists loaded wells). */
  const fluorCurveVisible = (row: number, col: number, dye: string): boolean => {
    const label = labelForFluorCurve(row, col, dye);
    return (
      (settings.enabledWells.has(wellKey(row, col)) || isHoveredWell(row, col)) &&
      (!settings.disabledFluors.has(label) || isHoveredTarget(label)) &&
      sampleVisible(row, col) &&
      cqInRange(row, col, dye)
    );
  };

  /** The rail's Cq filter (see `FileSettings.cqMin` and the `CqRange` slider). Read out of the
   * run's Cq table like everything else about a curve's Cq — never recomputed here — so a curve
   * is filtered on exactly the number the chart marker, hover card and table all show for it.
   *
   * Unlike the chip filters above it takes no hover override: there is no chip to hover, and a
   * peeked well should still respect the range the user is looking at. A curve with no Cq
   * survives only while the upper bound is unset, which is the slider's top stop. */
  const cqInRange = (row: number, col: number, dye: string): boolean => {
    if (settings.cqMin == null && settings.cqMax == null) return true;
    const cq = cqTable.get(curveKey(row, col, dye))?.cq ?? null;
    if (cq == null) return settings.cqMax == null;
    return (
      (settings.cqMin == null || cq >= settings.cqMin) &&
      (settings.cqMax == null || cq <= settings.cqMax)
    );
  };

  const visibleFluor = useMemo(
    () =>
      allFluorCurves.filter(
        (c) =>
          fluorCurveVisible(c.row, c.col, c.dye) &&
          (settings.showUnloadedFluors ||
            (wellFluors.get(wellKey(c.row, c.col))?.has(c.dye) ?? false)),
      ),
    [
      allFluorCurves,
      settings.enabledWells,
      settings.disabledFluors,
      settings.showUnloadedFluors,
      settings.disabledSamples,
      settings.cqMin,
      settings.cqMax,
      cqTable,
      wellFluors,
      wellSample,
      fluorViewMode,
      wellFluorTargets,
      hasNoTargetGroup,
      hoverHighlight,
    ],
  );

  // Whether to show the run in dye space: the user's toggle, independent of whether any
  // fluor actually matched a calibration file — see the FluorBar's dimmed chips and the
  // "no calibration matches" note below for that case, rather than silently reverting to
  // channel space while the toggle still reads "On".

  // ---- What actually gets plotted --------------------------------------------------------
  // Channel space and dye space never mix on the same plot: color-separated curves carry no
  // real min/max/std of their own (§5 of calibration.md solves for a single concentration per
  // channel vector, not a distribution) — so bands and the dark overlay are both
  // channel-space-only concepts, hidden once color separation is on.

  // The analysis record for one plotted curve — *looked up*, never recomputed. The run's tables
  // (`runAnalysis.ts`) already hold exactly one record per curve, computed over the whole plate;
  // deriving one again from whatever subset happens to be plotted is precisely what used to make
  // the chart's markers, the hover cards and the Analysis table disagree. Everything the chart
  // draws about a curve's baseline, threshold or Cq comes from here.
  const dyeAnalysis = (row: number, col: number, dye: string) => cqTable.get(curveKey(row, col, dye));
  // Channel space gets no Cq of its own — see `RunAnalysis.cqTable`. A raw channel curve carries
  // every dye that emits into that filter and belongs to no target, so quantifying it would be
  // measuring crosstalk. Its record is therefore the baseline-only kind: enough for the "Relative"
  // view to subtract the same baseline the rest of the app would, with no Cq or threshold attached.
  // What channel curves carry instead, and dye-space curves don't, is the real min/max/σ spread.
  const channelAnalysis = (row: number, col: number, channel: number) =>
    plainBaselines.get(channelCurveKey(row, col, channel));

  const plotCurves: PlotCurve[] = useMemo(
    () =>
      calibrationOn
        ? visibleFluor.map((c) => ({
            channel: c.channel,
            dyeLabel: labelForFluorCurve(c.row, c.col, c.dye),
            displayLabel: displayLabelForFluorCurve(c.row, c.col, c.dye),
            fluor: c.dye,
            row: c.row,
            col: c.col,
            wellLabel: c.wellLabel,
            color: settings.wellColors[wellKey(c.row, c.col)],
            isReference: c.isReference,
            cycles: c.cycles,
            mean: c.mean,
            sample: wellSample.get(wellKey(c.row, c.col)),
            analysis: dyeAnalysis(c.row, c.col, c.dye),
          }))
        : visibleChannel.map((c) => ({
            channel: c.channel,
            dyeLabel: channelLabel(c.channel),
            row: c.row,
            col: c.col,
            wellLabel: c.wellLabel,
            color: settings.wellColors[wellKey(c.row, c.col)],
            isReference: c.isReference,
            cycles: c.cycles,
            mean: c.mean,
            std: c.std,
            min: c.min,
            max: c.max,
            sample: wellSample.get(wellKey(c.row, c.col)),
            analysis: channelAnalysis(c.row, c.col, c.channel),
          })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      calibrationOn,
      visibleFluor,
      visibleChannel,
      fluorViewMode,
      wellFluorTargets,
      hasNoTargetGroup,
      wellSample,
      cqTable,
      // The hand-picked colours ride on the curves themselves, so a repaint has to rebuild them
      // — otherwise the plot keeps whatever colours the memo last handed it.
      settings.wellColors,
    ],
  );

  // Every curve on the plate for the active view mode, ignoring the enabled-wells/channels/
  // fluors/samples filters (but still skipping fluor/well pairs the plate itself never loads,
  // unless "Unloaded" is on — that's a data-validity gate, not a selection filter). Exists only
  // to power the rail hover cards below, so a filtered-out element still lists its neighbors
  // (greyed out) instead of the card going empty. Cq values come from the same table as the
  // plotted curves', so a hover card and the chart always agree on a given curve.
  const allPlotCurves: PlotCurve[] = useMemo(
    () =>
      calibrationOn
        ? allFluorCurves
            .filter(
              (c) =>
                settings.showUnloadedFluors ||
                (wellFluors.get(wellKey(c.row, c.col))?.has(c.dye) ?? false),
            )
            .map((c) => ({
              channel: c.channel,
              dyeLabel: labelForFluorCurve(c.row, c.col, c.dye),
              displayLabel: displayLabelForFluorCurve(c.row, c.col, c.dye),
              fluor: c.dye,
              row: c.row,
              col: c.col,
              wellLabel: c.wellLabel,
              isReference: c.isReference,
              cycles: c.cycles,
              mean: c.mean,
              sample: wellSample.get(wellKey(c.row, c.col)),
              analysis: dyeAnalysis(c.row, c.col, c.dye),
            }))
        : allCurves
            .filter((c) => available.includes(c.channel))
            .map((c) => ({
              channel: c.channel,
              dyeLabel: channelLabel(c.channel),
              row: c.row,
              col: c.col,
              wellLabel: c.wellLabel,
              isReference: c.isReference,
              cycles: c.cycles,
              mean: c.mean,
              std: c.std,
              min: c.min,
              max: c.max,
              sample: wellSample.get(wellKey(c.row, c.col)),
              analysis: channelAnalysis(c.row, c.col, c.channel),
            })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      calibrationOn,
      allFluorCurves,
      allCurves,
      available,
      settings.showUnloadedFluors,
      wellFluors,
      fluorViewMode,
      wellFluorTargets,
      hasNoTargetGroup,
      wellSample,
      cqTable,
    ],
  );

  // ---- Rail hover cards -------------------------------------------------------------------
  // Each card lists every curve on the plate for the hovered chip/cell (`allPlotCurves`), not
  // just the currently-plotted ones, so a filtered-out well/target/channel/sample still shows up
  // — just marked unselected so `HoverCard` can grey it out and sort it after the selected rows.
  // A row's color is its curve's channel, matching the chip/legend coloring elsewhere.

  const selectedCurveKeys = useMemo(
    () => new Set(plotCurves.map((c) => `${c.row},${c.col},${c.dyeLabel}`)),
    [plotCurves],
  );
  const isSelected = (c: PlotCurve) => selectedCurveKeys.has(`${c.row},${c.col},${c.dyeLabel}`);

  /** Selected rows first (each group's own original order preserved within that half). */
  function selectedFirst<T extends { selected: boolean }>(rows: T[]): T[] {
    return [...rows.filter((r) => r.selected), ...rows.filter((r) => !r.selected)];
  }

  const cardForWell = (label: string): HoverCardData | null => {
    const well = plate?.wells.find((w) => w.label === label);
    if (!well) return null;
    const rows: HoverCardRow[] = selectedFirst(
      allPlotCurves
        .filter((c) => c.wellLabel === label)
        .map((c) => ({
          key: `${c.dyeLabel}-${c.channel}`,
          // The written label, so a well holding one target as two dyes doesn't list it twice.
          label: c.displayLabel ?? c.dyeLabel,
          cq: c.analysis?.cq,
          color: curveColor(c),
          selected: isSelected(c),
        })),
    );
    // Sample type is shown the same way the grid colors the cell: a well that isn't loaded reads
    // as "empty" whatever type the plate design assigned it (see `computeWellTypes`).
    const meta = SAMPLE_TYPE_META[well.loaded ? well.sampleType : "empty"];
    const parts = [meta.label, well.sample ? `Sample: ${well.sample}` : null].filter(Boolean);
    return { title: `Well ${label}`, subtitle: parts.join(" · "), rows };
  };

  const cardForDyeLabel = (dyeLabel: string): HoverCardData | null => {
    const matches = allPlotCurves.filter((c) => c.dyeLabel === dyeLabel);
    if (matches.length === 0) return null;
    const rows: HoverCardRow[] = selectedFirst(
      matches.map((c) => ({
        key: `${c.row},${c.col}`,
        label: c.wellLabel,
        sublabel: c.sample,
        cq: c.analysis?.cq,
        color: curveColor(c),
        selected: isSelected(c),
      })),
    );
    return { title: dyeLabel, rows };
  };

  const cardForChannel = (channel: number): HoverCardData | null => {
    const matches = allPlotCurves.filter((c) => c.channel === channel);
    if (matches.length === 0) return null;
    const rows: HoverCardRow[] = selectedFirst(
      matches.map((c) => ({
        key: `${c.row},${c.col}`,
        label: c.wellLabel,
        sublabel: c.sample,
        cq: c.analysis?.cq,
        color: channelColor(channel),
        selected: isSelected(c),
      })),
    );
    return { title: channelLabel(channel), rows };
  };

  const cardForSample = (sample: string): HoverCardData | null => {
    const matches = allPlotCurves.filter((c) => c.sample === sample);
    if (matches.length === 0) return null;
    const rows: HoverCardRow[] = selectedFirst(
      matches.map((c) => ({
        key: `${c.row},${c.col}-${c.dyeLabel}`,
        label: c.dyeLabel,
        sublabel: c.wellLabel,
        cq: c.analysis?.cq,
        color: curveColor(c),
        selected: isSelected(c),
      })),
    );
    return { title: sample, rows };
  };

  const toggleTemp = (key: string) => {
    const next = new Set(settings.temps);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange({ temps: next });
  };

  const toggleLed = (key: string) => {
    const next = new Set(settings.leds);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange({ leds: next });
  };

  // The chip handlers write to whichever selection the current step owns — the melt's own pair
  // in melt mode, the shared one otherwise (see `seriesChannels`). Each starts from the *live*
  // set, so the first toggle in a melt turns the computed default into a concrete selection
  // rather than starting from everything-on.
  const toggleChannel = (ch: number) => {
    const next = new Set(seriesChannels);
    next.has(ch) ? next.delete(ch) : next.add(ch);
    onChange(meltMode ? { meltEnabledChannels: next } : { enabledChannels: next });
  };

  const toggleFluor = (dye: string) => {
    const next = new Set(seriesHiddenFluors);
    next.has(dye) ? next.delete(dye) : next.add(dye);
    onChange(meltMode ? { meltDisabledFluors: next } : { disabledFluors: next });
  };

  // Double-clicking any legend item isolates it within its own dimension — every other
  // channel/target/well/sample turns off, leaving only the one that was double-clicked.
  const soloChannel = (ch: number) =>
    onChange(
      meltMode ? { meltEnabledChannels: new Set([ch]) } : { enabledChannels: new Set([ch]) },
    );

  const soloFluor = (key: string) => {
    const next = new Set(chipItems.map((c) => c.key));
    next.delete(key);
    onChange(meltMode ? { meltDisabledFluors: next } : { disabledFluors: next });
  };

  const soloWells = (keys: string[]) => onChange({ enabledWells: new Set(keys) });

  const soloSample = (name: string) => {
    const next = new Set(sampleList);
    next.delete(name);
    onChange({ disabledSamples: next });
  };

  // Clicking a Well/Target/Sample value in table mode: isolate what was clicked — exactly the
  // rail's own double-click solo — and leave the table for the Target view, so the answer to
  // "what does this row look like?" is the chart of that one thing. Only the clicked dimension
  // is touched; the other two keep whatever the rail already had.
  const pickWell = (row: number, col: number) => {
    onChange({ fluorViewMode: "target", enabledWells: new Set([wellKey(row, col)]) });
  };
  const pickTarget = (key: string) => {
    const next = new Set(chipItems.map((c) => c.key));
    next.delete(key);
    onChange({ fluorViewMode: "target", disabledFluors: next });
  };
  const pickSample = (name: string) => {
    const next = new Set(sampleList);
    next.delete(name);
    onChange({ fluorViewMode: "target", disabledSamples: next });
  };
  // The row's result numbers name one curve, not one dimension: isolating both the well and the
  // target leaves exactly the curve those numbers were measured on.
  const pickCurve = (row: number, col: number, key: string) => {
    const fluors = new Set(chipItems.map((c) => c.key));
    fluors.delete(key);
    onChange({
      fluorViewMode: "target",
      enabledWells: new Set([wellKey(row, col)]),
      disabledFluors: fluors,
    });
  };

  /** Whether table mode shows the plate grid or the sortable detail table. Local, not persisted:
   * it's a way of reading the numbers, not a property of the run. */
  const [tableLayout, setTableLayout] = useState<"plate" | "rows">("plate");

  /** The Cq values as the plate they were read on — one block per target, blank line between, so
   * a multiplex plate still exports without hiding which target a cell belongs to. An empty file
   * is written rather than omitted: "did not amplify" is a result worth keeping. */
  const downloadCqPlate = () => {
    downloadText(
      cqPlateCsvFilename(zpcr.metadata.dataFile),
      cqPlateCsv(tableRows),
      "text/csv",
    );
  };

  /** CFX's own Cq export, read into the file's settings so the table can show it beside ours. */
  const cfxInputRef = useRef<HTMLInputElement | null>(null);
  /** Takes either CFX export: the Cq results fill the two comparison columns, the amplification
   * results pin down the threshold the plate was analysed with — recovered from where each well's
   * own curve passes through its Cq, then written into every fluorophore's override so the app
   * computes Cq the same way CFX did. */
  /** One line of feedback for the import buttons — the only place the app says anything
   * about a file it just read, and it clears itself so the rail stays quiet. */
  const [cfxNote, setCfxNote] = useState<string | null>(null);
  /** Set while an imported Cq table is still being matched: each pass re-solves the threshold on
   * the curves the previous pass produced, because the per-well baseline depends on the Cq that
   * threshold yields. Two passes land on the fixed point; the third is a safety net. */
  const [solveFor, setSolveFor] = useState<Record<string, number> | null>(null);
  const [solveRound, setSolveRound] = useState(0);

  useEffect(() => {
    if (!cfxNote) return;
    const timer = window.setTimeout(() => setCfxNote(null), 8000);
    return () => window.clearTimeout(timer);
  }, [cfxNote]);

  /** The threshold that reproduces a set of reported Cq values on this run's own curves. CFX never
   * writes its automatic threshold down, and re-deriving its rule lands about twice as high, so
   * when the user hands us their numbers we solve for the line that puts our crossings on them. */
  const thresholdForCq = (reported: Record<string, number>): number | null => {
    const curves: SolvableCurve[] = [];
    const seen = new Set<string>();
    for (const [key, cell] of cqTable) {
      if (!cell.correctedValues) continue;
      const [rowText, colText] = key.split(",");
      const row = Number(rowText);
      const col = Number(colText);
      const well = `${"ABCDEFGH"[row] ?? ""}${col + 1}`;
      if (!(well in reported) || seen.has(well)) continue;
      const curve = allCurves.find((cv) => cv.row === row && cv.col === col);
      if (!curve) continue;
      seen.add(well);
      curves.push({ well, cycles: curve.cycles, values: cell.correctedValues });
    }
    return solveThreshold(curves, reported);
  };

  // Re-solve the imported Cq against the curves that the last solve produced, until the threshold
  // stops moving. The first pass runs on the pre-import curves, whose per-well baselines were
  // placed from our own Cq, so it lands a little off; the second pass corrects that.
  useEffect(() => {
    if (!solveFor || solveRound > 2) return;
    const solved = thresholdForCq(solveFor);
    if (solved == null) {
      setSolveFor(null);
      return;
    }
    const current = thresholdGroups.map((g) => settings.thresholdOverrides.get(g.fluor) ?? null);
    if (current.every((value) => value === solved)) {
      setSolveFor(null);
      setCfxNote(`已导入 ${Object.keys(solveFor).length} 个孔，阈值对齐到 ${solved} RFU`);
      return;
    }
    setSolveRound((round) => round + 1);
    onChange({
      thresholdOverrides: new Map(thresholdGroups.map((g) => [g.fluor, solved])),
      baselinePerWell: true,
    });
    // `thresholdForCq` closes over the analysis tables, so this re-runs when they change.
  }, [solveFor, solveRound, cqTable]);

  const importCfxCq = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = await file.text();

    const amp = parseCfxAmplificationCsv(text);
    if (amp) {
      const cq = settings.cfxCq;
      if (!cq) {
        setCfxNote("先把「Cq Results」那张表导进来，再导曲线表");
        return;
      }
      const threshold = thresholdFromCfxCurves(amp, cq);
      if (threshold == null) {
        setCfxNote("曲线表里没找到与 Cq 对得上的孔");
        return;
      }
      const value = Math.round(threshold);
      const next = new Map(settings.thresholdOverrides);
      for (const g of thresholdGroups) next.set(g.fluor, value);
      // The per-well window is the calibration that tracks CFX at a fixed threshold; switching it
      // on here means the numbers line up without the user having to know that.
      onChange({ thresholdOverrides: next, baselinePerWell: true });
      setCfxNote(`已按原版曲线反推阈值 ${value} RFU，并切到逐孔窗口`);
      return;
    }

    applyCfxCq(parseCfxCqCsv(text));
  };

  /** Point this run's threshold at CFX's own numbers: store the table, solve the line that puts our
   * crossings on it, and switch to the per-well window that fixed thresholds reward. */
  const applyCfxCq = (values: Record<string, number>) => {
    const count = Object.keys(values).length;
    const solved = count > 0 ? thresholdForCq(values) : null;
    const overrides = solved == null ? null : new Map(thresholdGroups.map((g) => [g.fluor, solved]));
    onChange({
      cfxCq: count > 0 ? values : null,
      ...(overrides ? { thresholdOverrides: overrides, baselinePerWell: true } : {}),
    });
    if (count > 0 && overrides) {
      setSolveRound(1);
      setSolveFor(values);
    } else {
      setSolveFor(null);
    }
    setCfxNote(
      count === 0
        ? "没认出 Cq 列，检查表头"
        : solved == null
          ? `已导入 ${count} 个孔的原版 Cq`
          : `已导入 ${count} 个孔，并反推出阈值 ${solved} RFU`,
    );
  };

  // A plate folder usually arrives as one drop: the `.pcrd` plus the CSVs CFX exported from it.
  // The store parks those CSVs (see `cfxStash`); here the run claims its own table the first time
  // it is opened, which is what makes "drop the folder" mean "and match CFX's numbers".
  const claimedCfx = useRef<string | null>(null);
  useEffect(() => {
    const runName = zpcr.metadata.dataFile;
    if (!runName || settings.cfxCq || claimedCfx.current === runName) return;
    const stashed = stashedCfxCq(runName);
    if (!stashed) return;
    claimedCfx.current = runName;
    applyCfxCq(Object.fromEntries(stashed));
    // `applyCfxCq` closes over the analysis tables; re-running on them is not wanted here.
  }, [zpcr.metadata.dataFile, settings.cfxCq]);

  /** Wells the colour row acts on (Shift-click in the plate grid). Deliberately not part of the
   * file's settings: a selection is a gesture in progress, not a property of the run, and leaving
   * it out means it can never survive into the next session as a stray highlight. */
  const [colorSel, setColorSel] = useState<Set<string>>(new Set());
  /** The rail's 选色 switch: while on, clicking wells picks them for colouring instead of hiding
   * them. Off by default — hiding curves is the everyday gesture, colouring is the occasional
   * one — but it has to be a visible switch rather than a hidden Shift, or nobody finds it. */
  const [colorMode, setColorMode] = useState(false);

  /** Paint every selected well with one colour — or, given `null`, hand them back to the palette
   * their channel/dye implies. Written per well rather than per selection so two overlapping
   * gestures (colour these, then those) keep their own answers. */
  const paintSelectedWells = (color: string | null) => {
    if (colorSel.size === 0) return;
    const next = { ...settings.wellColors };
    for (const key of colorSel) {
      if (color) next[key] = color;
      else delete next[key];
    }
    onChange({ wellColors: next });
  };

  // ---- Table mode / CSV export -------------------------------------------------------------
  // One row per visible (target, well) pair, filtered by exactly the same rail state as the chart
  // and reading the same Cq table (see `lib/analysisRows.ts`). Built in every view mode, not only
  // in table mode or dye space: the rows are what the Threshold section's live auto values and the
  // CSV button read, and both are available in channel mode too. Rows are target-based regardless
  // of which space the chart is showing — a threshold belongs to a target, never to a filter.
  const tableRows = useMemo(
    () => buildAnalysisRows(run, fluorCurveVisible),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      run,
      settings.enabledWells,
      settings.disabledFluors,
      settings.disabledSamples,
      settings.cqMin,
      settings.cqMax,
      fluorViewMode,
      wellFluorTargets,
      hasNoTargetGroup,
      wellSample,
    ],
  );

  /** How many cycles the active step actually read — the domain the table's Cq axis spans, and
   * the same one the chart's x axis uses. Taken from a curve rather than from the protocol: a run
   * stopped early has fewer plate reads than its `.prcl` asked for, and the axis has to match the
   * data that exists. */
  const cycleCount = useMemo(
    () => allCurves.reduce((m, c) => Math.max(m, c.cycles.at(-1) ?? 0), 0),
    [allCurves],
  );

  /** The live threshold per group (an override, or §5.1's auto value), read straight from the
   * run's Cq table rather than from `tableRows`: a group's threshold is a property of the run and
   * its noise cohort, not of which of its wells the rail happens to have selected, so the
   * Threshold section keeps showing a real value even when a filter hides every row. */
  const groupThresholds = useMemo(() => {
    const m = new Map<string, number>();
    // `groupThreshold`, not `threshold`: the latter is what that one curve is measured against,
    // which a per-curve override replaces — reading it would let overriding a single well rewrite
    // the number its whole fluorophore row displays.
    for (const e of cqTable.values()) if (!m.has(e.group)) m.set(e.group, e.groupThreshold);
    return m;
  }, [cqTable]);

  /** The Threshold section's rows: one per calibrated fluorophore, each carrying the curves its
   * threshold was derived from — the plate's *loaded* wells for that dye, which is exactly the
   * §5.1 noise cohort (`CqTableCurve.contributesToThreshold`). Every fluorophore with a matched
   * calibration curve gets a row regardless of the chip opt-out above: one hidden from the chart
   * still has a real threshold worth checking or overriding, and there'd otherwise be nothing on
   * screen to bring it back once its row vanished with its chip. */
  const thresholdRows = useMemo<ThresholdGroupRow[]>(
    () =>
      thresholdGroups
        .filter((g) => dyeSpace || g.curve)
        .map((g) => ({
          fluor: g.fluor,
          channel: g.channel,
          threshold: groupThresholds.get(g.fluor),
          override: settings.thresholdOverrides.get(g.fluor),
          curves: (plate?.wells ?? []).flatMap((w) => {
            if (!w.loaded || !(loadedFluors.get(wellKey(w.row, w.col))?.has(g.fluor) ?? false)) {
              return [];
            }
            const key = curveKey(w.row, w.col, g.fluor);
            const e = cqTable.get(key);
            if (!e) return [];
            return [
              {
                key,
                wellLabel: w.label,
                beginCycle: e.baselineRegion.beginCycle,
                endCycle: e.baselineRegion.endCycle,
                noise: e.noise,
                // §A.4's "baseline above threshold" case: a curve whose corrected minimum already
                // exceeds the threshold can never cross it, so it reports no Cq however obviously
                // it amplifies. Worth flagging, because in the table it is indistinguishable from
                // a flat well and means the opposite thing.
                aboveThreshold: Math.min(...e.correctedValues) > e.threshold,
                threshold: e.threshold,
                override: settings.curveThresholdOverrides.get(key),
              },
            ];
          }),
        })),
    [
      thresholdGroups,
      dyeSpace,
      groupThresholds,
      plate,
      loadedFluors,
      cqTable,
      settings.thresholdOverrides,
      settings.curveThresholdOverrides,
    ],
  );

  const downloadCsv = () =>
    downloadText(
      analysisCsvFilename(zpcr.metadata.dataFile),
      analysisCsv(tableRows, settings.cfxCq),
      "text/csv",
    );

  // ---- Melt mode ----------------------------------------------------------------------------

  /**
   * The melt in **dye space** — the same color separation the amplification view does, over the
   * melt step's reads. The separation itself is already in hand: `allFluorCurves` is the run
   * analysis for the selected step, and for a melt step that means each read solved against a
   * matrix built at *that read's* block temperature (`calibration.md` §2.1), which is what makes
   * a color-separated melt mean anything across a 30 °C ramp.
   *
   * Undefined when the step isn't a melt, or when the run has no usable calibration — in which
   * case the View toggle's channel mode is the only one with curves in it, exactly as for an
   * amplification step.
   */
  const meltFluor = useMemo(
    () =>
      melt && allFluorCurves.length > 0
        ? meltCurvesFromFluor(melt.segment, allFluorCurves, available)
        : undefined,
    [melt, allFluorCurves, available],
  );
  /** The melt analysis the chart, the table and the CSV all read — dye space when the View toggle
   * is on a dye mode and there is a separation to show, channel space otherwise. */
  const meltActive = calibrationOn && meltFluor ? meltFluor : melt;
  /** Whether that active analysis is the color-separated one. Distinct from `calibrationOn`,
   * which can be on for a run with nothing to separate. */
  const meltInDyeSpace = meltActive === meltFluor && meltFluor !== undefined;
  /** Whether the rail's series chips are dyes/targets rather than optical channels. Follows the
   * View toggle, except that a melt with nothing to separate keeps its channel chips — those are
   * what its curves are actually filtered by, and dead dye chips would filter nothing. */
  const dyeChips = calibrationOn && (!meltMode || meltInDyeSpace);

  /** The label a melt curve is drawn and toggled by — the target, the fluorophore or the
   * channel, following the same View toggle the amplification chart follows. */
  const meltLabel = (c: MeltCurve): string =>
    c.dye ? labelForFluorCurve(c.row, c.col, c.dye) : channelLabel(c.channel);

  /** The same, as it is written on the chart — see `displayLabelForFluorCurve`. */
  const meltDisplayLabel = (c: MeltCurve): string =>
    c.dye ? displayLabelForFluorCurve(c.row, c.col, c.dye) : channelLabel(c.channel);

  /** The rail's filters over one melt curve, in whichever space it is in: the channel chips and
   * wells in channel space, the fluor/target chips and wells in dye space. Deliberately not
   * `fluorCurveVisible` — that also applies the Cq range, and a melt has no Cq at all, so a
   * range left over from an amplification step would silently empty the plot. */
  const meltCurveVisible = (c: MeltCurve): boolean => {
    if (!(settings.enabledWells.has(wellKey(c.row, c.col)) || isHoveredWell(c.row, c.col))) {
      return false;
    }
    if (!sampleVisible(c.row, c.col)) return false;
    if (c.dye === undefined) {
      return (
        c.channel !== undefined &&
        available.includes(c.channel) &&
        (meltChannels.has(c.channel) || isHoveredChannel(c.channel))
      );
    }
    const label = meltLabel(c);
    if (meltHiddenFluors.has(label) && !isHoveredTarget(label)) return false;
    // The same "Unloaded" switch the amplification view offers, for the same reason: a dye the
    // plate never put in this well still has a solved curve, and it is off by default.
    return (
      settings.showUnloadedFluors || (wellFluors.get(wellKey(c.row, c.col))?.has(c.dye) ?? false)
    );
  };

  const visibleMelt: MeltPlotCurve[] = useMemo(
    () =>
      (meltActive?.curves ?? []).filter(meltCurveVisible).map((c) => ({
        key: `${c.row},${c.col}|${c.dye ?? c.channel}`,
        dyeLabel: meltLabel(c),
        displayLabel: meltDisplayLabel(c),
        sample: wellSample.get(wellKey(c.row, c.col)),
        // The same hand-picked colour the amplification chart carries for this well, so 选色
        // repaints a well on both charts instead of only the one that happened to be on screen.
        color: settings.wellColors[wellKey(c.row, c.col)],
        curve: c,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      wellSample,
      meltActive,
      available,
      meltChannels,
      settings.enabledWells,
      meltHiddenFluors,
      settings.showUnloadedFluors,
      settings.disabledSamples,
      fluorViewMode,
      wellFluors,
      wellFluorTargets,
      hasNoTargetGroup,
      wellSample,
      hoverHighlight,
      settings.wellColors,
    ],
  );

  const meltRows = useMemo(
    () =>
      meltActive
        ? buildMeltRows(meltActive, meltCurveVisible, {
            targetOf: (row, col, dye) =>
              groupByTarget ? labelForFluorCurve(row, col, dye) : undefined,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      meltActive,
      available,
      meltChannels,
      settings.enabledWells,
      meltHiddenFluors,
      settings.showUnloadedFluors,
      settings.disabledSamples,
      fluorViewMode,
      wellFluors,
      wellFluorTargets,
      hasNoTargetGroup,
      wellSample,
    ],
  );

  const downloadMeltCsv = () =>
    downloadText(meltCsvFilename(zpcr.metadata.dataFile), meltCsv(meltRows), "text/csv");

  /**
   * The melt chart as an image: the curves on screen, redrawn for a file — dark ink on a
   * transparent background — and written as a TIFF, which a canvas cannot encode by itself
   * (`lib/figure/tiff.ts` has the why). The curves are `visibleMelt`, the same set the chart is
   * given, so the picture is the plot the user is looking at and not a different selection of it.
   *
   * The file's resolution is the screen's: the plot is drawn 1200 CSS px wide and uPlot renders
   * it at the display's pixel ratio, so a 2× Mac writes 2400 px and the 8-inch width the figure
   * is written for makes that 300 dpi — the number a journal asks for. A 1× display writes
   * 1200 px at 150 dpi, the same picture at half the samples.
   */
  const downloadMeltImage = () => {
    if (!melt || visibleMelt.length === 0) return;
    void renderMeltFigure({
      curves: visibleMelt,
      temperaturesC: melt.segment.temperaturesC,
      view: settings.meltView,
    })
      .then(({ canvas, dpi }) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const bytes = encodeTiff(
          {
            width: canvas.width,
            height: canvas.height,
            data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          },
          { dpi, software: "zpcrweb" },
        );
        downloadBytes(meltImageFilename(zpcr.metadata.dataFile), bytes, "image/tiff");
      })
      // A figure that fails to draw is a bug, not a user error — say so in the console rather
      // than swallow it, and leave the button usable for the next try.
      .catch((err: unknown) => console.error("melt image export failed", err));
  };

  /** The amplification plot as a TIFF figure — the same curves, ink and threshold rule the window
   * is showing, at 300 dpi on a transparent background (see `curveFigure.ts`). */
  const downloadCurveImage = () => {
    if (plotCurves.length === 0) return;
    const threshold =
      settings.curveView === "relative" ? (hoverThresholdValue ?? standingThresholdValue) : null;
    void renderCurveFigure({
      wellCurves: plotCurves,
      darkCurves: !calibrationOn && settings.showDark ? enabledDark : NO_DARK_CURVES,
      factoryCurves: [],
      drawFactory: false,
      aux: rightAxis,
      baseline: "raw",
      curveView: settings.curveView,
      drawBaseline: settings.drawBaseline,
      scale: settings.scale,
      thresholdLine: threshold,
      drawCqRings: calibrationOn,
    })
      .then(({ canvas, dpi }) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const bytes = encodeTiff(
          {
            width: canvas.width,
            height: canvas.height,
            data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          },
          { dpi, software: "zpcrweb" },
        );
        downloadBytes(curveImageFilename(zpcr.metadata.dataFile), bytes, "image/tiff");
      })
      .catch((err: unknown) => console.error("curve image export failed", err));
  };

  /** The rail's hover peek, in the shape the melt chart takes. Wells and channels in channel
   * space; a fluor/target chip resolves to the label its lines carry. */
  const meltHighlight: MeltHighlight | null =
    hoverHighlight?.kind === "wells"
      ? { kind: "wells", labels: hoverHighlight.labels }
      : hoverHighlight?.kind === "channel"
        ? { kind: "channel", channel: hoverHighlight.channel }
        : hoverHighlight?.kind === "target"
          ? { kind: "target", dyeLabel: hoverHighlight.dyeLabel }
          : null;

  /** `raw` empty clears the override, putting the group back on the auto threshold. Values are
   * rounded to whole RFU to match what the input displays and steps by. */
  const setThresholdOverride = (group: string, raw: string) => {
    const next = new Map(settings.thresholdOverrides);
    const value = Number(raw);
    if (raw === "" || !Number.isFinite(value)) next.delete(group);
    else next.set(group, Math.round(value));
    onChange({ thresholdOverrides: next });
  };

  /**
   * Dragging the dotted threshold line in the plot writes exactly what the rail's number box
   * writes — a per-fluorophore override — for every fluorophore that line stands for. With the one
   * dye these runs use that is all of them; with several, the line is only drawn when they share a
   * threshold, and those are the ones it moves.
   */
  const dragThresholdLine = (value: number) => {
    const groups = thresholdGroups.filter((g) => dyeSpace || g.curve);
    if (groups.length === 0) return;
    const line = standingThresholdValue;
    const under = groups.filter((g) => {
      const t = groupThresholds.get(g.fluor);
      return line != null && t != null && Math.abs(t - line) < 0.5;
    });
    const targets = under.length > 0 ? under : groups;
    const next = new Map(settings.thresholdOverrides);
    for (const g of targets) next.set(g.fluor, Math.round(value));
    onChange({ thresholdOverrides: next });
  };

  /** The same, one curve at a time — `raw` empty drops back to the fluorophore's threshold. */
  const setCurveThresholdOverride = (key: string, raw: string) => {
    const next = new Map(settings.curveThresholdOverrides);
    const value = Number(raw);
    if (raw === "" || !Number.isFinite(value)) next.delete(key);
    else next.set(key, Math.round(value));
    onChange({ curveThresholdOverrides: next });
  };

  /**
   * Hovering a fluorophore's row in the Threshold section: isolate its curves and draw a dotted
   * line at its threshold — and nothing else. The per-curve baseline-region/σ overlay stays off
   * here; a dozen wells' worth of it at once was unreadable, and it's a curve at a time that the
   * region actually explains anything. `null` clears the hover.
   *
   * In channel mode there is no dye-space curve to isolate, and the threshold is a level on the
   * separated curve rather than on the raw channel one — so highlight the fluor's own channel
   * instead and draw no line.
   */
  const hoverThresholdGroup = (g: ThresholdGroupRow | null) => {
    if (!g) {
      setHoverHighlight(null);
      setHoverThreshold(null);
      return;
    }
    setHoverHighlight(
      calibrationOn
        ? { kind: "fluor", fluor: g.fluor }
        : g.channel != null
          ? { kind: "channel", channel: g.channel }
          : null,
    );
    setHoverThreshold(calibrationOn ? { fluor: g.fluor, regions: false } : null);
  };

  /** Hovering one curve's row: isolate that single curve, mark the threshold *it* is measured
   * against (its own override, when it has one), and add the baseline-region/σ overlay — the
   * diagnostic that explains where that curve's noise came from. */
  const hoverThresholdCurve = (g: ThresholdGroupRow, c: ThresholdCurveRow) => {
    setHoverHighlight(
      calibrationOn
        ? { kind: "curve", label: c.wellLabel, fluor: g.fluor }
        : { kind: "wells", labels: [c.wellLabel] },
    );
    setHoverThreshold(calibrationOn ? { fluor: g.fluor, curveKey: c.key, regions: true } : null);
  };

  /**
   * Dragging a Cq ring on the chart (see `CurveChart`'s `onCqDrag`) is the same edit as typing in
   * that curve's Threshold row, so it *opens that row* rather than editing invisibly: the rail's
   * Threshold section is forced open, the curve's fluorophore group expanded, the row scrolled into
   * view and marked — and the row's own field then tracks the drag, since it renders whatever
   * override is current. The chart shows the same edit from the other side: the hover state below
   * draws the dotted threshold line and the curve's baseline-region diagnostic for as long as the
   * drag lasts.
   */
  const thresholdDetailsRef = useRef<HTMLDetailsElement>(null);
  const [revealThresholdCurve, setRevealThresholdCurve] = useState<{
    fluor: string;
    key: string;
  } | null>(null);

  const beginCqDrag = (t: CqDragTarget) => {
    const key = curveKey(t.row, t.col, t.fluor);
    // Imperative rather than a controlled `open` prop: the section is a plain <details> the user
    // opens and closes themselves, and forcing it open is a one-off nudge, not ownership of its
    // state — closing it after the drag would throw away a deliberate open.
    if (thresholdDetailsRef.current) thresholdDetailsRef.current.open = true;
    setRevealThresholdCurve({ fluor: t.fluor, key });
    setHoverHighlight({ kind: "curve", label: t.wellLabel, fluor: t.fluor });
    setHoverThreshold({ fluor: t.fluor, curveKey: key, regions: true });
  };

  const dragCq = (t: CqDragTarget, threshold: number) =>
    setCurveThresholdOverride(curveKey(t.row, t.col, t.fluor), String(threshold));

  const endCqDrag = () => {
    setRevealThresholdCurve(null);
    setHoverHighlight(null);
    setHoverThreshold(null);
  };

  /** The RFU the hovered Threshold row currently stands at, read fresh out of `thresholdRows` so
   * an edit to that row's own input (or to the auto-threshold multiplier feeding it) moves the
   * chart's dotted line with it. `null` when nothing is hovered, or when the hovered row has no
   * threshold — a group whose curves all failed to produce one. */
  /**
   * The threshold every enabled curve shares, drawn as a standing line the way CFX draws one for
   * the whole plot — `null` when the plot mixes groups whose thresholds differ, or when nothing
   * produced one, so a single line never claims to be the threshold of curves it isn't.
   * The hover line (see `hoverThresholdValue`) still takes precedence while a Threshold row is
   * being edited.
   */
  const standingThresholdValue = useMemo(() => {
    const values = [...new Set([...groupThresholds.values()].filter((v) => Number.isFinite(v)))];
    return values.length === 1 ? values[0]! : null;
  }, [groupThresholds]);

  const hoverThresholdValue = useMemo(() => {
    if (!hoverThreshold) return null;
    const group = thresholdRows.find((g) => g.fluor === hoverThreshold.fluor);
    if (!group) return null;
    if (hoverThreshold.curveKey == null) return group.threshold ?? null;
    return group.curves.find((c) => c.key === hoverThreshold.curveKey)?.threshold ?? null;
  }, [hoverThreshold, thresholdRows]);

  /**
   * Commit the window once both ends are usable. A half-typed or nonsensical pair (an end at or
   * before its start) stays in the inputs and is not pushed to the analysis — the run keeps
   * whatever window it already had, so nothing flickers while a number is being typed.
   */
  const commitBaselineWindow = (next: { begin: string; end: string }) => {
    setWinDraft(next);
    // Emptying both ends is how "back to the file's own window" is expressed: there is no
    // separate reset button, so clearing the pair is the gesture that means auto.
    if (next.begin.trim() === "" && next.end.trim() === "") {
      onChange({ baselineWindow: null });
      return;
    }
    const begin = Number.parseInt(next.begin, 10);
    const end = Number.parseInt(next.end, 10);
    if (!Number.isFinite(begin) || !Number.isFinite(end) || begin < 1 || end <= begin) return;
    onChange({ baselineWindow: { beginCycle: begin, endCycle: end } });
  };

  const logBaselined = settings.scale === "log" && settings.curveView === "relative";

  return (
    <div className={"curves" + (railOpen ? " is-railopen" : "")}>
      <button
        type="button"
        className="curves__railtoggle"
        aria-expanded={railOpen}
        aria-controls="curves-rail"
        onClick={() => setRailOpen((open) => !open)}
      >
        ☰ Settings
      </button>
      {railOpen && (
        <div className="curves__scrim" onClick={() => setRailOpen(false)} />
      )}
      <aside className="curves__rail" id="curves-rail">
        {steps.length > 1 && (
          <div className="rail__section">
            <div className="rail__title">Plate-read step</div>
            <div className="segmented segmented--sm stepsel">
              {steps.map((s, i) => (
                <button
                  key={s.step}
                  className={
                    "segmented__item" + (s.step === activeStep ? " is-active" : "")
                  }
                  onClick={() => onChange({ step: s.step })}
                  title={
                    stepMelt(s.step)
                      ? `Melt curve — ${s.readCount} reads from ${fmtTemp(stepMelt(s.step)!.startTempC)} to ${fmtTemp(stepMelt(s.step)!.endTempC)} °C`
                      : `Protocol STEP ${s.step}, ${s.readCount} cycles`
                  }
                >
                  {stepMelt(s.step) ? `Melt · ${s.readCount}` : `${i} · ${s.readCount}c`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* The baseline stage (CFX's Baseline menu): which correction, over which cycles, and
            whether the residual drift inside that window goes too. Everything here changes the
            numbers — the Cq table is recomputed on every keystroke — so it sits next to Threshold
            rather than with the view-only switches. "Auto" puts the window back under the file's
            own `baselineBeginRepeat`/`baselineEndRepeat`, which is what `runAnalysis` honours by
            default; typing one pins it for this app only. */}
        {!meltMode && cycleCount > 0 && (
          <details className="rail__section rail__details">
            <summary className="rail__title">
              <span>
                <span className="rail__chevron" aria-hidden="true">
                  ▸
                </span>
                Baseline
              </span>
              <span className="rail__value">
                {windowSummary(settings.baselineWindow, declaredWindow, settings.baselineRule === "cfx")}
              </span>
            </summary>
            <label className="analysis__field">
              <span>Method</span>
              <select
                value={settings.baselineMode ?? "LinearBaseLineNormalized"}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  onChange({
                    baselineMode: v === "LinearBaseLineNormalized" ? null : (v as BaselineMode),
                  });
                }}
              >
                <option value="LinearBaseLineNormalized">Linear normalized (default)</option>
                <option value="RawBaseLineSubtracted">Constant (region mean)</option>
                <option value="Raw">None</option>
              </select>
            </label>
            <div className="analysis__field">
              <span>Cycles</span>
              <div className="baseline__window">
                <input
                  type="number"
                  min={1}
                  max={cycleCount}
                  value={winDraft.begin}
                  placeholder={declaredWindow ? String(declaredWindow.beginCycle) : "1"}
                  aria-label="First cycle of the baseline window"
                  onChange={(e) =>
                    commitBaselineWindow({ begin: e.currentTarget.value, end: winDraft.end })
                  }
                />
                <span className="mono">–</span>
                <input
                  type="number"
                  min={2}
                  max={cycleCount}
                  value={winDraft.end}
                  placeholder={declaredWindow ? String(declaredWindow.endCycle) : String(cycleCount)}
                  aria-label="Last cycle of the baseline window"
                  onChange={(e) =>
                    commitBaselineWindow({ begin: winDraft.begin, end: e.currentTarget.value })
                  }
                />
                <button
                  type="button"
                  className="rail__link baseline__auto"
                  onClick={() => commitBaselineWindow({ begin: "", end: "" })}
                  disabled={!settings.baselineWindow}
                >
                  自动
                </button>
              </div>
              <span className="rail__hint">
                {settings.baselineWindow
                  ? `手动 ${settings.baselineWindow.beginCycle}–${settings.baselineWindow.endCycle} 循环：与原版 Baseline Threshold 对话框里的 User Defined 相同`
                  : `自动：用文件里 CFX 声明的 ${declaredWindow ? `${declaredWindow.beginCycle}–${declaredWindow.endCycle}` : "默认"} 循环；直接改上面的两个数就是手动`}
              </span>
            </div>
            <div className="rail__row">
              <Switch
                label="Drift correction"
                checked={settings.baselineDriftCorrection}
                onChange={(v) => onChange({ baselineDriftCorrection: v })}
                title="Also subtract the linear drift left inside the baseline window"
              />
            </div>
            {/* CFX places each well's baseline from that well's own Cq — a window that stops a few
                cycles before it — rather than from the window a `.pcrd` persists. Against its Cq at
                a *fixed* threshold that is worth 0.45 → 0.11 cycles of agreement; against its
                automatic threshold the declared window wins, because the threshold then moves with
                the curve. Both are offered, and the cycle boxes above still override either. */}
            <div className="rail__row">
              <Switch
                label="Per-well window"
                checked={settings.baselinePerWell}
                onChange={(v) => onChange({ baselinePerWell: v })}
                title="Fit each well's baseline over its own cycles (stops 4 before its Cq), like CFX, instead of the window the file declares"
              />
            </div>
            <span className="rail__hint">
              {settings.baselinePerWell
                ? "逐孔窗口：用每孔自己 Cq 前的循环拟合基线"
                : "文件窗口：用板里声明的循环 —— 原版自动阈值时更接近（实测平均差 0.077 循环）"}
            </span>
          </details>
        )}

        {(plateEntry || meltMode) && (
          <div className="rail__section">
            {/* One View toggle for both kinds of step. A melt swaps what each mode *contains* —
                melt curves and melting temperatures rather than amplification curves and Cq — but
                the four modes mean the same four things, so there is one control rather than a
                second one that appears when the step changes.

                It shows for a melt even with no readable plate: a melt's channel curves and its
                Tm table need neither a plate nor a password (`melt.md` §1), and the committed melt
                run is exactly that case. For an amplification step there is nothing to choose
                until the plate opens, so the prompt below stands in its place. */}
            {(meltMode ||
              !(
                plateEntry?.pltd.container.encrypted &&
                (plateEntry.pltd.needsPassword || plateEntry.pltd.error)
              )) && (
              <>
              <div className="rail__row">
                {/* "Table" is a fourth option here rather than a tab of its own: it shows the
                    same run, grouped by target like "Target" mode, as a Cq/ΔRFU table instead of
                    a chart — a melt's melting temperatures instead of a melt chart — with the
                    whole rail (wells, targets, samples, background, thresholds) still driving
                    it. */}
                <Toggle
                  label="View"
                  options={[
                    ["curve", "Curve"],
                    ["table", "Table"],
                  ]}
                  value={tableMode ? "table" : "curve"}
                  onChange={(v) =>
                    v === "table"
                      ? onChange({ calibration: true, fluorViewMode: "table" })
                      : onChange({
                          calibration: true,
                          fluorViewMode: fluorViewMode === "table" ? "target" : fluorViewMode,
                        })
                  }
                />
              </div>
              {/* Channel / Fluorophore / Target used to be three peer modes of the switch above.
                  They are one panel now — the same run grouped three ways — so they live here,
                  under the chart they change, and every one of them still works: "Channel" turns
                  calibration off (`calibration: false`), the other two turn it on with their
                  own grouping. */}
              {!tableMode && (
              <div className="rail__row">
                <Toggle
                  label="Group"
                  options={[
                    ["channel", "Channel"],
                    ["fluorophore", "Fluorophore"],
                    ["target", "Target"],
                  ]}
                  value={calibrationOn ? (fluorViewMode === "fluorophore" ? "fluorophore" : "target") : "channel"}
                  onChange={(v) =>
                    v === "channel"
                      ? onChange({ calibration: false })
                      : onChange({ calibration: true, fluorViewMode: v as FluorViewMode })
                  }
                />
              </div>
              )}
              </>
            )}
            {plateEntry?.pltd.container.encrypted &&
            (plateEntry.pltd.needsPassword || plateEntry.pltd.error) ? (
              <PasswordPrompt
                wrong={!!plateEntry.pltd.error}
                onSubmit={setPltdPassword}
              />
            ) : plateEntry?.pltd.error ? (
              <div className="rail__note mono">{plateEntry.pltd.error}</div>
            ) : (
              <>
                {/* Where a "Normalization" toggle used to sit. It was a no-op by construction:
                    calibration.md §5.1 divides the column scaling back out, so every mode
                    reports identical RFU unless the matrix is rank-deficient. The setting still
                    exists (see FileSettings) — it just isn't a user-facing choice. */}
                {calibrationOn && !dyeSpace && !calibrationAvailable && (
                  <div className="rail__note mono">
                    No .Dcal calibration matches this plate's fluorophores for {vessels}. Check
                    the Calibration files under Raw files.
                  </div>
                )}
                {calibrationOn &&
                  !dyeSpace &&
                  calibrationAvailable &&
                  fluorCals.some((f) => !f.curve) && (
                    <div className="rail__note mono">
                      No {vessels} calibration for:{" "}
                      {fluorCals
                        .filter((f) => !f.curve)
                        .map((f) => f.fluor)
                        .join(", ")}
                      .
                    </div>
                  )}
              </>
            )}
          </div>
        )}

        {/* Wells sits directly under View: it's the selection the eye reaches for first, and the
            plate grid doubles as a map of which wells came out positive. */}
        <div className="rail__section">
          <div className="rail__title">
            Wells
            {/* Sample-type shortcuts sit in the heading, between the section's name and its
                reset: they are the same selection the grid below holds, addressed a faster way. */}
            <WellTypeBar
              groups={wellTypeGroups}
              enabled={settings.enabledWells}
              onToggle={toggleWellType}
              onSolo={(g) => soloWells(g.keys)}
              onHover={(g) => setHoverHighlight(g ? { kind: "wells", labels: g.labels } : null)}
            />
            <button
              className={"rail__link" + (colorMode ? " is-on" : "")}
              onClick={() => {
                setColorMode((on) => !on);
                if (colorMode) setColorSel(new Set());
              }}
              title={
                colorMode
                  ? "退出选色（曲线保持当前颜色）"
                  : "进入选色：点孔或拖动选一批曲线，再挑颜色"
              }
            >
              选色
            </button>
            <button
              className="rail__link rail__icon-btn"
              onClick={resetWells}
              title="Reset to the wells present in the plate definition"
            >
              <ResetIcon />
            </button>
          </div>
          <WellMatrix
            rows={plateRows}
            cols={plate?.columns ?? 12}
            enabled={settings.enabledWells}
            onChange={(next) => onChange({ enabledWells: next })}
            wellTypes={wellTypes}
            positiveWells={positiveWells}
            onHoverWells={(labels) => setHoverHighlight(labels ? { kind: "wells", labels } : null)}
            onSoloWells={soloWells}
            cardData={cardForWell}
            peekWells={peekWells}
            selected={colorSel}
            onSelectedChange={setColorSel}
            selectMode={colorMode}
          />
        </div>

        {/* One dye on one channel is not a choice: the section would hold a single chip that is
            always on, paying a whole rail block to say nothing. Runs with a real choice (a
            multiplex plate, or channel space with several channels read) keep it. */}
        {(dyeChips ? visibleChipItems.length : available.length) > 1 && (
        <div className="rail__section">
          <div className="rail__title">
            {!dyeChips
              ? "Channels"
              : groupByTarget && usingTargets
                ? "Targets"
                : "Fluorophores"}
            <button
              className="rail__link rail__icon-btn"
              onClick={!dyeChips ? resetChannels : resetFluors}
              title={
                meltMode
                  ? "Reset to the channel a melt is read on"
                  : !dyeChips
                    ? "Reset to the channels present in the plate configuration"
                    : "Re-enable all"
              }
            >
              <ResetIcon />
            </button>
          </div>
          {dyeChips ? (
            <>
              <FluorBar
                items={visibleChipItems}
                disabled={seriesHiddenFluors}
                onToggle={toggleFluor}
                onHover={(key) => setHoverHighlight(key ? { kind: "target", dyeLabel: key } : null)}
                onSolo={soloFluor}
                cardData={cardForDyeLabel}
              />
              <div className="rail__row" style={{ marginTop: 8 }}>
                <Switch
                  label="Unloaded"
                  checked={settings.showUnloadedFluors}
                  onChange={(v) => onChange({ showUnloadedFluors: v })}
                  title="Draw curves for every enabled well, even ones the plate configuration doesn't load this fluor/target into"
                />
              </div>
            </>
          ) : (
            <ChannelBar
              enabled={seriesChannels}
              available={available}
              onToggle={toggleChannel}
              onHover={(ch) => setHoverHighlight(ch != null ? { kind: "channel", channel: ch } : null)}
              onSolo={soloChannel}
              cardData={cardForChannel}
            />
          )}
        </div>
        )}

        {visibleSampleList.length > 0 && (
          <details className="rail__section rail__details">
            <summary className="rail__title">
              <span>
                <span className="rail__chevron" aria-hidden="true">
                  ▸
                </span>
                Samples
              </span>
              {/* The same reset glyph as Channels/Targets and Wells — one button meaning "back to
                  the default" throughout the rail, rather than a label that changes under the
                  cursor. */}
              <button
                className="rail__link rail__icon-btn"
                title="Re-enable all samples"
                aria-label="Re-enable all samples"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ disabledSamples: new Set<string>() });
                }}
              >
                <ResetIcon />
              </button>
            </summary>
            <SampleBar
              items={visibleSampleList}
              disabled={settings.disabledSamples}
              onToggle={toggleSample}
              onHover={(sample) => setHoverHighlight(sample ? { kind: "sample", sample } : null)}
              onSolo={soloSample}
              cardData={cardForSample}
            />
          </details>
        )}

        {meltMode && !tableMode && (
          <div className="rail__section rail__row">
            {/* Same slot, same label as the amplification "Values" toggle below — what the y axis
                reads, and nothing about which curves are shown (that is View, above). The
                derivative is the default: it is the form a melting product is a peak on, and the
                melting temperature is that peak's position. */}
            <Toggle
              label="Values"
              options={[
                ["derivative", "−dF/dT"],
                ["raw", "Raw"],
              ]}
              value={settings.meltView}
              onChange={(v) => onChange({ meltView: v as MeltView })}
            />
          </div>
        )}

        {/* Chart-only controls — nothing they change is visible in table mode. */}
        {!meltMode && !tableMode && (
          <>
            <div className="rail__section rail__row">
              {/* "Values", not "View": the mode toggle above is already labelled View, and these
                  two answer different questions — which curves, vs. what the y-axis reads. */}
              <Toggle
                label="Values"
                options={[
                  ["relative", "Relative"],
                  ["absolute", "Absolute"],
                ]}
                value={settings.curveView}
                onChange={(v) => onChange({ curveView: v as CurveView })}
              />
            </div>

            <div className="rail__section rail__row">
              <Switch
                label="Draw baseline"
                checked={settings.drawBaseline}
                onChange={(v) => onChange({ drawBaseline: v })}
                title="Overlay each curve's auto-detected linear baseline at 50% opacity"
              />
            </div>


            {/* Channel-space overlays, each on its own row like "Draw baseline" above rather than
                trailing the Scale toggle — they are switches, not modes, and a switch beside a
                segmented control wraps unevenly at rail width. */}
            {!calibrationOn && (
              <>
                <div className="rail__section rail__row">
                  <Switch
                    label="Show dark"
                    checked={settings.showDark}
                    onChange={(v) => onChange({ showDark: v })}
                    title="Overlay each channel's LED-off dark background as a dotted line"
                  />
                </div>
                <div className="rail__section rail__row">
                  <Switch
                    label="Min/max band"
                    checked={settings.bands}
                    onChange={(v) => onChange({ bands: v })}
                    title="Shade each curve's per-cycle min/max envelope"
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* Filter by Cq — dye space only, for the same reason the Cq table itself is dye-space
            only (see `channelAnalysis`): a raw channel curve has no Cq to filter on. Grouped with
            "Subtract dark" below rather than with the chart-only display controls because, like
            it, it applies in table mode too — it's a selection filter, the same kind as the wells
            and chips above, and it feeds the table and the CSV export exactly as they do. */}
        {!meltMode && calibrationOn && cycleCount > 0 && (
          <div className="rail__section">
            <CqRange
              cycleCount={cycleCount}
              cqMin={settings.cqMin}
              cqMax={settings.cqMax}
              onChange={onChange}
            />
          </div>
        )}

        {/* Only a source that carries its own analysis (currently Biomeme — `Zpcr.dyeSpace`,
            `WellCurve.fileAnalysis`) has anything for these to switch between; a `.zpcr`/`.pcrd`
            run never shows them. Two independent toggles, not one: a user may want the instrument's
            own Cq call while still inspecting this app's baseline fit, or the reverse — see
            `runAnalysis.ts`'s `blendWithFileAnalysis`. Shown in every view mode, like Threshold
            below, since both act on the one Cq table every view reads. */}
        {!meltMode && hasFileAnalysis && (
          <div className="rail__section">
            <div className="rail__row">
              <Toggle
                label="Baseline"
                options={[
                  ["file", "File"],
                  ["computed", "Computed"],
                ]}
                value={settings.baselineSource}
                onChange={(v) => onChange({ baselineSource: v as AnalysisSource })}
              />
            </div>
            <div className="rail__row" style={{ marginTop: 8 }}>
              <Toggle
                label="Cq"
                options={[
                  ["file", "File"],
                  ["computed", "Computed"],
                ]}
                value={settings.cqSource}
                onChange={(v) => onChange({ cqSource: v as AnalysisSource })}
              />
            </div>
          </div>
        )}

        {/* Cq is always threshold.md §6's threshold crossing (there is no algorithm selector any
            more), so a per-group threshold is always meaningful. An override applies to the whole
            run's Cq table — chart markers, hover cards and table alike.

            Shown in **every** view mode, channel space included. Thresholds are always
            target-based (or fluorophore-based on a plate with no targets — see `usingTargets`);
            channel mode doesn't get thresholds of its own, it gets the same target thresholds,
            because that's what the run's one Cq table is keyed on. It used to be hidden there,
            which made the multiplier below silently move the channel chart's Cq markers with no
            visible cause. */}
        {!meltMode && calibrationAvailable && (
          <details className="rail__section rail__details" ref={thresholdDetailsRef}>
            <summary className="rail__title">
              <span>
                <span className="rail__chevron" aria-hidden="true">
                  ▸
                </span>
                Threshold
              </span>
            </summary>
            <ThresholdSection
              groups={thresholdRows}
              revealCurve={revealThresholdCurve}
              autoThresholdMethod={settings.autoThresholdMethod}
              onAutoThresholdMethodChange={(v) => onChange({ autoThresholdMethod: v })}
              multiplier={settings.thresholdMultiplier}
              onMultiplierChange={(v) => onChange({ thresholdMultiplier: v })}
              cqMethod={settings.cqMethod}
              onCqMethodChange={(v) => onChange({ cqMethod: v })}
              onGroupOverride={setThresholdOverride}
              onCurveOverride={setCurveThresholdOverride}
              onHoverGroup={hoverThresholdGroup}
              onHoverCurve={hoverThresholdCurve}
            />
          </details>
        )}

        {/* Always present — the export is the same target-based Cq/ΔRFU table in every view mode,
            so there's no mode you have to switch to first. Disabled, not hidden, when the run has
            no rows to export (no usable calibration, or the rail filtered everything out). */}
        <div className="rail__section">
          <div className="rail__row">
            {meltMode ? (
              <button
                className="raw__download analysis__download"
                onClick={downloadMeltCsv}
                disabled={meltRows.length === 0}
                aria-label="Download the melting-temperature table as CSV"
                title="Download the melting-temperature table as CSV"
              >
                <DownloadIcon /> CSV
              </button>
            ) : (
              <button
                className="raw__download analysis__download"
                onClick={downloadCsv}
                disabled={tableRows.length === 0}
                aria-label="Download the Cq/ΔRFU table as CSV"
                title="Download the Cq/ΔRFU table as CSV"
              >
                <DownloadIcon /> CSV
              </button>
            )}
            {/* The melt chart as a picture, on a transparent background — the paper-like version
                of what is on screen, not a screenshot of it. Offered only where the chart is what
                is on screen: in table mode there is no plot to save, and the table has its own
                CSV. */}
            {meltMode && !tableMode && (
              <button
                className="raw__download analysis__download"
                onClick={downloadMeltImage}
                disabled={visibleMelt.length === 0}
                aria-label="Download the melting curves as a TIFF image"
                title="Download the melting curves as a TIFF image (transparent background)"
              >
                <ImageIcon /> TIFF
              </button>
            )}
            {/* The amplification plot as a picture; the same 300 dpi, transparent-background figure
                the melt chart already exports. Same rule about when it shows: the chart has to be
                the thing on screen — no plot in table mode, and none while a melt is displayed. */}
            {!meltMode && !tableMode && (
              <button
                className="raw__download analysis__download"
                onClick={downloadCurveImage}
                disabled={plotCurves.length === 0}
                aria-label="Download the amplification curves as a TIFF image"
                title="Download the amplification curves as a TIFF image (transparent background)"
              >
                <ImageIcon /> TIFF
              </button>
            )}
          </div>
        </div>

        <div className="rail__stat mono">
          {meltMode ? (
            <>
              {tableMode
                ? `${meltRows.length} rows`
                : `${visibleMelt.length} / ${(meltActive ?? melt).curves.length} curves`}
              {" · "}
              {meltRows.filter((r) => r.tmC != null).length} with a Tm
            </>
          ) : tableMode ? (
            <>{tableRows.length} rows</>
          ) : (
            <>
              {plotCurves.length} / {calibrationOn ? allFluorCurves.length : allCurves.length}{" "}
              curves
              {!calibrationOn && settings.showDark && " + dark"}
            </>
          )}
        </div>
        {!meltMode && !tableMode && logBaselined && (
          <div className="rail__note mono">
            Log + baseline: all curves shifted alike so the plot's minimum reads 1.
          </div>
        )}
      </aside>

      {meltMode ? (
        tableMode ? (
          <section className="analysis__table-wrap">
            <MeltTable
              rows={meltRows}
              seriesLabel={
                !meltInDyeSpace ? "Channel" : groupByTarget && usingTargets ? "Target" : "Fluorophore"
              }
              onPickWell={pickWell}
            />
          </section>
        ) : (
          <section className="curves__plot curves__plot--melt">
            <MeltChart
              curves={visibleMelt}
              temperaturesC={melt.segment.temperaturesC}
              view={settings.meltView}
              highlight={meltHighlight}
              onHoverWell={setHoveredChartWell}
            />
          </section>
        )
      ) : tableMode ? (
        <section className="analysis__table-wrap">
          {/* Two ways to read the same numbers, above the data rather than in the rail: the plate
              grid is the instrument's own arrangement (and what gets pasted into a spreadsheet),
              the detail table is the sortable one. The choice is a reading habit, not a property
              of the run, so it lives here in local state and never reaches the settings file. */}
          <div className="cqbar">
            <Toggle
              label="排列"
              value={tableLayout}
              onChange={(v) => setTableLayout(v === "rows" ? "rows" : "plate")}
              options={[
                ["plate", "板图"],
                ["rows", "明细表"],
              ]}
            />
            <div className="cqbar__spacer" />
            <button
              type="button"
              className="raw__download analysis__download"
              onClick={downloadCqPlate}
              disabled={tableRows.length === 0}
              aria-label="Export the Cq plate layout as CSV"
              title="Export the Cq values as a plate-shaped CSV (rows A–H × columns 1–12)"
            >
              <DownloadIcon /> 导出 Cq
            </button>
            {/* CFX's own Cq, imported from its Cq export, shown beside ours in the table. Nothing
                downstream reads it — it exists so the two numbers can be compared without a
                spreadsheet round trip. */}
            <button
              type="button"
              className="raw__download analysis__download"
              onClick={() => cfxInputRef.current?.click()}
              title="读取 CFX 导出的 Cq CSV（Quantification Cq Results），在表格里与原版逐孔对照"
            >
              <UploadIcon /> {settings.cfxCq ? "重导原版 Cq" : "导入原版 Cq"}
            </button>
            {cfxNote && <span className="analysis__note">{cfxNote}</span>}
            <input
              ref={cfxInputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={importCfxCq}
            />
          </div>
          {tableLayout === "plate" ? (
            <CqPlate rows={tableRows} onPickWell={pickWell} />
          ) : (
            <CurveTable
              rows={tableRows}
              usingTargets={usingTargets}
              cycleCount={cycleCount}
              cfxCq={settings.cfxCq}
              onPickWell={pickWell}
              onPickTarget={pickTarget}
              onPickSample={pickSample}
              onPickCurve={pickCurve}
            />
          )}
        </section>
      ) : (
        <section className="curves__plot">
          {/* CFX puts Log Scale in the corner of the plot itself, and it is a view toggle rather
              than an analysis setting — nothing it changes reaches the Cq table — so it sits over
              the chart rather than in the rail. The checkboxes it renders are the same `Toggle`
              the rail uses, just laid out flat: one row, no label above. */}
          {(colorMode || colorSel.size > 0) && (
            <div className="plot__colors">
              <span className="plot__colorslabel mono">
                {colorSel.size > 0 ? `${colorSel.size} 个孔已选中` : "在左侧点孔选中曲线"}
              </span>
              {CURVE_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  className="plot__swatch"
                  style={{ background: c.hex }}
                  title={`把选中曲线改成${c.name}`}
                  aria-label={`把选中曲线改成${c.name}`}
                  onClick={() => paintSelectedWells(c.hex)}
                />
              ))}
              <button
                type="button"
                className="plot__colorsbtn"
                onClick={() => paintSelectedWells(null)}
                title="把选中曲线交还给通道配色"
              >
                恢复默认
              </button>
              <button
                type="button"
                className="plot__colorsbtn"
                onClick={() => {
                  setColorSel(new Set());
                  setColorMode(false);
                }}
                title="结束选色（曲线保持当前颜色）"
              >
                完成
              </button>
            </div>
          )}
          <div className="plot__scale">
            <Toggle
              label="Scale"
              options={[
                ["linear", "Linear"],
                ["log", "Log"],
              ]}
              value={settings.scale}
              onChange={(v) => onChange({ scale: v as Scale })}
            />
          </div>
          <CurveChart
            curves={plotCurves}
            darkCurves={!calibrationOn && settings.showDark ? enabledDark : NO_DARK_CURVES}
            aux={rightAxis}
            baseline="raw"
            curveView={settings.curveView}
            drawBaseline={settings.drawBaseline}
            scale={settings.scale}
            bands={!calibrationOn && settings.bands}
            highlight={hoverHighlight}
            thresholdLine={
              settings.curveView === "relative"
                ? (hoverThresholdValue ?? (calibrationOn ? standingThresholdValue : null))
                : null
            }
            thresholdRegions={settings.curveView === "relative" && !!hoverThreshold?.regions}
            onCqDragStart={beginCqDrag}
            // Channel space has no per-curve threshold to set — and no Cq rings either (see
            // `channelAnalysis`) — so the handles are simply absent there. Nor under a Cq method
            // other than the threshold crossing: the ring then sits below the threshold, at the
            // refined Cq, so the pointer's height would no longer be the threshold it sets.
            onCqDrag={calibrationOn && settings.cqMethod === DEFAULT_CQ_METHOD ? dragCq : undefined}
            // CFX lets you grab the threshold line; so does this. The line only exists in the
            // baseline-subtracted view, and only dye space has a threshold to move.
            onThresholdDrag={
              calibrationOn && settings.curveView === "relative" ? dragThresholdLine : undefined
            }
            onCqDragEnd={endCqDrag}
            onHoverWell={setHoveredChartWell}
          />
        </section>
      )}
    </div>
  );
}
