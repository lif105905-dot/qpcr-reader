/**
 * The emulator against the recorded conversations with a real instrument — `emulator.md` §10.1.
 *
 * Every other emulator test proves the emulator is *self-consistent*: it answers the way we think
 * a CFX96 answers, to a client written from the same document. This one is the only check in the
 * suite with an outside witness. Three committed recordings — two `.zpcr`s carrying their
 * session's `usb-traffic.bin`, and one bare `.usblog` — were made by this app itself against
 * CT019138, each a whole session — connect → author → start → watch → finish → pull — and the test
 * replays every host→device command out of each, in order, at the emulator, on a clock advanced to
 * the recording's own timestamps, and compares what comes back with what the instrument said.
 *
 * | recording | run | what only it witnesses |
 * |---|---|---|
 * | `20260807-YouSeq_RT_-_S56.zpcr` | `METHOD BLOCK`, three `TEMP` steps, no `PLATEREAD` — a heat-block run (`usb.md` §7.10) | the thermal path; the final pull of a *previous* qPCR run's folder |
 * | `20261014-S187_S188_S189_cold_check.zpcr` | `METHOD CALC`, `GOTO 2,44` — a 45-cycle qPCR run | a qPCR run executing: the folder clear, 45 plate reads pulled as they land, field 2, the ramps, the acknowledgement's release |
 * | `heat-block.usblog` | the S56 protocol again, run to completion | the run's own report and its clock; the release, polled across; an hour of the block and lid cooling |
 *
 * **How far this reaches, stated before anything else.**
 *
 * - **No recorded traffic exists for a melt, a cancel, or a pause**, and nothing here says
 *   anything about them (`emulator.md` §11).
 * - **Every result code in all three recordings is `0000`.** The instrument was never asked anything it
 *   refused, so the property `emulator.md` Appendix A cares about most — that the emulator is never
 *   *more permissive* than the instrument — is untestable from these files. All this can check is
 *   that the emulator does not invent a failure where the instrument succeeded.
 * - A different clock ran. Temperatures, elapsed seconds, GUIDs, free space and file timestamps
 *   cannot match and are never asserted equal; they are compared for shape, population and
 *   plausible range, and every difference is **listed in the test's output** rather than quietly
 *   tolerated. The step *durations* are the exception: they are the timing model, and each is held
 *   to the recording's within a stated tolerance.
 *
 * What it *does* prove, and what a failure here means: the emulator's reply to each command has the
 * shape the instrument's had (value + `;` + code, a bare code, or raw bytes), the same result code,
 * the same listing, byte-identical file contents where the emulator was handed the bytes, a
 * `STATUS?` record of the same twenty fields with the same ones populated in each phase of the run,
 * and the same sequence of run edges. Where it *knowingly* differs, the difference is one of the
 * recording's `known` set, each of which is recorded in `emulator.md`; anything else fails and names
 * the command.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  isUsbTrafficLog,
  parseAlf,
  parseResponse,
  parseRunInfoRaw,
  parseUsbTrafficLog,
  unzipArchive,
  type UsbTrafficMessage,
  type ZpcrArchive,
} from "../src/index.js";
import {
  createCfxEmulator,
  manualClock,
  recordedRunData,
  RELEASE_MS,
  START_WINDOW_MS,
  START_WINDOW_PLATE_READ_MS,
  type CfxEmulator,
  type EmulatorReply,
  type ScheduledStep,
} from "../src/emulator.js";
import { HEAT_BLOCK_USBLOG_SAMPLE_PATH, QPCR_S187_SAMPLE_PATH, RT_S56_SAMPLE_PATH } from "./sample.js";

const CURRENT_RUN = "\\Storage Card\\CurrentRun";
const RUN_REPORTS = "\\Storage Card\\PCRunReport";
const LATIN1 = new TextDecoder("latin1");

/** The four `RunInfo.xml` keys that belong to the run rather than the instrument — the emulator
 * writes its own (`runInfo.ts`), and every other key is the recording's. */
const RUN_OWN_KEYS = new Set(["Identifier", "RunStartTime", "DataFile", "RunDefinition"]);

/**
 * Differences between the emulator and a recording that are **understood and deliberate**, each
 * with its entry in `emulator.md` §10.1. A difference outside the recording's set fails the run:
 * the point of a fidelity check is that it cannot be quietly widened.
 */
const DIVERGENCES = {
  // The instrument terminates some replies with CRLF and others bare, per command. The emulator
  // emits none. `parseResponse` strips either, so nothing in the client notices today.
  crlfTerminator: "crlf-terminator",
  // `GETFILE`'s reply is *not* a `passThrough` message on the real instrument — printable files
  // come back recorded as text. The emulator marks it passThrough.
  getfilePassthrough: "getfile-passthrough",
  // Instrument-specific values that cannot match: free space and the staging GUID.
  instrumentValue: "instrument-value",
  // The emulator serves the heat-block session's folder out of the archive, and the archive is not
  // a byte-identical copy of what the instrument held — the app rewrote two files on the way in.
  archiveCopyDiffers: "archive-copy-differs",
  // The staging GUID copy of an upload is gone from the instrument's listing by the end of the
  // run; the emulator keeps it until the next upload.
  stagingGuidLifetime: "staging-guid-lifetime",
  // A file deleted and written again keeps its place in the instrument's listing; the emulator's
  // listing moves it to the end — and writes a run's support files before the host's deposit,
  // where the instrument lists them after it.
  listingOrder: "listing-order",
  // The instrument's at-target bit can fall back to 0 for a poll after the hold has begun; the
  // emulator's never does once a step has arrived.
  atTargetFlicker: "at-target-flicker",
  // The emulator's lid preheat runs longer than the instrument's from a cold lid (4.5–14 s; the
  // lid's first seconds heat faster than its one linear rate), so its run finishes later. The
  // session's acknowledging `CANCEL` came 0.1–1.4 s after the real finish, which on the emulator
  // is still the last hold — an abort. The replay sends it at the emulator's own finish instead,
  // and everything after it as long after that as it came after the CANCEL in the recording.
  runDurationModel: "run-duration-model",
  // The run report's name carries the moment `RemoteRun` was accepted, to the second, and the
  // instrument's moment is somewhere inside the command's round trip. A name may differ in its
  // time of day by up to 2 s and nothing else; the recorded name is then mapped to the emulator's,
  // as a staging GUID is, and the report's *contents* are checked field by field on their own.
  reportClock: "report-clock",
  // The qPCR session's first five replies belong to the command before: a reply left in the pipe
  // by the previous connection, before `CfxDevice.identify` learned to turn one away (`usb.md` §3,
  // "A connection starts in step"). Skipped, not compared.
  staleRepliesAtConnect: "stale-replies-at-connect",
  // The qPCR session deposited its files inside the start window, before `CfxDevice.startRun`
  // waited for the run to appear (`usb.md` §7.4). The replay sends them where the client sends
  // them now — after — so the half-cleared folder the instrument showed meanwhile, and the
  // `.prcl.txt` its clear swept away, are the recording's and not the emulator's.
  depositInStartWindow: "deposit-in-start-window",
  // Plate reads are synthesised from one curve per channel (`emulator.md` §7): the same size and
  // shape as the instrument's, never the same bytes.
  syntheticPlateRead: "synthetic-plate-read",
  // `RunInfo.xml`'s run-own keys are the emulator's (`runInfo.ts`); every other key is compared.
  runIdentity: "run-identity",
  // `runlog.xml` is carried from the recording's *finished* run (`emulator.md` §8); the instrument's
  // grows through the run.
  runlogVerbatim: "runlog-verbatim",
  // Once in three recorded finishes, the first `IDLE` poll still carried the run's register 97 —
  // block active, at target — before the 32 of §7.6. Not emulated: the other two finishes,
  // one of them a qPCR run polled 0.3 s after its end, went straight to 32 (`usb.md` §7.6).
  finishRegisterTransient: "finish-register-transient",
} as const;

