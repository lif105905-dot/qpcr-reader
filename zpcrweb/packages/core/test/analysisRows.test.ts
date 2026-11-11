import { describe, expect, it } from "vitest";
import {
  analysisCsv,
  analysisCsvFilename,
  channelLabel,
  csvRow,
  meltCsv,
  meltCsvFilename,
  type AnalysisRow,
  type MeltRow,
} from "../src/analysisRows.js";

/** A row as `buildAnalysisRows` would emit it for a single amplified well. */
function row(overrides: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    target: "SYBR",
    fluor: "SYBR",
    channel: 0,
    row: 0,
    col: 0,
    wellLabel: "A1",
    sample: "",
    sampleType: "unknown",
    baselineFormula: "3500 + 10c",
    threshold: 369.2,
    noise: 1,
    deltaRfu: 4000,
    endRfu: 4100,
    cq: 15.2,
    ...overrides,
  };
}

describe("channelLabel", () => {
  it("names channels by position", () => {
    expect(channelLabel(0)).toBe("Ch1");
    expect(channelLabel(5)).toBe("Ch6");
  });

  it("falls back when there is no channel", () => {
    expect(channelLabel(null)).toBe("Ch?");
    expect(channelLabel(undefined)).toBe("Ch?");
  });
});

describe("csvRow", () => {
  it("quotes cells that contain a comma, a quote or a newline", () => {
    expect(csvRow(["plain", "a,b", 'say "hi"', "two\nlines"])).toBe(
      'plain,"a,b","say ""hi""","two\nlines"\r\n',
    );
  });
});

describe("analysisCsv", () => {
  it("writes the table's columns in the table's order", () => {
    const [header, body] = analysisCsv([row()]).replace(/\r/g, "").trim().split("\n");
    expect(header).toBe(
      "well,sample,sampleType,fluor,target,channel,baseline,threshold,cq,deltaRfu,endRfu",
    );
    expect(body).toBe("A1,,unknown,SYBR,SYBR,Ch1,3500 + 10c,369.2,15.20,4000.0,4100.0");
  });

  it("leaves the Cq cell empty for a well that never crossed the threshold", () => {
    expect(analysisCsv([row({ cq: null })]).trim().split("\n")[1]).toContain("369.2,,4000.0");
  });

  it("leaves the comparison columns out when nothing was imported", () => {
    expect(analysisCsv([row()]).split("\n")[0]).not.toContain("cfxCq");
  });

  it("adds both comparison columns, and the difference, once Cq values are imported", () => {
    const csv = analysisCsv([row()], { A1: 15.15 });
    const [header, body] = csv.trim().split("\n");
    expect(header).toContain("cq,cfxCq,cqDelta,deltaRfu");
    expect(body).toContain("15.20,15.15,0.05,");
  });

  it("writes an empty difference for a well the imported table does not cover", () => {
    expect(analysisCsv([row()], { B1: 20 }).trim().split("\n")[1]).toContain("15.20,,,");
  });
});

describe("analysisCsvFilename", () => {
  it("derives the name from the run file, with spaces folded to underscores", () => {
    expect(analysisCsvFilename("admin_2026-11-09 19-44-00_BR009578.pcrd")).toBe(
      "admin_2026-11-09_19-44-00_BR009578_analysis.csv",
    );
  });

  it("falls back to a generic name when there is nothing usable", () => {
    expect(analysisCsvFilename("")).toBe("run_analysis.csv");
  });
});

describe("meltCsv", () => {
  function meltRow(overrides: Partial<MeltRow> = {}): MeltRow {
    return {
      wellLabel: "A1",
      row: 0,
      col: 0,
      channel: 0,
      fluor: "SYBR",
      temperatureC: 82.5,
      rfu: 1200,
      derivative: 900,
      tmC: 82.5,
      peakHeight: 900,
      ...overrides,
    } as MeltRow;
  }

  it("writes one line per well with its melting temperature and peak height", () => {
    const [header, body] = meltCsv([meltRow()]).replace(/\r/g, "").trim().split("\n");
    expect(header).toBe("well,channel,fluor,target,tm,peakHeight");
    expect(body).toBe("A1,Ch1,,,82.5,900.0");
  });

  it("names the file after the run", () => {
    expect(meltCsvFilename("run.pcrd")).toBe("run_melt.csv");
  });
});
