import type { CaseStage, CaseStatus } from '@demo/shared';

/** The five pills of a case's pipeline (V13). */
export const PIPELINE = ['triage', 'coverage', 'drafting', 'approval', 'execute'] as const;
export type PipelineStep = (typeof PIPELINE)[number];

export type PillState = 'pending' | 'running' | 'done' | 'waiting' | 'failed' | 'skipped' | 'you';

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
    // Classified (unrelated) or merged into another case after triage: the rest does not apply.
    const triageOnly = kase.status === 'classified' || kase.status === 'merged';
    for (const step of PIPELINE)
      states[step] = triageOnly && step !== 'triage' ? 'skipped' : 'done';
    return states;
  }
  if (kase.stage === 'needs_broker') {
    // V15 "À traiter par vous": the agents stopped; the broker takes over.
    states.triage = 'done';
    states.coverage = 'done';
    states.drafting = 'done';
    states.approval = 'you';
    states.execute = 'skipped';
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
export type CaseGroup = 'queued' | 'agents' | 'toApprove' | 'needsBroker' | 'done';

/** V15: a failed case is left to the broker too ("À traiter par vous"). */
export function caseGroup(stage: CaseStage): CaseGroup {
  switch (stage) {
    case 'queued':
      return 'queued';
    case 'awaiting_approval':
      return 'toApprove';
    case 'done':
      return 'done';
    case 'failed':
    case 'needs_broker':
      return 'needsBroker';
    default:
      return 'agents';
  }
}

/** A running stage (an agent, or the execution, is working on the case). */
export function isRunning(stage: CaseStage): boolean {
  return ['triage', 'coverage', 'drafting', 'execute'].includes(stage);
}