// ---- the recording ------------------------------------------------------------------------

interface Exchange {
  /** Index of the host→device record in the log. */
  index: number;
  /** Simulated ms since the first recorded message. */
  atMs: number;
  /** The command line, terminator stripped. */
  command: string;
  verb: string;
  /** The raw host→device payload — `CRCSENDFILE` carries a file in it. */
  payload: Uint8Array;
  /** The instrument's reply. */
  reply: UsbTrafficMessage;
}

interface Recording {
  archive: ZpcrArchive;
  /** Every exchange from the point the conversation is in step. */
  exchanges: Exchange[];
  /** How many leading exchanges were skipped as out of step. */
  skipped: number;
  /** STATUS? fields of every poll, in order, with its time — the instrument's own clocks. */
  polls: { atMs: number; fields: string[] }[];
  /** The wall-clock instant the recording's first message was sent. */
  startedAt: Date;
  /** The zone offset the session gave the instrument with `SetDateTime`, in minutes east of UTC,
   * or null if it sent none. */
  zoneOffsetMin: number | null;
  /** The session's own run report, recorded name → the emulator's, once a listing has paired them
   * (`report-clock`). Filled in by the replay. */
  ownReports: Map<string, string>;
}

/**
 * A recording is either a `.zpcr` carrying its session's `usb-traffic.bin`, or a bare `.usblog`.
 * A bare log has no archive around it, so its "archive" is what the session itself pulled: every
 * `GETFILE` reply, by file name. That is exactly the set of files the replay can need — a file the
 * session never fetched is one the comparison never asks for.
 */
function loadRecording(path: string, inStepFrom?: (ex: Exchange) => boolean): Recording {
  const buf = readFileSync(path);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const bare = isUsbTrafficLog(bytes);
  const archive: ZpcrArchive = bare ? {} : unzipArchive(bytes);
  const records = parseUsbTrafficLog(bare ? bytes : archive["usb-traffic.bin"]!).filter(
    (r): r is UsbTrafficMessage => r.kind === "message",
  );
  const t0 = records[0]!.at;
  const all: Exchange[] = [];
  for (let i = 0; i < records.length; i++) {
    const out = records[i]!;
    if (out.direction !== "out") continue;
    const reply = records[i + 1];
    // Every command in both logs is answered by the very next record; a log that interleaved
    // differently would need pairing by channel, and saying so is cheaper than pretending.
    if (!reply || reply.direction !== "in") continue;
    const command = (out.text ?? LATIN1.decode(out.payload.slice(0, 512))).replace(/\r?\n$/, "");
    all.push({
      index: i,
      atMs: out.at - t0,
      command,
      verb: command.trim().split(/[ ,"]/)[0] ?? "",
      payload: out.payload,
      reply,
    });
  }
  if (bare) {
    // The first copy of each: the seeding wants the file as it stood before the session's run.
    for (const ex of all) if (ex.verb === "GETFILE") archive[fileOf(ex.command)] ??= ex.reply.payload;
  }
  const from = inStepFrom ? all.findIndex(inStepFrom) : 0;
  const exchanges = all.slice(from);
  const polls = exchanges
    .filter((e) => e.verb === "STATUS?")
    .map((e) => ({ atMs: e.atMs, fields: parseResponse(e.reply.payload).fields }));
  const setClock = all.find((e) => e.verb === "SetDateTime");
  const zone = setClock && /,([+-])(\d\d):(\d\d)$/.exec(setClock.command);
  const zoneOffsetMin = zone ? (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3])) : null;
  return { archive, exchanges, skipped: from, polls, startedAt: new Date(t0), zoneOffsetMin, ownReports: new Map() };
}

/** The listing a `LISTALLFILES` reply carries, GUIDs masked. */
function namesOf(reply: Uint8Array | string): string[] {
  const text = typeof reply === "string" ? reply : replyText(reply);
  return maskGuids(text).replace(/;\d{4}$/, "").split(",").filter((n) => n !== "");
}

// ---- what each recording needs ------------------------------------------------------------

interface RecordingSpec {
  label: string;
  path: string;
  /** The first exchange whose reply is its own — see `stale-replies-at-connect`. */
  inStepFrom?: (ex: Exchange) => boolean;
  /** `CurrentRun` as the instrument held it before the session's run, in its listing order. */
  initialNames(rec: Recording): string[];
  /** `PCRunReport` before the run: the previous run's report, by name. */
  initialReports(rec: Recording): Record<string, Uint8Array>;
  /** Hold the deposit back until the run shows, as the client does now (`deposit-in-start-window`). */
  deferDeposit: boolean;
  /** The run has plate reads, so the emulator needs curves to write them from — its own archive's. */
  plateReads: boolean;
  /** Names the emulator lists and the instrument does not, and why. */
  emulatorOnlyNames: Record<string, string>;
  known: Set<string>;
}

const HEAT_BLOCK: RecordingSpec = {
  label: "the heat-block session",
  path: RT_S56_SAMPLE_PATH,
  initialNames(rec) {
    const first = rec.exchanges.find((e) => e.verb === "LISTALLFILES")!;
    return parseResponse(first.reply.payload).value!.split(",");
  },
  initialReports(rec) {
    // The previous run's report, which this session deletes before authoring its own (§7.4).
    const name = this.initialNames(rec).find((n) => n.endsWith(".alf"))!;
    return { [name]: rec.archive[name]! };
  },
  deferDeposit: false,
  plateReads: false,
  emulatorOnlyNames: {},
  known: new Set([
    DIVERGENCES.crlfTerminator,
    DIVERGENCES.getfilePassthrough,
    DIVERGENCES.instrumentValue,
    DIVERGENCES.archiveCopyDiffers,
    DIVERGENCES.stagingGuidLifetime,
    DIVERGENCES.listingOrder,
    DIVERGENCES.atTargetFlicker,
    DIVERGENCES.runDurationModel,
  ]),
};

const QPCR: RecordingSpec = {
  label: "the qPCR session",
  path: QPCR_S187_SAMPLE_PATH,
  inStepFrom: (ex) => ex.verb === "ALPHASN?",
  initialNames(rec) {
    // The connect-time listing went to the wrong command (`stale-replies-at-connect`), so the
    // previous run's folder is read off the first listing after `RemoteRun` — before the firmware's
    // clear had touched it, and less the protocol and staging GUID the host had just put there.
    const remoteRun = rec.exchanges.findIndex((e) => e.verb === "RemoteRun");
    const listing = rec.exchanges.slice(remoteRun).find((e) => e.verb === "LISTALLFILES")!;
    return parseResponse(listing.reply.payload)
      .value!.split(",")
      .filter((n) => n !== "YouSeq_c45.prcl.txt" && !GUID.test(n));
  },
  initialReports(rec) {
    const fetched = rec.exchanges.find((e) => e.verb === "GETFILE" && e.command.includes("PCRunReport"))!;
    return { [fileOf(fetched.command)]: fetched.reply.payload };
  },
  deferDeposit: true,
  plateReads: true,
  emulatorOnlyNames: { "YouSeq_c45.prcl.txt": DIVERGENCES.depositInStartWindow },
  known: new Set([
    DIVERGENCES.crlfTerminator,
    DIVERGENCES.getfilePassthrough,
    DIVERGENCES.instrumentValue,
    DIVERGENCES.stagingGuidLifetime,
    DIVERGENCES.listingOrder,
    DIVERGENCES.staleRepliesAtConnect,
    DIVERGENCES.depositInStartWindow,
    DIVERGENCES.syntheticPlateRead,
    DIVERGENCES.runIdentity,
    DIVERGENCES.runlogVerbatim,
    DIVERGENCES.atTargetFlicker,
    DIVERGENCES.finishRegisterTransient,
  ]),
};

