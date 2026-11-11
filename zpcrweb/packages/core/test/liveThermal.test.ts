import { describe, it, expect } from "vitest";
import {
  alfElapsedOffset,
  alfNameMatchesRun,
  clipPolyline,
  findThermalGaps,
  gapFillFromAlf,
  liveStepStarts,
  parseAlf,
  type AlfReport,
  type LiveThermalSample,
} from "../src/index.js";

/** `alf.md` §3's 3-cycle gradient report — without its sentinel, as a run still going would be. */
const HEADER = [
  "GRADIENTTEST*admin*RN050773*A*CFX96*Jul 25, 2026*12:48:11*12:56:53*00:08:42*105.0*25.0**CT019138*CT019138*",
  "METHOD CALC*HOTLID 105,30*VOLUME 25*TEMP 95.0,60*GRAD 55.0,65.0,30*TEMP 55.0,30*PLATEREAD #h3F*GOTO 2,2*END",
  " No errors reported. *0:*False*False*False*False*None*False*",
];
const STEPS = [
  "-1*1*1*.00*95.0*60*07/25/2026 12:48:20*False*0*",
  "-1*1*2*.14*55;65*30*07/25/2026 12:52:20*False*0*",
  "-1*1*3*.10*55.0*30*07/25/2026 12:53:07*False*0*",
  "-1*1*4*.02*Plate Read*0*07/25/2026 12:53:46*False*0*",
  "-1*2*2*.88*55;65*30*07/25/2026 12:54:00*False*0*",
  "-1*2*3*.91*55.0*30*07/25/2026 12:54:35*False*0*",
  "-1*2*4*.05*Plate Read*0*07/25/2026 12:55:11*False*0*",
  "-1*3*2*.65*55;65*30*07/25/2026 12:55:24*False*0*",
  "-1*3*3*1.84*55.0*30*07/25/2026 12:56:01*False*0*",
  "-1*3*4*.04*Plate Read*0*07/25/2026 12:56:37*False*0*",
];
const SENTINEL = "-1*0*0*.00*0*0*07/25/2026 12:56:53 Protocol completed.*False*0*";
const report = (lines: string[]): AlfReport => parseAlf([...HEADER, ...lines, ""].join("\r\n"));
const RUNNING = report(STEPS);

/** Seconds from the report's first step to its sentinel. */
const END_S = 8 * 60 + 33;
/** The preheat: how far the report's clock runs ahead of `STATUS?`'s elapsed in these fixtures. */
const OFFSET = 50;

/**
 * What `STATUS?` would have reported every 1.5 s over the whole run, on its own clock — each poll
 * carrying the (step, cycle) the report says was running then.
 */
function polls(): LiveThermalSample[] {
  const origin = RUNNING.steps[0]!.startedAt!.getTime();
  const starts = RUNNING.steps.map((s) => ({
    at: (s.startedAt!.getTime() - origin) / 1000 - OFFSET,
    stepNumber: s.stepNumber,
    cycle: s.repeat,
  }));
  const out: LiveThermalSample[] = [];
  for (let t = 0; t <= END_S - OFFSET; t += 1.5) {
    const cur = [...starts].reverse().find((s) => s.at <= t) ?? starts[0]!;
    // A real instrument: the host's clock and the run's advance together.
    out.push({ atSeconds: t, blockTempC: 50, stepNumber: cur.stepNumber, cycle: cur.cycle, polledAtMs: t * 1000 });
  }
  return out;
}

const without = (samples: LiveThermalSample[], fromS: number, toS: number) =>
  samples.filter((s) => s.atSeconds < fromS || s.atSeconds > toS);

describe("findThermalGaps", () => {
  it("finds nothing in an unbroken trace", () => {
    expect(findThermalGaps(polls())).toEqual([]);
  });

  it("finds a sleep between two polls", () => {
    const gaps = findThermalGaps(without(polls(), 100, 200));
    expect(gaps).toEqual([{ fromS: 99, toS: 201 }]);
  });

  it("finds a leading gap when the first poll came long after the start (a mid-run connect)", () => {
    expect(findThermalGaps(without(polls(), -1, 120))).toEqual([{ fromS: 0, toS: 121.5 }]);
  });

  it("ignores a short stall, such as a poll held back by a plate-read pull", () => {
    expect(findThermalGaps(without(polls(), 100, 110))).toEqual([]);
  });

  it("sees no gap in a simulated instrument running at 60×, whose polls are 1.5 s apart", () => {
    const fast = polls()
      .filter((_, i) => i % 60 === 0)
      .map((s, i) => ({ ...s, polledAtMs: i * 1500 }));
    expect(fast[1]!.atSeconds - fast[0]!.atSeconds).toBe(90);
    expect(findThermalGaps(fast)).toEqual([]);
  });

  it("has no leading gap for a run the host watched begin, however late its first poll", () => {
    const late = without(polls(), -1, 120);
    expect(findThermalGaps(late, { sawStart: true })).toEqual([]);
  });
});

