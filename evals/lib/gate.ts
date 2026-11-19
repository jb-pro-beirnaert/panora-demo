import type { EvalAggregate, EvalReport } from '@demo/shared';

/** Minimum score (0–1) per `agent/scorer`; unknown scorers have no threshold. */
export type Thresholds = Record<string, number>;

/** A drop of more than this many points (0–100 scale) against the baseline fails the gate. */
export const MAX_REGRESSION_POINTS = 2;

export interface GateFailure {
  key: string;
  reason: string;
}

const key = (aggregate: EvalAggregate) => `${aggregate.agent}/${aggregate.scorer}`;

/**
 * CI gate: a score under its threshold, or more than 2 points under the main branch's baseline,
 * fails the run. Returns the failures (empty = pass), each with the before/after scores.
 */
export function checkGate(
  report: EvalReport,
  thresholds: Thresholds,
  baseline?: EvalReport | null,
): GateFailure[] {
  const failures: GateFailure[] = [];
  const before = new Map((baseline?.aggregates ?? []).map((a) => [key(a), a.mean]));
  for (const aggregate of report.aggregates) {
    if (aggregate.mean === null) continue;
    const name = key(aggregate);
    const after = aggregate.mean * 100;
    const threshold = thresholds[name];
    if (threshold !== undefined && aggregate.mean < threshold) {
      failures.push({
        key: name,
        reason: `${after.toFixed(1)} is below the threshold ${(threshold * 100).toFixed(1)}`,
      });
    }
    const previous = before.get(name);
    if (previous !== undefined && previous !== null) {
      const drop = previous * 100 - after;
      if (drop > MAX_REGRESSION_POINTS) {
        failures.push({
          key: name,
          reason: `dropped ${drop.toFixed(1)} points: ${(previous * 100).toFixed(1)} → ${after.toFixed(1)}`,
        });
      }
    }
  }
  return failures;
}
