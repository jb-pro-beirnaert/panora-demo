'use client';

import type { AgentsActivity } from '@demo/shared';
import { Bot, Hourglass, Inbox as InboxIcon, PauseCircle, Send, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { coreApi } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { cn } from '@/lib/utils';

const AGENT_COLORS = {
  triage: 'text-violet-700 bg-violet-50 border-violet-200',
  coverage: 'text-blue-700 bg-blue-50 border-blue-200',
  drafting: 'text-teal-700 bg-teal-50 border-teal-200',
} as const;

/** `openai/gpt-6-luna` → `gpt-6-luna`. */
const shortModel = (model: string | null) => model?.split('/').at(-1) ?? '—';

/**
 * V13 live agents panel: what each Mastra agent is doing right now, the queue, and the workflows
 * suspended while they wait for the broker (they consume nothing).
 */
export function AgentsPanel() {
  const t = useTranslations('agents');
  const tAgent = useTranslations('agent');
  const [activity, setActivity] = useState<AgentsActivity | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    coreApi
      .agentsActivity()
      .then(setActivity)
      .catch(() => undefined);
  }, []);

  // At most one refresh every 500 ms, whatever the event rate (a burst sends hundreds).
  const scheduleLoad = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      load();
    }, 500);
  }, [load]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5_000);
    return () => clearInterval(interval);
  }, [load]);
  useRealtime(scheduleLoad);

  return (
    <section className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,14rem)]">
      {(activity?.agents ?? []).map((agent) => {
        const busy = agent.running > 0;
        return (
          <div
            key={agent.agent}
            className={cn(
              'rounded-xl border bg-background p-3 transition-shadow',
              busy && 'shadow-sm ring-1 ring-blue-200',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'relative flex size-8 items-center justify-center rounded-lg border',
                  AGENT_COLORS[agent.agent],
                )}
              >
                <Bot className="size-4" />
                {busy && (
                  <span className="absolute -top-1 -right-1 flex size-3">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex size-3 rounded-full bg-blue-500" />
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{tAgent(agent.agent)}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {shortModel(agent.model)}
                </div>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs tabular-nums',
                  busy ? 'bg-blue-100 text-blue-800' : 'bg-muted text-muted-foreground',
                )}
              >
                {busy ? t('running', { count: agent.running }) : t('idle')}
              </span>
            </div>
            <div className="mt-2 h-5 text-xs text-muted-foreground">
              {busy && agent.current && (
                <Link
                  href={`/cases/${agent.current.caseId}`}
                  className="flex items-center gap-1.5 hover:text-foreground"
                >
                  {agent.current.tool ? (
                    <Wrench className="size-3 shrink-0" />
                  ) : (
                    <span className="flex gap-0.5">
                      <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                      <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                      <span className="size-1 animate-bounce rounded-full bg-current" />
                    </span>
                  )}
                  <span className="font-mono">{agent.current.reference}</span>
                  <span className="truncate">
                    {agent.current.tool
                      ? t('calling', { tool: agent.current.tool })
                      : t('thinking')}
                  </span>
                </Link>
              )}
            </div>
          </div>
        );
      })}
      <div className="flex flex-col justify-center gap-1.5 rounded-xl border bg-background p-3 text-xs">
        <span className="flex items-center gap-2">
          <InboxIcon className="size-3.5 text-slate-500" />
          {t('queued', { count: activity?.queued ?? 0 })}
        </span>
        <span className="flex items-center gap-2" title={t('awaitingHint')}>
          <PauseCircle className="size-3.5 text-amber-600" />
          {t('awaiting', { count: activity?.awaitingApproval ?? 0 })}
        </span>
        <span className="flex items-center gap-2">
          {activity?.executing ? (
            <Send className="size-3.5 text-emerald-600" />
          ) : (
            <Hourglass className="size-3.5 text-slate-400" />
          )}
          {t('executing', { count: activity?.executing ?? 0 })}
        </span>
      </div>
    </section>
  );
}