const COOLDOWN: RecordingSpec = {
  label: "the heat-block session with its cool-down",
  path: HEAT_BLOCK_USBLOG_SAMPLE_PATH,
  initialNames(rec) {
    // The connect-time listing: the previous run's (the qPCR session's) folder, never pulled again.
    const first = rec.exchanges.find((e) => e.verb === "LISTALLFILES")!;
    return parseResponse(first.reply.payload).value!.split(",");
  },
  initialReports(rec) {
    // The previous run's report, pulled at connect and deleted before this run's upload (§7.4).
    const fetched = rec.exchanges.find((e) => e.verb === "GETFILE" && e.command.includes("PCRunReport"))!;
    return { [fileOf(fetched.command)]: fetched.reply.payload };
  },
  deferDeposit: false,
  plateReads: false,
  emulatorOnlyNames: {},
  known: new Set([
    DIVERGENCES.crlfTerminator,
    DIVERGENCES.getfilePassthrough,
    DIVERGENCES.instrumentValue,
    DIVERGENCES.listingOrder,
    DIVERGENCES.atTargetFlicker,
    DIVERGENCES.runDurationModel,
    DIVERGENCES.reportClock,
  ]),
};

// ---- the emulator, seeded to look like that instrument ------------------------------------

/**
 * How far the instrument's wall clock is from this machine's, in ms: the zone the session gave it
 * with `SetDateTime`, less this process's own zone at the time of the recording. A timestamp the
 * instrument wrote names no zone, so reading it here (`parseAlf`'s `startedAt`) lands this much
 * after the instant it was written; adding it to a recording instant gives the same reading.
 * Zero when the session set no zone, or when the test runs in the instrument's.
 */
function zoneShiftMs(rec: Recording): number {
  const localOffsetMin = -rec.startedAt.getTimezoneOffset();
  return ((rec.zoneOffsetMin ?? localOffsetMin) - localOffsetMin) * 60_000;
}

/**
 * An emulator whose `CurrentRun` holds what the recording's instrument held, in the order it
 * listed it — so the listing string, and with it the length `GETFILESLEN` answers, is comparable
 * to the real one rather than merely the same length by luck — and whose block and lid sit where
 * the recording's did: the block at its idle reading, the lid where the preheat began. The lid
 * matters: a lid still warm from an earlier run shortens the preheat (`usb.md` §7.3), and the
 * qPCR session's was at 37.7 °C.
 */
function seededEmulator(spec: RecordingSpec, rec: Recording): CfxEmulator {
  const clock = manualClock();
  const initialRunFolder: Record<string, Uint8Array> = {};
  for (const name of spec.initialNames(rec)) {
    initialRunFolder[name] = rec.archive[name] ?? new Uint8Array(0);
  }
  const idle = rec.polls[0]!.fields;
  const preheating = rec.polls.find((p) => (Number(p.fields[7]) & 0x08) !== 0)!.fields;
  // The emulator stamps its files in this process's local time and does not move its clock for
  // `SetDateTime` (§11). So its start is the recording's, shifted by the difference between the
  // zone the session set and this machine's — which makes its local time the instrument's, and
  // its report's name comparable, wherever the test runs.
  const emulator = createCfxEmulator({
    clock,
    startedAt: new Date(rec.startedAt.getTime() + zoneShiftMs(rec)),
    initialRunFolder,
    data: spec.plateReads ? recordedRunData(rec.archive) : null,
    temperatures: { blockC: Number(idle[0]), lidC: Number(preheating[1]) },
  });
  for (const [name, bytes] of Object.entries(spec.initialReports(rec))) {
    emulator.instrument.fs.write(`${RUN_REPORTS}\\${name}`, bytes);
  }
  return emulator;
}

// ---- comparison --------------------------------------------------------------------------

interface Divergence {
  kind: string;
  command: string;
  detail: string;
}

/** A 36-character GUID, whichever instrument minted it. */
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const maskGuids = (s: string) => s.replace(new RegExp(GUID.source, "g"), "<guid>");

/** The reply as text with the terminator removed — the form `parseResponse` works on. */
function replyText(payload: Uint8Array): string {
  return LATIN1.decode(payload).replace(/\r?\n$/, "");
}

