import { useMemo } from "react";
import { computeRunAnalysis, type RunAnalysis, type Zpcr } from "@zpcrweb/core";
import type { FileSettings } from "../state/useZpcrStore";

export {
  curveKey,
  channelCurveKey,
  darkCurveKey,
  stepTemperature,
  type CurveAnalysis,
  type RunAnalysis,
} from "@zpcrweb/core";

/**
 * The one run-level derivation the Curves view's chart, hover cards and table mode share —
 * `@zpcrweb/core`'s `computeRunAnalysis`, re-run whenever the run, its settings or the active
 * step change. See that function's doc comment for what it computes and why; this wrapper's only
 * job is turning it into a `useMemo`, since the derivation itself has no React dependency at all
 * (and is exactly what a non-React consumer, like `tools/zpcr.ts`, calls directly).
 */
export function useRunAnalysis(
  zpcr: Zpcr,
  settings: FileSettings,
  pltdPassword: string,
  activeStep: number | undefined,
): RunAnalysis {
  return useMemo(
    () =>
      computeRunAnalysis(
        zpcr,
        // `baselineWindow` is `null` here ("follow the file") against the library's `undefined`
        // ("use the declaration"); the two are the same intent, so normalize at the boundary.
        {
          ...settings,
          baselineWindow: settings.baselineWindow ?? undefined,
          baselineMode: settings.baselineMode ?? undefined,
        },
        activeStep,
        pltdPassword || undefined,
      ),
    [
      zpcr,
      settings.thresholdOverrides,
      settings.curveThresholdOverrides,
      settings.thresholdMultiplier,
      settings.autoThresholdMethod,
      settings.calibrationNormalization,
      settings.cqMethod,
      settings.baselineSource,
      settings.cqSource,
      settings.baselineMode,
      settings.baselineWindow,
      settings.baselineDriftCorrection,
      activeStep,
      pltdPassword,
    ],
  );
}
