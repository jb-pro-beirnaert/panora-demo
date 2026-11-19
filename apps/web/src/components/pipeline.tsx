'use client';

import type { CaseStage, CaseStatus } from '@demo/shared';
import { Check, Hourglass, Loader2, Minus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PIPELINE, pipelineStates, type PillState } from '@/lib/stage';
import { cn } from '@/lib/utils';

const PILL_STYLES: Record<PillState, string> = {
  pending: 'border-slate-200 bg-slate-50 text-slate-400',
  running: 'border-blue-300 bg-blue-50 text-blue-700',
  done: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  waiting: 'border-amber-400 bg-amber-100 text-amber-900 animate-pulse',
  failed: 'border-red-300 bg-red-50 text-red-700',
  skipped: 'border-dashed border-slate-200 bg-transparent text-slate-300',
};

function PillIcon({ state, className }: { state: PillState; className?: string }) {
  switch (state) {
    case 'running':
      return <Loader2 className={cn('animate-spin', className)} />;
    case 'done':
      return <Check className={className} />;
    case 'waiting':
      return <Hourglass className={className} />;
    case 'failed':
      return <X className={className} />;
    case 'skipped':
      return <Minus className={className} />;
    default:
      return <span className={cn('rounded-full bg-current opacity-40', className)} />;
  }
}

/** Compact pipeline of an inbox row: Triage → Coverage → Drafting → Approval → Execution. */
export function PipelinePills({
  stage,
  status,
  compact = false,
}: {
  stage: CaseStage;
  status: CaseStatus;
  /** Board cards: smaller pills. */
  compact?: boolean;
}) {
  const t = useTranslations('pipeline');
  const states = pipelineStates({ stage, status });
  return (
    <span className="flex items-center gap-0.5">
      {PIPELINE.map((step, index) => (
        <span key={step} className="flex items-center gap-0.5">
          {index > 0 && <span className={cn('h-px bg-slate-300', compact ? 'w-0.5' : 'w-1.5')} />}
          <span
            title={`${t(step)} — ${t(`state.${states[step]}`)}`}
            className={cn(
              'flex items-center justify-center rounded-full border transition-colors duration-500',
              compact ? 'size-5' : 'size-6',
              PILL_STYLES[states[step]],
            )}
          >
            <PillIcon state={states[step]} className={compact ? 'size-2.5' : 'size-3'} />
          </span>
        </span>
      ))}
    </span>
  );
}

/** Large pipeline at the top of a case page, with the duration of each finished step. */
export function PipelineStepper({
  stage,
  status,
  durations,
}: {
  stage: CaseStage;
  status: CaseStatus;
  durations: Partial<Record<(typeof PIPELINE)[number], string>>;
}) {
  const t = useTranslations('pipeline');
  const states = pipelineStates({ stage, status });
  return (
    <ol className="flex flex-wrap items-stretch gap-2">
      {PIPELINE.map((step, index) => (
        <li key={step} className="flex flex-1 items-center gap-2">
          <div
            className={cn(
              'flex min-w-28 flex-1 items-center gap-2 rounded-lg border px-3 py-2 transition-colors duration-500',
              PILL_STYLES[states[step]],
            )}
          >
            <PillIcon state={states[step]} className="size-4 shrink-0" />
            <div className="leading-tight">
              <div className="text-sm font-medium">{t(step)}</div>
              <div className="text-xs opacity-80">
                {durations[step] ?? t(`state.${states[step]}`)}
              </div>
            </div>
          </div>
          {index < PIPELINE.length - 1 && (
            <span className="hidden h-px w-3 bg-slate-300 sm:block" />
          )}
        </li>
      ))}
    </ol>
  );
}

/** Current stage in words, with the tool the running agent called last. */
export function StageLabel({
  stage,
  currentTool,
  revision,
}: {
  stage: CaseStage;
  currentTool: string | null;
  revision: number;
}) {
  const t = useTranslations('stage');
  return (
    <span className="flex flex-col">
      <span
        className={cn(
          'text-xs font-medium',
          stage === 'awaiting_approval' && 'text-amber-700',
          stage === 'failed' && 'text-red-700',
          stage === 'done' && 'text-emerald-700',
          ['triage', 'coverage', 'drafting', 'execute'].includes(stage) && 'text-blue-700',
        )}
      >
        {t(stage)}
        {stage === 'drafting' && revision > 0 && ` · ${t('revision', { revision: revision + 1 })}`}
      </span>
      {currentTool && (
        <span className="truncate font-mono text-[11px] text-muted-foreground">{currentTool}</span>
      )}
    </span>
  );
}