/** Which of the three reply shapes (`usb.md` §3) a payload is. */
function shapeOf(text: string): "value;code" | "code" {
  return /^\d{4}$/.test(text) ? "code" : "value;code";
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A `STATUS?` phase, decoded from the status register (`usb.md` §3.2). */
function phaseOf(fields: string[]): string {
  const reg = Number(fields[7]);
  if (reg === 0) return "idle";
  if (!(reg & 0x40)) return reg & 0x80 ? "finished-cancelled" : "finished";
  if (reg & 0x08) return "preheat";
  // Register 97 with the step already `IDLE` — see `finish-register-transient`.
  if (fields[4] === "IDLE") return "finishing";
  return reg & 0x01 ? "hold" : "ramp";
}

/** A field counts as populated when it carries something other than a zero or an empty string —
 * which is what "the same fields are filled in" has to mean when the values themselves cannot
 * match. */
function populated(fields: string[]): number[] {
  const out: number[] = [];
  fields.forEach((f, i) => {
    if (f !== "" && f !== "0" && f !== "0.00" && f !== '"",BLOCK,OFF') out.push(i);
  });
  return out;
}

interface StatusSide {
  /** Coarse phase, then fields 2/3, step number and text, deduplicated — the edges a follower keys
   * on. Ramp and hold are one phase here: the at-target bit's timing is the populated-fields
   * check's business, and both sides' bit can flicker at a step change. */
  edges: string[];
  /** Per phase, the union of the field indices ever populated in it. */
  populatedByPhase: Map<string, Set<number>>;
  /** Every distinct run descriptor (field 6) seen, in the order they appeared. The one part of
   * `STATUS?` that *can* be compared for equality: it is built out of the operands the host sent
   * (`usb.md` §7.3), so both sides should spell it the same. */
  descriptors: string[];
  samples: { phase: string; fields: string[] }[];
}

function emptyStatusSide(): StatusSide {
  return { edges: [], populatedByPhase: new Map(), descriptors: [], samples: [] };
}

function observeStatus(side: StatusSide, fields: string[]): void {
  const phase = phaseOf(fields);
  const coarse = phase === "ramp" || phase === "hold" ? "running" : phase;
  const edge = `${coarse} ${fields[2]}/${fields[3]} step=${fields[5]} ${fields[4]}`;
  if (side.edges[side.edges.length - 1] !== edge) side.edges.push(edge);
  // The cancelled bit changes the register's value, not which fields carry anything, so the two
  // finished states share a bucket here and are told apart in the edge sequence.
  const bucket = phase === "finished-cancelled" ? "finished" : phase;
  const set = side.populatedByPhase.get(bucket) ?? new Set<number>();
  for (const i of populated(fields)) set.add(i);
  side.populatedByPhase.set(bucket, set);
  const descriptor = fields[6] ?? "";
  if (!side.descriptors.includes(descriptor)) side.descriptors.push(descriptor);
  side.samples.push({ phase, fields });
}

interface Replay {
  spec: RecordingSpec;
  rec: Recording;
  emulator: CfxEmulator;
  divergences: Divergence[];
  failures: string[];
  real: StatusSide;
  emu: StatusSide;
  counts: Map<string, number>;
  unanswered: string[];
  /** Commands whose reply was compared byte-for-byte and matched. */
  exact: number;
  /** Of those, `GETFILE` transfers — whole files, served back out of the emulator. */
  filesExact: number;
  /** The emulated run's schedule, once `RemoteRun` has made one. */
  schedule: ScheduledStep[];
  /** Simulated ms the emulated run's protocol started — after its start window and preheat. */
  protocolStartAtMs: number | null;
  /** How far the replay's clock runs ahead of the recording's from the acknowledgement on — see
   * `run-duration-model`. */
  offsetMs: number;
}

/** `GETFILE`/`GETFILESIZE` of a file that should not be byte-identical, and why — or null. */
function expectedFileDifference(spec: RecordingSpec, rec: Recording, file: string, mine: Uint8Array, theirs: Uint8Array): string | null {
  if (rec.ownReports.has(file)) return DIVERGENCES.reportClock;
  if (spec === HEAT_BLOCK && spec.initialNames(rec).includes(file)) return DIVERGENCES.archiveCopyDiffers;
  if (/^Read\d{5}\.Plateread$/.test(file) && mine.length === theirs.length) return DIVERGENCES.syntheticPlateRead;
  if (file === "runlog.xml") return DIVERGENCES.runlogVerbatim;
  if (file === "RunInfo.xml") {
    const a = parseRunInfoRaw(LATIN1.decode(mine));
    const b = parseRunInfoRaw(LATIN1.decode(theirs));
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const differing = [...keys].filter((k) => a[k] !== b[k]);
    return differing.every((k) => RUN_OWN_KEYS.has(k)) ? DIVERGENCES.runIdentity : null;
  }
  return null;
}

/**
 * Drive the emulator with the recording, command for command.
 *
 * Two rewrites are applied to the host's own commands, and both are forced by replaying a
 * transcript at a *different* instrument rather than by any doubt about the emulator:
 *
 * - The GUID `COMPUTEFILECRC` hands back is the instrument's; the host's next `GETFILECRC` quotes
 *   it. Replaying that line verbatim would ask the emulator about a file only the real
 *   instrument ever had, so the recorded GUID is mapped to the emulator's own.
 * - The clock is advanced to each record's own timestamp, so the emulator's run sits at the same
 *   wall-clock moment the real one did. Its internal phase boundaries are its own, which is why
 *   phases are compared as a *sequence* and never per-poll.
 *
 * And for the qPCR session one reordering (`deposit-in-start-window`): the deposit the recording
 * made inside the start window is held back and sent just before the first poll that shows the run.
 */
function replay(spec: RecordingSpec): Replay {
  const rec = loadRecording(spec.path, spec.inStepFrom);
  const emulator = seededEmulator(spec, rec);
  const clock = emulator.clock as ReturnType<typeof manualClock>;
  const out: Replay = {
    spec,
    rec,
    emulator,
    divergences: [],
    failures: [],
    real: emptyStatusSide(),
    emu: emptyStatusSide(),
    counts: new Map(),
    unanswered: [],
    exact: 0,
    filesExact: 0,
    schedule: [],
    protocolStartAtMs: null,
    offsetMs: 0,
  };
  const note = (kind: string, command: string, detail: string) => {
    if (out.divergences.length < 2000) out.divergences.push({ kind, command, detail });
  };
  if (rec.skipped > 0) {
    note(DIVERGENCES.staleRepliesAtConnect, "*IDN? … BASESN?", `${rec.skipped} leading exchanges skipped`);
  }
  const guidMap = new Map<string, string>();
  const deferred: Exchange[] = [];
  let deferring = false;

  const compare = (ex: Exchange, inDeposit: boolean) => {
    out.counts.set(ex.verb, (out.counts.get(ex.verb) ?? 0) + 1);
    let line = ex.command;
    for (const [recorded, mine] of [...guidMap, ...rec.ownReports]) line = line.split(recorded).join(mine);

    const reply: EmulatorReply | null = emulator.instrument.handle(line, ex.payload);
    if (!reply) {
      out.unanswered.push(ex.command.slice(0, 80));
      return;
    }
    if (ex.verb === "RemoteRun") {
      const run = emulator.instrument.currentRun!;
      out.schedule = run.schedule.steps;
      out.protocolStartAtMs = run.protocolStartsAtMs;
    }
    const mine = replyText(reply.payload);
    const theirs = replyText(ex.reply.payload);

    // The terminator, first: it is a property of every text reply and is checked once here
    // rather than inside each family below.
    if (/\r?\n$/.test(LATIN1.decode(ex.reply.payload)) && ex.verb !== "GETFILE") {
      note(DIVERGENCES.crlfTerminator, ex.verb, "instrument ends this reply CRLF; emulator does not");
    }

    // Inside the held-back deposit, the instrument was answering about a folder its clear was
    // still sweeping: everything but the upload cycle's own success is the recording's, not ours.
    if (inDeposit && !["CRCSENDFILE", "COMPUTEFILECRC", "GETFILECRC"].includes(ex.verb)) {
      if (!bytesEqual(reply.payload, ex.reply.payload)) {
        note(DIVERGENCES.depositInStartWindow, `${ex.verb} ${fileOf(ex.command)}`.trim(), `${mine.slice(0, 50)} vs ${theirs.slice(0, 50)}`);
      }
      return;
    }

    switch (ex.verb) {
      case "STATUS?": {
        const theirFields = parseResponse(ex.reply.payload).fields;
        const myResponse = parseResponse(reply.payload);
        if (myResponse.code !== parseResponse(ex.reply.payload).code) {
          out.failures.push(`STATUS? code ${myResponse.code} vs ${theirs.slice(-4)}`);
        }
        if (myResponse.fields.length !== theirFields.length) {
          out.failures.push(
            `STATUS? has ${myResponse.fields.length} fields, instrument had ${theirFields.length}`,
          );
        }
        observeStatus(out.real, theirFields);
        observeStatus(out.emu, myResponse.fields);
        break;
      }
      case "RTSTATUS?": {
        const mineFields = parseResponse(reply.payload).fields;
        const theirsFields = parseResponse(ex.reply.payload).fields;
        if (mineFields.length !== theirsFields.length) {
          out.failures.push(`RTSTATUS? ${mineFields.length} fields vs ${theirsFields.length}`);
        }
        break;
      }
      case "GETFILE": {
        if (reply.passThrough) {
          note(DIVERGENCES.getfilePassthrough, ex.verb, "emulator marks the file reply passThrough");
        }
        if (bytesEqual(reply.payload, ex.reply.payload)) {
          out.exact++;
          out.filesExact++;
        } else {
          const detail = `${reply.payload.length} B vs ${ex.reply.payload.length} B`;
          const file = fileOf(ex.command);
          const kind = expectedFileDifference(spec, rec, file, reply.payload, ex.reply.payload);
          if (kind) note(kind, `${ex.verb} ${file}`, detail);
          else out.failures.push(`GETFILE ${file}: served ${detail}`);
        }
        break;
      }
      default: {
        // Everything else answers `<value>;<code>` or a bare code, or — for the measured binary
        // answers — four raw bytes. All three are compared in full.
        if (ex.reply.text === null && !/^\d{4}$/.test(theirs) && !theirs.includes(";")) {
          if (!bytesEqual(reply.payload, ex.reply.payload)) {
            out.failures.push(
              `${ex.verb}: binary reply ${[...reply.payload].join(",")} vs ` +
                `${[...ex.reply.payload].join(",")}`,
            );
          } else out.exact++;
          break;
        }
        const myShape = shapeOf(mine);
        const theirShape = shapeOf(theirs);
        if (myShape !== theirShape) {
          out.failures.push(`${ex.verb}: reply shape ${myShape}, instrument gave ${theirShape}`);
          break;
        }
        const myCode = parseResponse(reply.payload).code;
        const theirCode = parseResponse(ex.reply.payload).code;
        if (myCode !== theirCode) {
          out.failures.push(`${ex.verb} ${fileOf(ex.command)}: result code ${myCode}, instrument gave ${theirCode}`);
          break;
        }
        if (maskGuids(mine) === maskGuids(theirs)) {
          out.exact++;
        } else {
          const kind = kindOfValueDifference(spec, rec, ex, mine, theirs, reply);
          if (kind === null) {
            out.failures.push(
              `${ex.verb} ${fileOf(ex.command)}: answered ${mine.slice(0, 80)}, ` +
                `instrument answered ${theirs.slice(0, 80)}`,
            );
            break;
          }
          note(kind, `${ex.verb} ${fileOf(ex.command)}`.trim(), `${mine.slice(0, 60)} vs ${theirs.slice(0, 60)}`);
        }
        break;
      }
    }
    if (ex.verb === "COMPUTEFILECRC") {
      const recorded = theirs.split(";")[0]!.split("\\").pop()!;
      const ours = mine.split(";")[0]!.split("\\").pop()!;
      guidMap.set(recorded.replace(/^"|"$/g, ""), ours.replace(/^"|"$/g, ""));
    }
  };

  let lastRealPhase = "idle";
  for (const ex of rec.exchanges) {
    if (ex.verb === "CANCEL" && lastRealPhase === "finished" && out.protocolStartAtMs !== null) {
      // The acknowledgement (`run-duration-model`): the session sent it because it *saw* the
      // finish, so it goes to the emulator at the emulator's finish — never into its last hold,
      // where it would be an abort. Everything after shifts by the same amount, so the release
      // and the cool-down keep their timing relative to the acknowledgement.
      const emuFinish = out.protocolStartAtMs + out.schedule.at(-1)!.endMs;
      // As long after the emulator's finish as the CANCEL came after the instrument's last poll
      // that was still running — the most the real finish can have preceded it by.
      const lastRunning = [...rec.polls].reverse().find((p) => p.atMs < ex.atMs && phaseOf(p.fields) !== "finished");
      const sinceFinish = lastRunning ? ex.atMs - lastRunning.atMs : 0;
      const shift = emuFinish + sinceFinish - (ex.atMs + out.offsetMs);
      if (shift > 0) {
        out.offsetMs += shift;
        note(DIVERGENCES.runDurationModel, "CANCEL", `the emulator's run finished ${(shift / 1000).toFixed(2)} s after the instrument's; acknowledged at its own finish`);
      }
    }
    if (ex.verb === "STATUS?") lastRealPhase = phaseOf(parseResponse(ex.reply.payload).fields);
    const target = Math.max(0, ex.atMs + out.offsetMs);
    if (target > clock.now()) clock.advance(target - clock.now());

    if (spec.deferDeposit) {
      if (ex.verb === "ADDCYCLES") {
        deferring = true;
      } else if (deferring && ex.verb !== "STATUS?" && ex.verb !== "RTSTATUS?") {
        deferred.push(ex);
        continue;
      } else if (deferring && ex.verb === "STATUS?" && Number(parseResponse(ex.reply.payload).fields[7]) !== 0) {
        // The first poll that shows the run: the client deposits now, so the replay does.
        deferring = false;
        for (const d of deferred) compare(d, true);
      }
    }
    compare(ex, false);
  }

  // Differences that belong to the session as a whole rather than to any one command, recorded
  // here so they appear in the same list as the rest.
  for (const [phase, real] of out.real.populatedByPhase) {
    const mine = out.emu.populatedByPhase.get(phase);
    const missing = mine ? [...real].filter((i) => !mine.has(i)) : [];
    if (phase === "ramp" && missing.join() === "9,12") {
      note(
        DIVERGENCES.atTargetFlicker,
        "STATUS?",
        "a poll reported not-at-target with the hold clock already running; the emulator's " +
          "at-target bit never falls back once a step has arrived",
      );
    }
  }
  if (out.real.populatedByPhase.has("finishing")) {
    note(DIVERGENCES.finishRegisterTransient, "STATUS?", "IDLE with register 97 before the 32 of §7.6");
  }
  return out;
}

/** The path a file command names, for a readable report line. */
function fileOf(command: string): string {
  const m = /\\([^\\"]+)"?$/.exec(command.trim());
  return m ? m[1]! : "";
}

/** True for two `.alf` names (`<yyyymmdd>_<hhmmss>_<serial>_<NAME>.alf`) identical but for a time
 * of day at most 2 s apart — `report-clock`, and nothing wider. */
function sameReportBut2s(a: string, b: string): boolean {
  const re = /^(\d{8})_(\d\d)(\d\d)(\d\d)(_.+\.alf)$/;
  const x = re.exec(a);
  const y = re.exec(b);
  if (!x || !y || x[1] !== y[1] || x[5] !== y[5]) return false;
  const secs = (m: RegExpExecArray) => Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  return Math.abs(secs(x) - secs(y)) <= 2;
}

/**
 * Which documented reason a value difference falls under, or null when there is none — in which
 * case it is a bug in the emulator and the caller fails the run naming the command.
 *
 * This is the part of the test that decides what "close enough" means, so each branch has to be
 * narrow enough that a real mistake cannot slip through it: a listing is excused only when it holds
 * exactly the same names, or the same plus the staging GUID and the recording's named extras; a
 * length only when it is over by exactly those; a file only when the file itself is one of the
 * known kinds.
 */
function kindOfValueDifference(
  spec: RecordingSpec,
  rec: Recording,
  ex: Exchange,
  mine: string,
  theirs: string,
  reply: EmulatorReply,
): string | null {
  if (ex.verb === "GETFREESPACE" || ex.verb === "COMPUTEFILECRC") return DIVERGENCES.instrumentValue;
  if (ex.verb === "LISTALLFILES") {
    const ours = namesOf(mine);
    const them = namesOf(theirs);
    const extra = ours.filter((n) => !them.includes(n));
    const missing = them.filter((n) => !ours.includes(n));
    if (missing.length === 1 && extra.length === 1 && sameReportBut2s(missing[0]!, extra[0]!)) {
      rec.ownReports.set(missing[0]!, extra[0]!);
      return DIVERGENCES.reportClock;
    }
    if (missing.length > 0) return null;
    if (extra.length === 0) {
      return [...ours].sort().join() === [...them].sort().join() ? DIVERGENCES.listingOrder : null;
    }
    const named = extra.filter((n) => n !== "<guid>");
    if (extra.filter((n) => n === "<guid>").length > 1) return null;
    if (named.some((n) => !(n in spec.emulatorOnlyNames))) return null;
    return named.length > 0 ? spec.emulatorOnlyNames[named[0]!]! : DIVERGENCES.stagingGuidLifetime;
  }
  if (ex.verb === "GETFILESLEN") {
    // 36 characters of GUID plus the comma that joins it, and each named extra plus its comma.
    const over = Number(mine.split(";")[0]) - Number(theirs.split(";")[0]);
    const extras = Object.keys(spec.emulatorOnlyNames).map((n) => n.length + 1);
    for (const guids of [0, 1]) {
      for (const subset of [[], extras]) {
        const expected = guids * 37 + subset.reduce((a, b) => a + b, 0);
        if (expected !== 0 && over === expected) {
          return subset.length > 0
            ? Object.values(spec.emulatorOnlyNames)[0]!
            : DIVERGENCES.stagingGuidLifetime;
        }
      }
    }
    return null;
  }
  if (ex.verb === "GETFILESIZE") {
    const file = fileOf(ex.command);
    const kind = expectedFileDifference(spec, rec, file, reply.payload, ex.reply.payload);
    if (kind === DIVERGENCES.syntheticPlateRead) return null; // a read's size must match
    return kind;
  }
  return null;
}

/**
 * Step durations on the instrument's own clocks: field 8 less field 11 less field 12 is the moment
 * the step began, whatever the poll's phase; the next step's start is this one's end. Keyed by
 * `<step text>` after `<previous step text>`, since a step's ramp depends on where it came from.
 */
function measuredDurations(polls: { fields: string[] }[]): Map<string, number[]> {
  const starts: { key: string; text: string; start: number }[] = [];
  for (const { fields } of polls) {
    const reg = Number(fields[7]);
    if (!(reg & 0x40) || reg & 0x08 || fields[4] === "IDLE") continue;
    const key = `${fields[3]}:${fields[5]}`;
    const start = Number(fields[8]) - Number(fields[11]) - Number(fields[12]);
    if (starts.at(-1)?.key !== key) starts.push({ key, text: fields[4]!, start });
  }
  const out = new Map<string, number[]>();
  for (let i = 1; i + 1 < starts.length; i++) {
    const k = `${starts[i - 1]!.text} → ${starts[i]!.text}`;
    (out.get(k) ?? out.set(k, []).get(k)!).push(starts[i + 1]!.start - starts[i]!.start);
  }
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

// ---- the checks ---------------------------------------------------------------------------

function sharedChecks(session: Replay) {
  it("replays the whole log, and answers every command", () => {
    // A command the emulator does not implement at all is the one failure that cannot be argued
    // about: the instrument answered it and we would not.
    expect(session.unanswered).toEqual([]);
    expect(session.rec.exchanges.length).toBeGreaterThan(5_000);
  });

  it("gives the same result code, in the same shape, to every command", () => {
    expect(session.failures).toEqual([]);
  });

  it("never disagrees for a reason that is not written down", () => {
    const unknown = session.divergences.filter((d) => !session.spec.known.has(d.kind));
    expect(unknown).toEqual([]);
  });

  it("reports the same twenty `STATUS?` fields, populated the same way in each phase", () => {
    // The values cannot match, so what is compared is which fields carry anything at all, phase
    // by phase. The exceptions are written down rather than filtered out: `at-target-flicker` and
    // `finish-register-transient`.
    for (const [phase, real] of session.real.populatedByPhase) {
      if (phase === "finishing") continue;
      const mine = session.emu.populatedByPhase.get(phase);
      expect(mine, `the emulator never reached the ${phase} phase`).toBeDefined();
      const missing = [...real].filter((i) => !mine!.has(i)).sort((a, b) => a - b);
      const extra = [...mine!].filter((i) => !real.has(i)).sort((a, b) => a - b);
      expect(extra, `fields the emulator populates in ${phase} and the instrument does not`).toEqual(
        [],
      );
      if (phase === "ramp" && missing.join() === "9,12") continue;
      expect(missing, `fields the instrument populates in ${phase} and the emulator does not`).toEqual(
        [],
      );
    }
  });

  it("spells the run descriptor exactly as the instrument did", () => {
    // Field 6 is built from `RemoteRun`'s own operands (`usb.md` §7.3), so unlike every other
    // part of `STATUS?` it can be compared for equality — and it is where the instrument's name
    // mangling shows: uppercased, cut to eight, spaces turned into underscores.
    expect(session.emu.descriptors).toEqual(session.real.descriptors);
  });

  it("keeps every `STATUS?` value it invents inside a plausible range", () => {
    let previousElapsed = -1;
    for (const { phase, fields } of session.emu.samples) {
      const block = Number(fields[0]);
      const lid = Number(fields[1]);
      const elapsed = Number(fields[8]);
      const remaining = Number(fields[10]);
      expect(block).toBeGreaterThan(0);
      expect(block).toBeLessThanOrEqual(105);
      expect(lid).toBeGreaterThan(0);
      expect(lid).toBeLessThanOrEqual(110);
      expect(remaining).toBeGreaterThanOrEqual(0);
      // A run's elapsed clock only ever advances, which is the invariant the whole follower is
      // built on (`emulator.md` §6).
      if (phase !== "idle") expect(elapsed).toBeGreaterThanOrEqual(0);
      if (phase === "ramp" || phase === "hold") {
        expect(elapsed).toBeGreaterThanOrEqual(previousElapsed);
        previousElapsed = elapsed;
      }
      expect(fields[17]).toBe("CLOSED");
    }
  });

  it("prints what it found, differences included", () => {
    const byKind = new Map<string, Divergence[]>();
    for (const d of session.divergences) {
      (byKind.get(d.kind) ?? byKind.set(d.kind, []).get(d.kind)!).push(d);
    }
    const lines = [
      `${session.spec.label}: commands replayed: ${session.rec.exchanges.length}`,
      `  by verb: ${[...session.counts]
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => `${v}×${n}`)
        .join(" ")}`,
      `replies matching byte for byte (terminator and GUIDs aside): ${session.exact}` +
        `, of which ${session.filesExact} whole-file transfers`,
      `run edges, instrument: ${session.real.edges.length}, emulator: ${session.emu.edges.length}`,
      "known differences:",
      ...[...byKind].map(([kind, list]) => {
        const where = [...new Set(list.map((d) => d.command))].slice(0, 6).join(", ");
        return `  ${kind} ×${list.length} — ${where}${list.length > 6 ? ", …" : ""}: ${list[0]!.detail}`;
      }),
    ];
    console.log(lines.join("\n"));
    expect(session.failures).toEqual([]);
  });
}

const heatBlock = replay(HEAT_BLOCK);
const qpcr = replay(QPCR);
const cooldown = replay(COOLDOWN);


describe("the emulator against the heat-block session", () => {
  sharedChecks(heatBlock);

  it("answers the identity block and the file transfers byte for byte", () => {
    // Of the 222 commands that are not a status poll, all but the handful in the divergence list
    // come back exactly as the instrument's did — including the whole final pull: 45 plate
    // reads, 32 `.Dcal`s, the run log and the report, and the CRCs computed over them.
    // Pinned, not bounded: the replies that don't match are enumerated in the known set, so any
    // other one moving is a change in what the emulator says and should have to be looked at.
    expect(heatBlock.exact).toBe(213);
    expect(heatBlock.filesExact).toBe(82);
  });

  it("passes through the same run edges in the same order", () => {
    // The values differ — a different clock ran — but the *sequence* a run follower keys on must
    // not: idle, the lid preheat, each step in protocol order, then a finished state the
    // instrument holds until it is acknowledged (`usb.md` §7.6). The acknowledgement goes to the
    // emulator at its own finish (`run-duration-model`) — this run's lid heated at 0.469 °C/s
    // against the emulator's 0.455, so its preheat ran ~7 s long — and is an acknowledgement
    // there too, not an abort.
    expect(heatBlock.emu.edges).toEqual(heatBlock.real.edges);
    expect(heatBlock.real.edges.at(-1)).toBe("finished 0/0 step=0 IDLE");
  });

  it("runs each step for as long as the instrument did", () => {
    // From the instrument's own clocks: a step's ramp follows from how far the block goes.
    const measured = measuredDurations(heatBlock.rec.polls);
    const steps = heatBlock.schedule;
    // 30 → 42 → 95: measured 2703.97 s for the 2700 s hold and its 12 °C ramp.
    expect(Math.abs(steps[1]!.endMs - steps[1]!.startMs - 1000 * median(measured.get("TEMP 30.0,600 → TEMP 42.0,2700")!))).toBeLessThan(1_000);
  });
});

describe("the emulator against the qPCR session", () => {
  sharedChecks(qpcr);

  it("skips only the stale replies at connect", () => {
    // `*IDN?` was answered with a status line, and the four commands after it with the reply
    // meant for the one before — the bug `CfxDevice.identify` now turns away.
    expect(qpcr.rec.skipped).toBe(5);
  });

  it("answers the identity block and the file transfers byte for byte", () => {
    // Every file the emulator is handed rather than makes comes back exactly — the 32 `.Dcal`s, the
    // deposited plate and `zpcrweb.json`, the previous run's report, `ProtocolRunDefinition.txt`
    // (CRLF and all) and `lastplatereadstatus`; the 45 plate reads are synthetic and RunInfo.xml
    // and runlog.xml the run's own, each a named kind above. Pinned, as above.
    expect(qpcr.exact).toBe(161);
    expect(qpcr.filesExact).toBe(36);
  });

  it("passes through the same run edges in the same order, field 2 included", () => {
    // Field 2 is the loop's total once its `GOTO` has run — `1/1` through cycle 1, `45/2` from the
    // second (`usb.md` §3.2). Every step of all 45 cycles, then the §7.6 hold: the emulator finished
    // a minute earlier, so it was holding the run for longer, but the sequence is the same.
    const real = qpcr.real.edges.filter((e) => !e.startsWith("finishing"));
    expect(qpcr.emu.edges).toEqual(real);
    expect(real).toContain("running 1/1 step=4 PLATEREAD #h3F");
    expect(real).toContain("running 45/2 step=2 TEMP 95.0,15");
    expect(real.at(-1)).toBe("finished 0/0 step=0 IDLE");
  });

  it("starts, preheats and runs each step for as long as the instrument did", () => {
    const { polls } = qpcr.rec;
    const remoteRunAt = qpcr.rec.exchanges.find((e) => e.verb === "RemoteRun")!.atMs;
    // The start window: the run was first seen 11.88 s after `RemoteRun`, the poll before at
    // 10.38 s still idle — the emulator's must fall between.
    const firstRun = polls.findIndex((p) => p.atMs > remoteRunAt && p.fields[7] !== "0");
    expect(START_WINDOW_PLATE_READ_MS).toBeGreaterThan(polls[firstRun - 1]!.atMs - remoteRunAt);
    expect(START_WINDOW_PLATE_READ_MS).toBeLessThanOrEqual(polls[firstRun]!.atMs - remoteRunAt);

    // The preheat, from the lid the run started with: within 3 s of the instrument's 124.5 s.
    const preheatEnded = polls.find((p) => p.atMs > polls[firstRun]!.atMs && !(Number(p.fields[7]) & 0x08))!;
    const realProtocolStart = preheatEnded.atMs - 1000 * Number(preheatEnded.fields[8]);
    expect(Math.abs(qpcr.protocolStartAtMs! - realProtocolStart)).toBeLessThan(3_000);

    // Each kind of step, against the median of its 44–45 measured instances.
    const measured = measuredDurations(polls);
    const emulated = (from: string, to: string) => {
      const i = qpcr.schedule.findIndex((s, k) => k > 0 && s.directive.text === to && qpcr.schedule[k - 1]!.directive.text === from && s.repeat > 1);
      const s = qpcr.schedule[i]!;
      return (s.endMs - s.startMs) / 1000;
    };
    for (const [from, to, toleranceS] of [
      ["PLATEREAD #h3F", "TEMP 95.0,15", 1.5], // a 35 °C ramp up and a 15 s hold: 26.95 s
      ["TEMP 95.0,15", "TEMP 60.0,60", 1.5], // a 35 °C ramp down and a 60 s hold: 75.48 s
      ["TEMP 60.0,60", "PLATEREAD #h3F", 1.0], // a read: 12.50 s
    ] as const) {
      const real = median(measured.get(`${from} → ${to}`)!);
      expect(Math.abs(emulated(from, to) - real), `${from} → ${to}: ${real} s measured`).toBeLessThan(toleranceS);
    }

    // And the whole protocol within 1.5 % — the per-step errors do not compound into minutes.
    const realTotalS = Number(polls.find((p) => p.fields[4] === "IDLE" && p.fields[6] !== '"",BLOCK,OFF')!.fields[8]);
    const emuTotalS = qpcr.schedule.at(-1)!.endMs / 1000;
    expect(Math.abs(emuTotalS - realTotalS) / realTotalS).toBeLessThan(0.015);
  });

  it("is still holding the run when the session lists the folder 0.3 s after its CANCEL", () => {
    // The listing the recording took straight after the acknowledgement had the final read and no
    // `ended` — and the emulator, `RELEASE_MS` from letting go, agrees (`usb.md` §7.6). This is the
    // listing that left the archive with no `ended` and no report.
    const latest = (verb: string) => [...qpcr.rec.exchanges].reverse().find((e) => e.verb === verb)!;
    const cancelAt = latest("CANCEL").atMs;
    const last = latest("LISTALLFILES");
    expect(last.atMs - cancelAt).toBeLessThan(500);
    const names = namesOf(last.reply.payload);
    expect(names).toContain("Read00045.Plateread");
    expect(names).not.toContain("ended");
    expect(qpcr.real.edges.at(-1)).toBe("finished 0/0 step=0 IDLE");
  });
});

describe("the emulator against the heat-block session with its cool-down", () => {
  sharedChecks(cooldown);

  const exchange = (verb: string) => cooldown.rec.exchanges.find((e) => e.verb === verb)!;
  const cancel = exchange("CANCEL");

  it("answers the identity block and the file transfers byte for byte", () => {
    // The connect-time pull of the previous run (`zpcrweb.json`, `RunInfo.xml`, its report) comes
    // back exactly, served out of what the session itself fetched; and the end-of-run report is the
    // instrument's size to the byte (471), its listing the same length. Pinned, as above.
    expect(cooldown.exact).toBe(41);
    expect(cooldown.filesExact).toBe(3);
  });

  it("passes through the same run edges in the same order, back to the empty idle", () => {
    // The only recording that goes on polling after the acknowledgement, so the only one whose
    // edges end on the release: finished and held, then the empty idle.
    expect(cooldown.emu.edges).toEqual(cooldown.real.edges);
    expect(cooldown.real.edges.slice(-2)).toEqual(["finished 0/0 step=0 IDLE", "idle 0/0 step=0 IDLE"]);
  });

  it("runs each step for as long as the instrument did, and only the preheat is long", () => {
    const measured = measuredDurations(cooldown.rec.polls);
    const steps = cooldown.schedule;
    // 30 → 42: measured 2703.98 s, the same 12 °C ramp and 2700 s hold as the other heat-block run.
    const real = median(measured.get("TEMP 30.0,600 → TEMP 42.0,2700")!);
    expect(Math.abs((steps[1]!.endMs - steps[1]!.startMs) / 1000 - real)).toBeLessThan(1);
    // The protocol as a whole — 3623.12 s on the instrument's own clock at its finish — within 2 s.
    const realTotalS = Number(cooldown.rec.polls.find((p) => phaseOf(p.fields) === "finished")!.fields[8]);
    expect(Math.abs(steps.at(-1)!.endMs / 1000 - realTotalS)).toBeLessThan(2);
    // What made the emulator's run finish later is the preheat from a 22.3 °C lid, stated rather
    // than asserted around: the emulator heats linearly at one rate and the lid's first minute is
    // faster (`emulator.md` §11). Bounded, so a regression there still shows.
    const shiftS = cooldown.offsetMs / 1000;
    expect(shiftS).toBeGreaterThan(0);
    expect(shiftS).toBeLessThan(16);
  });

  it("holds the run named after the acknowledgement, with the report already listed", () => {
    // Recorded: still named 0.41 s after the `CANCEL`, the `.alf` listed at 0.49 s, the empty idle
    // by 1.96 s (`usb.md` §7.6). The emulator's release falls inside that bracket, and its report
    // is there from the `CANCEL` on — which is what let the listing pair the two names.
    const after = cooldown.rec.polls.filter((p) => p.atMs > cancel.atMs);
    const named = (p: { fields: string[] }) => p.fields[6] !== '"",BLOCK,OFF';
    const lastNamed = after.filter(named).at(-1)!;
    const released = after.find((p) => !named(p))!;
    expect(lastNamed.atMs - cancel.atMs).toBeLessThan(RELEASE_MS);
    expect(released.atMs - cancel.atMs).toBeGreaterThanOrEqual(RELEASE_MS);
    const listed = cooldown.rec.exchanges.find((e) => e.verb === "LISTALLFILES" && e.atMs > cancel.atMs)!;
    expect(listed.atMs - cancel.atMs).toBeLessThan(lastNamed.atMs - cancel.atMs + 500);
    expect(namesOf(listed.reply.payload).some((n) => n.endsWith(".alf"))).toBe(true);
    expect(cooldown.rec.ownReports.size).toBe(1);
  });

  it("writes the run report the instrument wrote, its clock started at RemoteRun", () => {
    const [recordedName, emulatorName] = [...cooldown.rec.ownReports][0]!;
    const fetched = cooldown.rec.exchanges.find((e) => e.verb === "GETFILE" && e.command.endsWith(recordedName))!;
    const real = parseAlf(fetched.reply.payload);
    const mine = parseAlf(cooldown.emulator.instrument.fs.read(`${RUN_REPORTS}\\${emulatorName}`)!);
    expect(mine.problems).toEqual([]);
    // Everything but the clock, verbatim.
    const omitClock = ({ timeBegan, timeEnd, totalElapsed, totalElapsedSeconds, startedAt, ...rest }: typeof real.header) => rest;
    expect(omitClock(mine.header)).toEqual(omitClock(real.header));
    expect(mine.runDefinition).toBe(real.runDefinition);
    expect(mine.errors).toEqual(real.errors);
    expect(mine.completionPhrase).toBe(real.completionPhrase);
    const shape = (r: typeof real) => r.steps.map((x) => [x.repeat, x.stepNumber, x.setpointText, x.holdSeconds]);
    expect(shape(mine)).toEqual(shape(real));

    // The clock. The header starts at `RemoteRun` on both, to the second. Both reports are read on
    // the instrument's wall clock (the emulator's is seeded to it), so `RemoteRun` is too.
    const realStart = real.header.startedAt!.getTime();
    const myStart = mine.header.startedAt!.getTime();
    const remoteRunAt =
      cooldown.rec.startedAt.getTime() + exchange("RemoteRun").atMs + zoneShiftMs(cooldown.rec);
    expect(Math.abs(realStart - remoteRunAt)).toBeLessThanOrEqual(1_000);
    expect(Math.abs(myStart - realStart)).toBeLessThanOrEqual(2_000);
    // Step 1 is stamped as the run appears, before the preheat: 2 s in on the instrument, the start
    // window on the emulator.
    const stamp = (r: typeof real, i: number) => r.steps[i]!.startedAt!.getTime();
    expect(stamp(real, 0) - realStart).toBeLessThan(START_WINDOW_MS);
    expect(stamp(mine, 0) - myStart).toBeLessThanOrEqual(START_WINDOW_MS + 1_000);
    // Every later step is stamped at its own start, so the gaps between stamps — the durations a
    // reader takes from them (`alf.md` §7.4) — agree to within 2 s. Step 1's own gap carries the
    // preheat, and so does the elapsed total, which runs from `RemoteRun` to the finish: the
    // instrument's 01:02:55, the emulator's longer by its preheat and by nothing else.
    for (let i = 1; i + 1 < real.steps.length; i++) {
      const gap = (r: typeof real) => stamp(r, i + 1) - stamp(r, i);
      expect(Math.abs(gap(mine) - gap(real))).toBeLessThanOrEqual(2_000);
    }
    expect(real.header.totalElapsedSeconds).toBe(3775);
    const extraS = mine.header.totalElapsedSeconds! - real.header.totalElapsedSeconds!;
    expect(Math.abs(extraS - cooldown.offsetMs / 1000)).toBeLessThanOrEqual(2);
  });

  it("cools the block and lid after the finish as the instrument did, for the whole hour", () => {
    // Polls are index-aligned between the two sides, and from the first poll that shows the run
    // finished each side is the same time past its own finish — the replay put the
    // acknowledgement there. So the hour of idle polls compares block to block and lid to lid. The
    // tolerance is the cooling fit's own worst case (1.9 °C block, 1.3 °C lid) plus the room: the
    // instrument's sat at 19.8 °C, the emulator's ambient is 18.4 (`AMBIENT_C`).
    const start = cooldown.real.samples.findIndex((x) => x.phase === "finished");
    const worst = { block: 0, lid: 0 };
    let n = 0;
    for (let i = start; i < cooldown.real.samples.length; i++) {
      const real = cooldown.real.samples[i]!.fields;
      const mine = cooldown.emu.samples[i]!.fields;
      worst.block = Math.max(worst.block, Math.abs(Number(mine[0]) - Number(real[0])));
      worst.lid = Math.max(worst.lid, Math.abs(Number(mine[1]) - Number(real[1])));
      n++;
    }
    console.log(`cool-down over ${n} polls: worst block ${worst.block.toFixed(2)} °C, lid ${worst.lid.toFixed(2)} °C`);
    expect(n).toBeGreaterThan(2_000); // an hour, at a poll every 1.5 s
    expect(worst.block).toBeLessThan(4);
    expect(worst.lid).toBeLessThan(3);
  });
});
