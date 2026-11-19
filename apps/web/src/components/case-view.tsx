'use client';

import type { AgentEventView, AgentStepView, CaseDetail, ProposedActionView } from '@demo/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { Bot, Cpu, ExternalLink, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertBadges, LanguageBadge, StatusBadge, VerdictBadge } from '@/components/case-badges';
import { PipelineStepper } from '@/components/pipeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@/i18n/navigation';
import { ApiError, coreApi } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { studioRunUrl, traceUrl } from '@/lib/config';
import { isRunning, type PipelineStep } from '@/lib/stage';
import {
  renderAgentEvent,
  renderAudit,
  renderStep,
  type Formatters,
  type Translate,
} from '@/lib/render';
import { cn } from '@/lib/utils';

function useFormatters(): Formatters {
  const format = useFormatter();
  return useMemo(
    () => ({
      money: (value: number) => format.number(value, { style: 'currency', currency: 'EUR' }),
      date: (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium' }),
    }),
    [format],
  );
}

/** The insurer's status differs from what the brokerage believes (scenario 2). */
function isMismatch(step: AgentStepView): boolean {
  return (
    step.stepType === 'coverage.policy_checked' &&
    typeof step.params.knownStatus === 'string' &&
    step.params.knownStatus !== step.params.status
  );
}

export function CaseView({ caseId }: { caseId: string }) {
  const t = useTranslations();
  const [kase, setKase] = useState<CaseDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    coreApi
      .case(caseId)
      .then((next) => {
        setKase(next);
        setMissing(false);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setMissing(true);
      });
  }, [caseId]);

  useEffect(load, [load]);
  useRealtime((event) => {
    if (event.type === 'demo.reset') setMissing(true);
    else if (event.caseId === caseId) load();
  });

  if (missing) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-muted-foreground">{t('case.notFound')}</p>
      </div>
    );
  }
  if (!kase) return <p className="text-muted-foreground">{t('case.loading')}</p>;

  const mismatch = kase.steps.find(isMismatch);
  return (
    <div className="space-y-4">
      <BackLink />
      <CaseHeader kase={kase} />
      <CaseStepper kase={kase} />
      {mismatch && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">
          {t('case.policyMismatch', {
            policyNumber: String(mismatch.params.policyNumber),
            known: t(`policyStatus.${String(mismatch.params.knownStatus)}`),
            actual: t(`policyStatus.${String(mismatch.params.status)}`),
          })}
        </div>
      )}
      {kase.status === 'failed' && <FailedBanner kase={kase} onRetried={load} />}
      {kase.claimNumber && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {t('case.claimFiled', { claimNumber: kase.claimNumber })}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <EmailCard kase={kase} />
          <TimelineCard kase={kase} />
        </div>
        <div className="space-y-4">
          <ProposalCard kase={kase} onDecided={load} />
          <UnderTheHoodCard kase={kase} />
          <AuditCard kase={kase} />
        </div>
      </div>
    </div>
  );
}

/** Failed case: the reason, and a button to relaunch it from the start (V9). */
function FailedBanner({ kase, onRetried }: { kase: CaseDetail; onRetried: () => void }) {
  const t = useTranslations('case');
  const [sending, setSending] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <span className="mr-auto">{t('failed', { reason: kase.failureReason ?? '—' })}</span>
      <Button
        size="sm"
        variant="outline"
        title={t('retryHint')}
        disabled={sending}
        onClick={async () => {
          setSending(true);
          try {
            await coreApi.retry(kase.id);
            onRetried();
          } finally {
            setSending(false);
          }
        }}
      >
        {t('retry')}
      </Button>
    </div>
  );
}

function BackLink() {
  const t = useTranslations('case');
  return (
    <Link href="/" className="text-sm text-muted-foreground hover:underline">
      ← {t('back')}
    </Link>
  );
}

function CaseHeader({ kase }: { kase: CaseDetail }) {
  const t = useTranslations('case');
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="font-mono text-lg font-semibold">{kase.reference}</span>
        <StatusBadge status={kase.status} />
        <VerdictBadge verdict={kase.verdict} />
        <AlertBadges alerts={kase.alerts} />
        <span className="text-sm">
          <span className="text-muted-foreground">{t('brokerage')} </span>
          {kase.brokerage.name}
        </span>
        <span className="text-sm">
          <span className="text-muted-foreground">{t('client')} </span>
          {kase.client?.companyName ?? '—'}
        </span>
        <span className="text-sm">
          <span className="text-muted-foreground">{t('policy')} </span>
          {kase.policyNumber ?? '—'}
        </span>
      </CardContent>
    </Card>
  );
}

