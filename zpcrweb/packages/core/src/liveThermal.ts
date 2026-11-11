/**
 * The live block-temperature trace, and filling the holes in it from the run's own `.alf` report.
 *
 * A run's live trace is built from `STATUS?` polls (`usb.md` §3.2), so it only covers the time
 * something was polling. Two ordinary events leave holes in it: **connecting after the run began**
 * (a page reload, or the cable only plugged in mid-run), and **the host going to sleep** while the
 * run carries on without it. Joined point to point, either draws a straight line across minutes of
 * cycling the block never did.
 *
 * The instrument does keep its own record of what the block did — the `.alf` run report
 * (`alf.md`), one line per executed step with its setpoint and the wall-clock second it began —
 * and {@link alfThermalProfile} already turns one into a trace. So the rule here is:
 *
 * 1. **Find the gaps** ({@link findThermalGaps}) — a run found already well past its start, or two
 *    consecutive polls far apart on the host's clock as well as the run's.
 * 2. **Fetch the report and check it is this run's** ({@link gapFillFromAlf}) — the running run's
 *    name, and *not* a finished report, since a run still going cannot have ended.
 * 3. **Put the report on the poll's clock.** The two clocks differ by the lid preheat: `STATUS?`'s
 *    elapsed holds at 0 until the preheat ends (`usb.md` §7.4), while the report's first step is
 *    stamped before it (`usb.md` §7.6). Neither side states that offset, so it is *measured*: each
 *    step the polls watched begin, keyed by (step number, cycle), is looked up in the report, and
 *    the median difference is the offset ({@link alfElapsedOffset}).
 * 4. **Draw the report's profile inside the gaps only**, clipped to them ({@link clipPolyline}) —
 *    the polls stay the authority wherever there are polls.
 *
 * > **Unmeasured:** whether the instrument writes the report *during* a run at all. It has only
 * > ever been listed after one ended (`usb.md` §5.2), and its header carries the end time. A gap
 * > probe that finds nothing is the expected outcome until a recording says otherwise — and the
 * > probe's listing lands in the USB traffic log, which is how one will.
 */
import { alfThermalProfile, type AlfReport } from "./alf.js";

/** One `STATUS?` poll of a running run, reduced to what the trace and its gap filling need. */
export interface LiveThermalSample {
  /** Seconds since this run started — `STATUS?`'s elapsed (`usb.md` §3.2 field 8), not wall time. */
  atSeconds: number;
  blockTempC: number;
  /** The running step's 1-based protocol step number (field 5) — null when the poll lacked it. */
  stepNumber: number | null;
  /** The current cycle (field 3) — the same count as the report's repeat field. */
  cycle: number | null;
  /** The host's wall clock (`Date.now()`) when the poll was answered — which keeps counting while
   * the host sleeps, and is what tells a missed stretch from a fast simulated instrument. */
  polledAtMs: number;
}

/** A span of the run's elapsed time with no poll in it. */
export interface ThermalGap {
  fromS: number;
  toS: number;
}

/**
 * How far apart two polls must be to count as a gap — **this library's own** choice, not a
 * measurement. Polls arrive every ~1.5 s, and stand back while a run-folder pull holds the
 * session busy (a few seconds for a cycle's one plate read); 20 s clears both with margin while
 * still being far shorter than any sleep worth filling.
 */
export const THERMAL_GAP_S = 20;

/**
 * Whether nothing polled between `prev` and `cur` for long enough to matter. **Both** clocks must
 * have moved: the host's, because a gap is the host not polling — a simulated instrument at 60×
 * moves the run's clock 90 s between two polls 1.5 s apart, and none of that was missed — and
 * the run's, because a host asleep through a pause missed nothing either.
 */
function isGap(prev: LiveThermalSample, cur: LiveThermalSample, minGapS: number): boolean {
  return cur.polledAtMs - prev.polledAtMs > minGapS * 1000 && cur.atSeconds - prev.atSeconds > minGapS;
}

