/**
 * Buffers `STATUS?` polls into a block-temperature-over-time series for the run currently
 * underway — the live counterpart to `alfThermalProfile`'s after-the-fact reconstruction from a
 * finished run's `.alf` report (`lib/uplot/thermalChart.ts`). `useCfxDevice`'s poll loop only ever
 * exposes the latest `CfxStatus`, overwriting the previous one each tick, so nothing upstream of
 * this hook accumulates a history — it's the one place that does.
 *
 * It also notices the stretches it *didn't* see — connected after the run began, or the computer
 * asleep mid-run — and asks the instrument for the run's `.alf` report to fill them. The rules
 * (what counts as a gap, which report is this run's, how its clock is lined up with the polls')
 * are core's `liveThermal.ts`; what is here is when to ask, and remembering the answer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  THERMAL_GAP_S,
  findThermalGaps,
  gapFillFromAlf,
  parseAlf,
  type AlfReport,
  type CfxStatus,
  type LiveThermalSample,
  type ThermalGap,
  type ThermalGapFill,
} from "@zpcrweb/core";

export type { LiveThermalSample } from "@zpcrweb/core";

/** Where filling the trace's gaps has got to — what the chart's note says. */
export type GapFillState =
  /** Every gap has a stretch from the report. */
  | "filled"
  /** Some gaps do, some don't — the report stops short, or a gap is in the first step's ramp. */
  | "partial"
  /** A report read is in flight. */
  | "checking"
  /** The instrument had no report for this run to give — the expected answer mid-run. */
  | "unavailable";

export interface LiveThermalHistory {
  samples: LiveThermalSample[];
  /**
   * How long the whole run is expected to take, in seconds — `elapsedS + remainingS` from the
   * *first* poll of the run that reported a remaining time, and then held for the rest of it.
   *
   * Latched rather than recomputed each poll because the instrument's remaining time is an
   * estimate that drifts: it doesn't count plate reads or the initial lid heat (`usb.md` §3.2
   * field 10), so `elapsed + remaining` creeps upward as a run goes on. Re-reading it every tick
   * would give the chart a slowly-stretching axis, which is the thing a fixed axis is for. Null
   * until a poll reports a remaining time.
   */
  estimatedTotalS: number | null;
  /** Stretches of the run with no poll in them — `findThermalGaps`. */
  gaps: ThermalGap[];
  /** The report's trace inside those gaps, when the instrument had one to give. */
  fill: ThermalGapFill | null;
  /** Null when there are no gaps. */
  gapFill: GapFillState | null;
}

/** Generous relative to any real run: a poll every 1.5 s for 24 h is under 60,000 samples. */
const MAX_SAMPLES = 20000;

interface Series {
  /** The run the samples belong to — `STATUS?`'s run name. */
  runName: string;
  samples: LiveThermalSample[];
  estimatedTotalS: number | null;
  /** Whether this page was polling as the run began — `ThermalGapOptions.sawStart`. */
  sawStart: boolean;
}

const EMPTY: Series = { runName: "", samples: [], estimatedTotalS: null, sawStart: false };

/** What the hook needs from the session to fill gaps. */
export interface RunReportSource {
  /** True while the session is doing something else — a gap check waits for it. */
  busy: boolean;
  /** `CfxSession.peekRunReport`. */
  peekRunReport: () => Promise<{ name: string; bytes: Uint8Array } | null | undefined>;
}

/**
 * Starts a fresh series whenever the run name changes or `elapsedS` goes backwards — both of
 * which mean a new run has begun, since `runName` persists across polls of the same run and
 * `elapsedS` only ever counts up within one.
 */
