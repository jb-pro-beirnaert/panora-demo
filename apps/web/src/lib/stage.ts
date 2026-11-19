import type { CaseStage, CaseStatus } from '@demo/shared';

/** The five pills of a case's pipeline (V13). */
export const PIPELINE = ['triage', 'coverage', 'drafting', 'approval', 'execute'] as const;
export type PipelineStep = (typeof PIPELINE)[number];

export type PillState = 'pending' | 'running' | 'done' | 'waiting' | 'failed' | 'skipped';

/** Index of the step a stage is at (the steps before it are done). */
const POSITION: Partial<Record<CaseStage, number>> = {
  triage: 0,
  coverage: 1,
  drafting: 2,
  awaiting_approval: 3,
  execute: 4,
};

/** State of each pill, from the live stage of the case. */
export function pipelineStates(kase: {
  stage: CaseStage;
  status: CaseStatus;
}): Record<PipelineStep, PillState> {
  const states = Object.fromEntries(PIPELINE.map((step) => [step, 'pending'])) as Record<
    PipelineStep,
    PillState
  >;
  if (kase.stage === 'done') {
    // Not a claim: classified after triage, the rest of the pipeline does not apply.
    const classified = kase.status === 'classified';
    for (const step of PIPELINE)
      states[step] = classified && step !== 'triage' ? 'skipped' : 'done';
    return states;
  }
  if (kase.stage === 'failed') {
    states.execute = 'failed';
    return states;
  }
  const position = POSITION[kase.stage];
  if (position === undefined) return states; // queued
  PIPELINE.forEach((step, index) => {
    if (index < position) states[step] = 'done';
    else if (index === position) states[step] = step === 'approval' ? 'waiting' : 'running';
  });
  return states;
}

/** Inbox tabs and board columns. */
export type CaseGroup = 'queued' | 'agents' | 'toApprove' | 'done' | 'failed';

export function caseGroup(stage: CaseStage): CaseGroup {
  switch (stage) {
    case 'queued':
      return 'queued';
    case 'awaiting_approval':
      return 'toApprove';
    case 'done':
      return 'done';
    case 'failed':
      return 'failed';
    default:
      return 'agents';
  }
}

/** A running stage (an agent, or the execution, is working on the case). */
export function isRunning(stage: CaseStage): boolean {
  return ['triage', 'coverage', 'drafting', 'execute'].includes(stage);
}