export interface ThermalGapOptions {
  minGapS?: number;
  /**
   * True when the host was polling as the run began — it saw the instrument idle just before the
   * run's first poll — so the time before that poll was watched, not missed, however far into the
   * run it lands. False for a run found already going: a page loaded, or a cable plugged in, mid-run.
   */
  sawStart?: boolean;
}

/** Every gap in `samples`, in order — a leading one when the run was found already going. */
export function findThermalGaps(
  samples: readonly LiveThermalSample[],
  { minGapS = THERMAL_GAP_S, sawStart = false }: ThermalGapOptions = {},
): ThermalGap[] {
  const gaps: ThermalGap[] = [];
  const first = samples[0];
  if (!first) return gaps;
  if (!sawStart && first.atSeconds > minGapS) gaps.push({ fromS: 0, toS: first.atSeconds });
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    if (isGap(prev, cur, minGapS)) gaps.push({ fromS: prev.atSeconds, toS: cur.atSeconds });
  }
  return gaps;
}

/** A step the polls saw begin: when, on the elapsed clock, and which (step, cycle) it was. */
export interface LiveStepStart {
  stepNumber: number;
  cycle: number;
  atSeconds: number;
}

/**
 * The steps the polls watched begin. A change of (step number, cycle) between two polls places
 * that step's start between them; the midpoint is the estimate, good to half a poll period. A
 * change across a gap is skipped, since the start could be anywhere in it — as is the very first
 * poll, which has nothing before it to change from.
 */
export function liveStepStarts(
  samples: readonly LiveThermalSample[],
  minGapS: number = THERMAL_GAP_S,
): LiveStepStart[] {
  const starts: LiveStepStart[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    if (cur.stepNumber == null || cur.cycle == null) continue;
    if (cur.stepNumber === prev.stepNumber && cur.cycle === prev.cycle) continue;
    if (isGap(prev, cur, minGapS)) continue;
    starts.push({
      stepNumber: cur.stepNumber,
      cycle: cur.cycle,
      atSeconds: (prev.atSeconds + cur.atSeconds) / 2,
    });
  }
  return starts;
}

/**
 * How far an offset may stray from the median and still count as agreeing — **this library's
 * own**. The report's stamps are whole seconds and a poll-observed start is good to half a poll,
 * so honest matches agree within ~2 s; 10 s leaves room for a slow poll without letting a step
 * matched to the wrong cycle (a cycle is minutes) through.
 */
const OFFSET_TOLERANCE_S = 10;

/**
 * Seconds to subtract from a time on the report's clock (seconds since its first timed step, as
 * {@link alfThermalProfile} measures) to put it on `STATUS?`'s elapsed clock — or null when no
 * step both sides saw begin can be matched, or the matches disagree.
 *
 * Matching is by (step number, cycle) ↔ (step number, repeat), which names one executed step
 * uniquely within a stage. A key the report holds twice (a protocol whose later stage revisits
 * the same step numbers with the same repeat) is ambiguous and is not used.
 */
export function alfElapsedOffset(report: AlfReport, samples: readonly LiveThermalSample[]): number | null {
  const origin = report.steps.find((s) => s.startedAt)?.startedAt;
  if (!origin) return null;

  const reportStart = new Map<string, number | null>();
  for (const step of report.steps) {
    if (step.sentinel || !step.startedAt) continue;
    const key = `${step.stepNumber}:${step.repeat}`;
    const at = (step.startedAt.getTime() - origin.getTime()) / 1000;
    reportStart.set(key, reportStart.has(key) ? null : at);
  }

  const offsets: number[] = [];
  for (const live of liveStepStarts(samples)) {
    const at = reportStart.get(`${live.stepNumber}:${live.cycle}`);
    if (at != null) offsets.push(at - live.atSeconds);
  }
  if (offsets.length === 0) return null;

  offsets.sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)]!;
  const agreeing = offsets.filter((o) => Math.abs(o - median) <= OFFSET_TOLERANCE_S);
  // A majority must agree, or the matches are coincidences rather than one clock offset. The
  // report's clock starts before the elapsed one, never after, so a negative offset is a mismatch.
  if (agreeing.length * 2 <= offsets.length || median < -OFFSET_TOLERANCE_S) return null;
  return agreeing.reduce((a, b) => a + b, 0) / agreeing.length;
}