export function useLiveThermalHistory(status: CfxStatus | null, source: RunReportSource): LiveThermalHistory {
  const [series, setSeries] = useState<Series>(EMPTY);
  // When a poll last found the instrument not running: a run whose first poll follows one of
  // these closely was watched from its start, so whatever elapsed time it shows wasn't missed.
  const idleAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (status && !status.running) idleAtRef.current = Date.now();
    if (!status?.running || status.blockTempC == null || status.elapsedS == null) return;
    const runName = status.runName;
    const polledAtMs = Date.now();
    const sample: LiveThermalSample = {
      atSeconds: status.elapsedS,
      blockTempC: status.blockTempC,
      stepNumber: status.stepNumber,
      cycle: status.cycle,
      polledAtMs,
    };
    const remainingS = status.remainingS;
    const idleAt = idleAtRef.current;
    const sawStart = idleAt != null && polledAtMs - idleAt <= THERMAL_GAP_S * 1000;

    setSeries((prev) => {
      const last = prev.samples[prev.samples.length - 1];
      const isNewRun = prev.runName !== runName || (!!last && sample.atSeconds < last.atSeconds);
      const base = isNewRun ? { ...EMPTY, runName, sawStart } : prev;
      // A zero or absent remaining time says nothing; wait for a poll that has one.
      const estimatedTotalS =
        base.estimatedTotalS ?? (remainingS != null && remainingS > 0 ? sample.atSeconds + remainingS : null);
      const baseLast = base.samples[base.samples.length - 1];
      if (baseLast && baseLast.atSeconds >= sample.atSeconds) {
        return estimatedTotalS === base.estimatedTotalS ? base : { ...base, estimatedTotalS };
      }
      const next = [...base.samples, sample];
      return {
        ...base,
        samples: next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next,
        estimatedTotalS,
      };
    });
  }, [status]);

  const gaps = useMemo(
    () => findThermalGaps(series.samples, { sawStart: series.sawStart }),
    [series.samples, series.sawStart],
  );

  // The report last read for this run, and which gaps have already been asked about. A gap is
  // asked about once: the report is either there or not, and a *new* gap is the only thing that
  // makes asking again worthwhile (a report written as the run goes would by then cover more).
  const [report, setReport] = useState<{ runName: string; alf: AlfReport | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const askedRef = useRef<{ runName: string; gaps: Set<number> }>({ runName: "", gaps: new Set() });

  const { busy, peekRunReport } = source;
  const running = !!status?.running;
  useEffect(() => {
    if (!running || busy || checking || gaps.length === 0) return;
    const runName = series.runName;
    if (askedRef.current.runName !== runName) askedRef.current = { runName, gaps: new Set() };
    const asked = askedRef.current.gaps;
    const fresh = gaps.filter((g) => !asked.has(g.fromS));
    if (fresh.length === 0) return;
    for (const g of fresh) asked.add(g.fromS);

    setChecking(true);
    void peekRunReport()
      .then((got) => {
        let alf: AlfReport | null = null;
        if (got) {
          try {
            alf = parseAlf(got.bytes);
          } catch (e) {
            console.warn("[liveThermal] the run report did not decode:", e);
          }
        }
        // Whether a report exists mid-run is unmeasured (`usb.md` §5.2) — say what was found, so
        // a session's console answers it.
        console.info(
          `[liveThermal] ${fresh.length} gap(s) in the live trace; run report on the instrument:`,
          got ? `${got.name} (${got.bytes.length} bytes, ${alf?.sentinel ? "finished" : "no end line"})` : got === null ? "none" : "read failed",
        );
        setReport({ runName, alf });
      })
      .finally(() => setChecking(false));
  }, [running, busy, checking, gaps, series.runName, peekRunReport]);

  const alf = report?.runName === series.runName ? report.alf : null;
  const result = useMemo(
    () => (alf && gaps.length > 0 ? gapFillFromAlf(alf, series.runName, series.samples, gaps) : null),
    [alf, gaps, series.runName, series.samples],
  );
  const fill = result && "fill" in result ? result.fill : null;

  let gapFill: GapFillState | null = null;
  if (gaps.length > 0) {
    if (fill) gapFill = fill.stretches.length >= gaps.length ? "filled" : "partial";
    else gapFill = checking || report?.runName !== series.runName ? "checking" : "unavailable";
  }

  return useMemo(
    () => ({ samples: series.samples, estimatedTotalS: series.estimatedTotalS, gaps, fill, gapFill }),
    [series, gaps, fill, gapFill],
  );
}