describe("liveStepStarts", () => {
  it("places a start midway between the polls either side of it, and skips one across a gap", () => {
    const starts = liveStepStarts(without(polls(), 100, 200));
    // Step 2 of cycle 1 begins at 240 − 50 = 190 s, inside the gap — so it is not reported.
    expect(starts.find((s) => s.stepNumber === 2 && s.cycle === 1)).toBeUndefined();
    const s3 = starts.find((s) => s.stepNumber === 3 && s.cycle === 1)!;
    expect(Math.abs(s3.atSeconds - (287 - OFFSET))).toBeLessThanOrEqual(1);
  });
});

describe("alfElapsedOffset", () => {
  it("measures the preheat offset from the steps both sides saw begin", () => {
    expect(alfElapsedOffset(RUNNING, polls())).toBeCloseTo(OFFSET, 0);
  });

  it("is null when no step has been seen to begin yet", () => {
    expect(alfElapsedOffset(RUNNING, polls().slice(0, 5))).toBeNull();
  });

  it("is null when the matches disagree — a report that isn't this run's", () => {
    const shuffled = polls().map((s) => ({ ...s, cycle: s.cycle === 2 ? 3 : s.cycle === 3 ? 2 : s.cycle }));
    expect(alfElapsedOffset(RUNNING, shuffled)).toBeNull();
  });
});

describe("clipPolyline", () => {
  const line = [
    { atSeconds: 0, tempC: 0 },
    { atSeconds: 10, tempC: 100 },
    { atSeconds: 20, tempC: 100 },
  ];
  it("interpolates the crossing at both edges", () => {
    expect(clipPolyline(line, 5, 15)).toEqual([
      { atSeconds: 5, tempC: 50 },
      { atSeconds: 10, tempC: 100 },
      { atSeconds: 15, tempC: 100 },
    ]);
  });
  it("is empty for a window the line never reaches", () => {
    expect(clipPolyline(line, 30, 40)).toEqual([]);
  });
});

describe("alfNameMatchesRun", () => {
  it("compares the report's twelve-character name with STATUS?'s eight", () => {
    expect(alfNameMatchesRun("SINGLE_STEP_", "Single S")).toBe(true);
    expect(alfNameMatchesRun("GRADIENTTEST", "GRADIENT")).toBe(true);
    expect(alfNameMatchesRun("GRADIENTTEST", "SINGLETE")).toBe(false);
    expect(alfNameMatchesRun("", "SINGLETE")).toBe(false);
  });
});

describe("gapFillFromAlf", () => {
  it("fills a mid-run gap with the report's profile, meeting the trace at both edges", () => {
    const samples = without(polls(), 150, 260);
    const gaps = findThermalGaps(samples);
    const got = gapFillFromAlf(RUNNING, "GRADIENT", samples, gaps);
    if (!("fill" in got)) throw new Error(got.miss);
    expect(got.fill.offsetS).toBeCloseTo(OFFSET, 0);
    const [stretch] = got.fill.stretches;
    expect(stretch![0]!.atSeconds).toBe(gaps[0]!.fromS);
    expect(stretch!.at(-1)!.atSeconds).toBe(gaps[0]!.toS);
    // The report has the block holding 95 °C until step 2 begins at 190 s elapsed, then ramping
    // down to the gradient's midpoint of 60 °C.
    expect(stretch![0]!.tempC).toBe(95);
    expect(stretch!.some((p) => p.tempC === 60)).toBe(true);
  });

  it("fills a leading gap from where the report first knows the block's temperature", () => {
    const samples = without(polls(), -1, 200);
    const got = gapFillFromAlf(RUNNING, "GRADIENT", samples, findThermalGaps(samples));
    if (!("fill" in got)) throw new Error(got.miss);
    // Step 1's ramp is never drawn (the report doesn't say where the block started), so the fill
    // begins with its 60 s hold: 180 s into the report, 130 s elapsed.
    expect(got.fill.stretches[0]![0]!.atSeconds).toBeCloseTo(180 - OFFSET, 0);
  });

  it("refuses a finished report — the previous run's, still sitting on the instrument", () => {
    const samples = without(polls(), 100, 200);
    expect(gapFillFromAlf(report([...STEPS, SENTINEL]), "GRADIENT", samples, findThermalGaps(samples))).toEqual({
      miss: "finished report — a previous run's",
    });
  });

  it("refuses a report for a differently-named run", () => {
    const samples = without(polls(), 100, 200);
    expect(gapFillFromAlf(RUNNING, "SINGLETE", samples, findThermalGaps(samples))).toEqual({
      miss: "a different run's report",
    });
  });

  it("says so when the report stops short of the gap — a report written as the run goes", () => {
    const samples = without(polls(), 400, 470);
    expect(gapFillFromAlf(report(STEPS.slice(0, 4)), "GRADIENT", samples, findThermalGaps(samples))).toEqual({
      miss: "report covers none of the gaps",
    });
  });
});