/** One vertex of a filled stretch of the trace. */
export interface ThermalFillPoint {
  atSeconds: number;
  tempC: number;
}

/**
 * The part of a time-ordered polyline inside `[fromS, toS]`, with the crossing points
 * interpolated at both ends so the clipped piece meets the trace on either side. Empty when the
 * polyline doesn't reach into the window.
 */
export function clipPolyline(
  points: readonly ThermalFillPoint[],
  fromS: number,
  toS: number,
): ThermalFillPoint[] {
  const out: ThermalFillPoint[] = [];
  const lerp = (a: ThermalFillPoint, b: ThermalFillPoint, t: number): ThermalFillPoint => ({
    atSeconds: t,
    tempC: b.atSeconds === a.atSeconds ? b.tempC : a.tempC + ((b.tempC - a.tempC) * (t - a.atSeconds)) / (b.atSeconds - a.atSeconds),
  });
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (prev && prev.atSeconds < fromS && p.atSeconds > fromS) out.push(lerp(prev, p, fromS));
    if (prev && prev.atSeconds < toS && p.atSeconds > toS) {
      out.push(lerp(prev, p, toS));
      break;
    }
    if (p.atSeconds >= fromS && p.atSeconds <= toS) out.push(p);
    if (p.atSeconds > toS) break;
  }
  return out;
}

/** What filling a trace's gaps from a report produced. */
export interface ThermalGapFill {
  /** The report-clock → elapsed offset that was applied ({@link alfElapsedOffset}). */
  offsetS: number;
  /** One polyline per gap the report reaches into, on the elapsed clock, in order. */
  stretches: ThermalFillPoint[][];
}

/** Why a report could not fill the gaps — said in the words a log line wants. */
export type ThermalGapFillMiss =
  | "finished report — a previous run's"
  | "a different run's report"
  | "no step to align on yet"
  | "report covers none of the gaps";

/**
 * True when the report's run name could be the running run's `STATUS?` name. The two are cut to
 * different lengths — twelve characters, uppercased, filename-hostile ones replaced, in the report
 * (`usb.md` §5.2); eight in `STATUS?` (§7.3) — so both are normalised and the shorter compared
 * as a prefix of the longer.
 */
export function alfNameMatchesRun(reportRunName: string, statusRunName: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const a = norm(reportRunName.trim());
  const b = norm(statusRunName.trim());
  if (!a || !b) return false;
  return a.length <= b.length ? b.startsWith(a) : a.startsWith(b);
}

/**
 * Fill `gaps` in the live trace from `report`, or say why it can't. See the module comment for the
 * four-step rule; this is steps 2–4.
 */
export function gapFillFromAlf(
  report: AlfReport,
  statusRunName: string,
  samples: readonly LiveThermalSample[],
  gaps: readonly ThermalGap[],
): { fill: ThermalGapFill } | { miss: ThermalGapFillMiss } {
  // A report with its end-of-run sentinel describes a run that is over — the running one isn't.
  if (report.sentinel) return { miss: "finished report — a previous run's" };
  if (!alfNameMatchesRun(report.header.runName, statusRunName)) return { miss: "a different run's report" };
  const offsetS = alfElapsedOffset(report, samples);
  if (offsetS == null) return { miss: "no step to align on yet" };

  const polyline: ThermalFillPoint[] = [];
  for (const seg of alfThermalProfile(report).segments) {
    polyline.push({ atSeconds: seg.startSeconds - offsetS, tempC: seg.fromC });
    polyline.push({ atSeconds: seg.endSeconds - offsetS, tempC: seg.toC });
  }
  const stretches = gaps.map((g) => clipPolyline(polyline, g.fromS, g.toS)).filter((s) => s.length >= 2);
  if (stretches.length === 0) return { miss: "report covers none of the gaps" };
  return { fill: { offsetS, stretches } };
}