function EmailCard({ kase }: { kase: CaseDetail }) {
  const t = useTranslations('case');
  const format = useFormatter();
  const { email } = kase;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('email')} <LanguageBadge language={email.language} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{t('from')}</dt>
          <dd>{email.from}</dd>
          <dt className="text-muted-foreground">{t('to')}</dt>
          <dd>{email.to}</dd>
          <dt className="text-muted-foreground">{t('receivedAt')}</dt>
          <dd>
            {format.dateTime(new Date(email.receivedAt), { dateStyle: 'long', timeStyle: 'short' })}
          </dd>
        </dl>
        <div className="font-medium">{email.subject}</div>
        <p className="whitespace-pre-wrap">{email.body}</p>
        <div>
          <div className="mb-1 font-medium">{t('attachments')}</div>
          {email.attachments.length === 0 ? (
            <p className="text-muted-foreground">{t('noAttachment')}</p>
          ) : (
            email.attachments.map((attachment) => (
              <details key={attachment.fileName} className="rounded border p-2">
                <summary className="cursor-pointer font-mono text-xs">
                  {attachment.fileName}
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">
                  {attachment.extractedText}
                </pre>
              </details>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type TimelineItem =
  | { kind: 'step'; at: string; step: AgentStepView }
  | { kind: 'event'; at: string; event: AgentEventView };

function TimelineCard({ kase }: { kase: CaseDetail }) {
  const { steps, agentEvents: events } = kase;
  const t = useTranslations();
  const format = useFormatter();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('case.timeline')}</CardTitle>
      </CardHeader>
      <CardContent>
        {steps.length === 0 && events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('case.timelineEmpty')}</p>
        ) : (
          <ol className="space-y-3">
            {[
              ...steps.map((step): TimelineItem => ({ kind: 'step', at: step.createdAt, step })),
              ...events.map((event): TimelineItem => ({
                kind: 'event',
                at: event.createdAt,
                event,
              })),
            ]
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((item) =>
                item.kind === 'event' ? (
                  <li
                    key={item.event.id}
                    className="ml-4 flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span className="size-1.5 rounded-full bg-blue-400" />
                    <span className="font-mono">
                      {format.dateTime(new Date(item.at), { timeStyle: 'medium' })}
                    </span>
                    <span>{renderAgentEvent(item.event, t as Translate)}</span>
                  </li>
                ) : (
                  <StepItem key={item.step.id} step={item.step} />
                ),
              )}
          </ol>
        )}
        {isRunning(kase.stage) && <RunningLine kase={kase} />}
      </CardContent>
    </Card>
  );
}

function StepItem({ step }: { step: AgentStepView }) {
  const t = useTranslations();
  const format = useFormatter();
  const formatters = useFormatters();
  return (
    <li
      className={cn(
        'rounded-lg border-l-4 bg-background p-2 text-sm',
        isMismatch(step) ? 'border-red-500 bg-red-50' : 'border-muted-foreground/30',
      )}
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t(`agent.${step.agent}`)}</span>
        <span>
          {format.dateTime(new Date(step.createdAt), { timeStyle: 'medium' })}
          {step.durationMs !== null &&
            ` · ${format.number(step.durationMs / 1000, { maximumFractionDigits: 1 })} s`}
          {step.inputTokens !== null &&
            step.outputTokens !== null &&
            ` · ${t('case.tokens', {
              input: format.number(step.inputTokens),
              output: format.number(step.outputTokens),
            })}`}
        </span>
      </div>
      <div>{renderStep(step, t as Translate, formatters)}</div>
      {step.sources.length > 0 && (
        <div className="mt-1 space-y-1 text-xs text-muted-foreground">
          <span>{t('case.sources')} </span>
          {step.sources.map((source, index) => (
            <div key={`${source.ref}-${index}`}>
              <span className="font-mono">
                {source.ref}
                {source.page ? ` p.${source.page}` : ''}
              </span>
              {source.excerpt && <q className="ml-1 italic">{source.excerpt}</q>}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function ProposalCard({ kase, onDecided }: { kase: CaseDetail; onDecided: () => void }) {
  const t = useTranslations();
  const proposals = [...kase.proposedActions].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('case.proposal')}</CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          'gap-4',
          // After a rejection, the new proposal and the previous one side by side.
          proposals.length > 1 ? 'grid xl:grid-cols-2' : 'space-y-4',
        )}
      >
        {proposals.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('case.noProposal')}</p>
        )}
        {proposals.map((action) => (
          <Proposal
            key={action.id}
            kase={kase}
            action={action}
            canDecide={kase.status === 'awaiting_approval' && action.status === 'pending'}
            onDecided={onDecided}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function Proposal({
  kase,
  action,
  canDecide,
  onDecided,
}: {
  kase: CaseDetail;
  action: ProposedActionView;
  canDecide: boolean;
  onDecided: () => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const formatters = useFormatters();
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (approved: boolean) => {
    setSending(true);
    setError(null);
    try {
      await coreApi.decide(kase.id, {
        approved,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setComment('');
      onDecided();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };

  const filing = action.claimFiling as { amount?: number; date?: string } | null;
  // Decided by the simulated broker (auto-validation): marked in the audit.
  const auto = kase.auditLogs.some(
    (log) =>
      (log.action === 'action_approved' || log.action === 'action_rejected') &&
      log.params.revision === action.revision &&
      log.params.auto === true,
  );
  return (
    <div
      className={cn(
        'space-y-3 rounded-lg border p-3',
        action.status === 'pending' ? 'border-amber-300' : 'opacity-80',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t('case.revision', { revision: action.revision })}</span>
        <Badge>{t(`actionType.${action.actionType}`)}</Badge>
        <Badge variant="outline">{t(`proposalStatus.${action.status}`)}</Badge>
      </div>
      {filing?.amount !== undefined && filing.date && (
        <p className="text-sm">
          {t('case.claimFiling', {
            amount: formatters.money(filing.amount),
            date: formatters.date(filing.date),
          })}
        </p>
      )}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {t('case.draft')} <LanguageBadge language={action.draftLanguage} />
        </div>
        <div className="rounded bg-muted/50 p-2 text-sm">
          <div className="font-medium">{action.draftSubject}</div>
          <p className="mt-1 whitespace-pre-wrap">{action.draftBody}</p>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {t('case.internalNote')} <LanguageBadge language={action.noteLanguage} />
        </div>
        <p className="whitespace-pre-wrap rounded bg-amber-50 p-2 text-sm">{action.internalNote}</p>
      </div>
      {action.decidedBy && action.decidedAt && (
        <p className="text-xs text-muted-foreground">
          {t('case.decided', {
            status: t(`proposalStatus.${action.status}`),
            name: action.decidedBy.name,
            date: format.dateTime(new Date(action.decidedAt), {
              dateStyle: 'short',
              timeStyle: 'short',
            }),
          })}
          {auto && (
            <Badge variant="outline" className="ml-1" title={t('case.autoHint')}>
              {t('case.auto')}
            </Badge>
          )}
          {action.comment && <> — {t('case.comment', { comment: action.comment })}</>}
        </p>
      )}
      {canDecide && (
        <div className="space-y-2">
          <Textarea
            value={comment}
            placeholder={t('case.commentPlaceholder')}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="flex gap-2">
            <Button disabled={sending} onClick={() => decide(true)}>
              {t('case.approve')}
            </Button>
            <Button variant="outline" disabled={sending} onClick={() => decide(false)}>
              {t('case.reject')}
            </Button>
          </div>
          {error && (
            <p className="text-sm text-destructive">
              {t('case.decisionError', { message: error })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AuditCard({ kase }: { kase: CaseDetail }) {
  const t = useTranslations();
  const format = useFormatter();
  const formatters = useFormatters();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('case.audit')}</CardTitle>
        {kase.traceId && traceUrl(kase.traceId) && (
          <a
            href={traceUrl(kase.traceId)!}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('case.viewTrace')} ↗
          </a>
        )}
      </CardHeader>
      <CardContent>
        <ol className="space-y-1 text-sm">
          {kase.auditLogs.map((log) => (
            <li key={log.id} className="grid grid-cols-[auto_auto_1fr] gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {format.dateTime(new Date(log.createdAt), { timeStyle: 'medium' })}
              </span>
              <span className="text-xs text-muted-foreground">
                {log.actorName ??
                  (log.actor === 'agent' ? t(`agent.${log.actorId}`) : t(`actor.${log.actor}`))}
              </span>
              <span>
                {renderAudit(log, t as Translate, formatters)}
                {log.params.auto === true && (
                  <Badge variant="outline" className="ml-1" title={t('case.autoHint')}>
                    {t('case.auto')}
                  </Badge>
                )}
                {log.source && (
                  <span className="ml-1 font-mono text-xs text-muted-foreground">
                    [{log.source}]
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Elapsed time between two instants: "42 s", "3 min 05 s". */
function useDuration() {
  const format = useFormatter();
  return (from: string | null | undefined, to: string | null | undefined): string | undefined => {
    if (!from || !to) return undefined;
    const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
    if (seconds < 60) return `${format.number(seconds)} s`;
    return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
  };
}

/** The pipeline in large, with how long each finished step took (from the step events). */
function CaseStepper({ kase }: { kase: CaseDetail }) {
  const duration = useDuration();
  const started = (step: string, which: 'first' | 'last' = 'first') => {
    const events = kase.agentEvents.filter(
      (event) => event.eventType === 'step_started' && event.params.step === step,
    );
    return (which === 'first' ? events[0] : events.at(-1))?.createdAt;
  };
  const proposals = kase.proposedActions;
  const lastProposal = proposals.at(-1);
  const closed = kase.stage === 'done';
  const durations: Partial<Record<PipelineStep, string>> = {
    triage: duration(
      started('triage'),
      started('coverage') ?? (closed ? kase.updatedAt : undefined),
    ),
    coverage: duration(started('coverage'), started('drafting')),
    drafting: duration(
      started('drafting'),
      kase.stage === 'drafting' ? undefined : lastProposal?.createdAt,
    ),
    approval: duration(lastProposal?.createdAt, lastProposal?.decidedAt),
    execute: duration(started('execute'), closed ? kase.updatedAt : undefined),
  };
  return (
    <Card>
      <CardContent>
        <PipelineStepper stage={kase.stage} status={kase.status} durations={durations} />
      </CardContent>
    </Card>
  );
}

/** Last line of the timeline while an agent works: who, and the tool it called last. */
function RunningLine({ kase }: { kase: CaseDetail }) {
  const t = useTranslations();
  const agent = kase.stage === 'execute' ? 'system' : kase.stage;
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50/60 p-2 text-sm text-blue-800">
      <Loader2 className="size-4 animate-spin" />
      <span>{t('case.running', { agent: t(`agent.${agent}`) })}</span>
      {kase.currentTool && (
        <span className="truncate font-mono text-xs text-blue-700/80">
          {t('case.lastTool', { tool: kase.currentTool })}
        </span>
      )}
    </div>
  );
}

/** Mastra and Langfuse one click away, with the case's tokens, LLM time and models. */
function UnderTheHoodCard({ kase }: { kase: CaseDetail }) {
  const t = useTranslations('case');
  const format = useFormatter();
  const studio = kase.workflowRunId ? studioRunUrl(kase.workflowRunId) : null;
  const trace = kase.traceId ? traceUrl(kase.traceId) : null;
  const sum = (pick: (step: AgentStepView) => number | null) =>
    kase.steps.reduce((total, step) => total + (pick(step) ?? 0), 0);
  const input = sum((step) => step.inputTokens);
  const output = sum((step) => step.outputTokens);
  const llmMs = sum((step) => step.durationMs);
  const models = [
    ...new Set(kase.steps.flatMap((step) => (step.model ? [step.model.split('/').at(-1)!] : []))),
  ];
  const linkClass =
    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/60 transition-colors';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="size-4" />
          {t('underTheHood')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {studio && (
            <a href={studio} target="_blank" rel="noreferrer" className={linkClass}>
              <Bot className="size-4 text-violet-600" />
              <span className="flex-1">{t('openStudio')}</span>
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </a>
          )}
          {trace && (
            <a href={trace} target="_blank" rel="noreferrer" className={linkClass}>
              <span className="size-4 rounded bg-gradient-to-br from-orange-400 to-pink-500" />
              <span className="flex-1">{t('viewTrace')}</span>
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </a>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('tokensLabel')}</dt>
          <dd className="tabular-nums">
            {input + output > 0
              ? t('tokens', { input: format.number(input), output: format.number(output) })
              : '—'}
          </dd>
          <dt className="text-muted-foreground">{t('llmTime')}</dt>
          <dd className="tabular-nums">
            {llmMs > 0 ? `${format.number(llmMs / 1000, { maximumFractionDigits: 1 })} s` : '—'}
          </dd>
          <dt className="text-muted-foreground">{t('models')}</dt>
          <dd className="font-mono text-xs">{models.length ? models.join(', ') : '—'}</dd>
          <dt className="text-muted-foreground">{t('runId')}</dt>
          <dd className="truncate font-mono text-xs">{kase.workflowRunId ?? '—'}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
