'use client';

import type { CaseMetrics, CaseStats } from '@demo/shared';
import { Check, ChevronDown, ChevronUp, Pause, Play, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { coreApi, simulatorApi, type ScriptItem, type SimulatorState } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { cn } from '@/lib/utils';

const INTERVALS = [5, 10, 20, 30, 60];
const SPARK_POINTS = 40;

/**
 * Top bar that drives the simulator (demo tool, not part of the product). V14: the demo is a fixed
 * script of e-mails, sent in order — "7/14 e-mails sent".
 */
export function DemoPanel() {
  const t = useTranslations('demo');
  const [state, setState] = useState<SimulatorState | null>(null);
  const [stats, setStats] = useState<CaseStats | null>(null);
  const [metrics, setMetrics] = useState<CaseMetrics | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  /** Throughput samples (cases closed during the last minute), one per refresh. */
  const [throughput, setThroughput] = useState<number[]>([]);
  const lastSample = useRef(0);

  const refresh = useCallback(() => {
    simulatorApi
      .state()
      .then((next) => {
        setState(next);
        setUnavailable(false);
      })
      .catch(() => setUnavailable(true));
    coreApi
      .stats()
      .then(setStats)
      .catch(() => setStats(null));
    coreApi
      .metrics()
      .then((next) => {
        setMetrics(next);
        const now = Date.now();
        if (now - lastSample.current >= 2_500) {
          lastSample.current = now;
          setThroughput((current) => [...current, next.closedLastMinute].slice(-SPARK_POINTS));
        }
      })
      .catch(() => setMetrics(null));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useRealtime((event) => {
    if (event.type === 'case.created') {
      simulatorApi
        .state()
        .then(setState)
        .catch(() => undefined);
    }
    coreApi
      .stats()
      .then(setStats)
      .catch(() => undefined);
  });

  const run = async (action: () => Promise<SimulatorState>) => {
    setBusy(true);
    try {
      setState(await action());
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const ready = state?.seeding === 'done';
  const sent = state?.sent ?? 0;
  const total = state?.total ?? 0;
  const finished = state?.status === 'finished';
  const counters: [string, number | undefined][] = [
    ['inProgress', stats?.inProgress],
    ['awaitingApproval', stats?.awaitingApproval],
    ['needsBroker', stats?.needsBroker],
    ['closed', stats?.closed],
    ['failed', stats?.failed],
  ];

  return (
    <div className="border-b border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2 text-sm">
        {unavailable ? (
          <>
            <span className="font-semibold">{t('title')}</span>
            <span className="text-destructive">{t('unavailable')}</span>
          </>
        ) : (
          <>
            <div className="flex min-w-48 flex-col gap-1">
              <span className="font-semibold tabular-nums">
                {!ready
                  ? t('seeding')
                  : finished
                    ? t('progressFinished', { sent, total })
                    : t('progress', { sent, total })}
              </span>
              <span className="h-1.5 w-full overflow-hidden rounded-full bg-amber-200 dark:bg-amber-800">
                <span
                  className="block h-full rounded-full bg-amber-600 transition-all duration-500"
                  style={{ width: total > 0 ? `${(sent / total) * 100}%` : '0%' }}
                />
              </span>
            </div>
            {state?.status === 'running' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run(simulatorApi.pause)}
              >
                <Pause className="size-3.5" /> {t('pause')}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || !ready || finished}
                onClick={() =>
                  run(state?.status === 'paused' ? simulatorApi.resume : simulatorApi.start)
                }
              >
                <Play className="size-3.5" /> {t(state?.status === 'paused' ? 'resume' : 'play')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !ready || finished}
              title={state?.next ? t('nextHint', { subject: state.next.subject }) : undefined}
              onClick={() => run(simulatorApi.sendOne)}
            >
              <Send className="size-3.5" /> {t('sendOne')}
            </Button>
            <label className="flex items-center gap-1">
              <span>{t('interval')}</span>
              <select
                className="h-7 rounded border border-amber-300 bg-background px-1"
                value={state?.intervalSeconds ?? 20}
                onChange={(event) => run(() => simulatorApi.speed(Number(event.target.value)))}
              >
                {[...new Set([...INTERVALS, state?.intervalSeconds ?? 20])]
                  .sort((a, b) => a - b)
                  .map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {t('seconds', { seconds })}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => run(simulatorApi.reset)}
            >
              {busy ? t('resetting') : t('reset')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {t('script')}
              {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </Button>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Sparkline values={throughput} title={t('throughputChart')} />
          {counters.map(([key, value]) => (
            <span key={key} className="tabular-nums">
              {t.rich('counter', {
                label: t(`counters.${key}`),
                value: String(value ?? '—'),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </span>
          ))}
          {metrics && metrics.closedLastMinute > 0 && (
            <span className="tabular-nums text-xs opacity-75">
              {t('throughput', { count: metrics.closedLastMinute })}
            </span>
          )}
        </div>
      </div>
      {open && state && <ScriptList items={state.script} next={state.next?.index ?? null} />}
    </div>
  );
}

/** The demo script: what was sent, what comes next. */
function ScriptList({ items, next }: { items: ScriptItem[]; next: number | null }) {
  const t = useTranslations('demo');
  return (
    <ol className="mx-auto grid max-w-7xl gap-x-6 gap-y-1 px-4 pb-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li
          key={item.index}
          className={cn(
            'flex items-center gap-2 rounded px-1.5 py-0.5',
            item.index === next && 'bg-amber-200/70 font-medium dark:bg-amber-800',
            item.sent && 'opacity-60',
          )}
        >
          <span className="w-5 text-right tabular-nums">{item.index}</span>
          {item.sent ? (
            <Check className="size-3 text-emerald-700" />
          ) : (
            <span className="size-3 rounded-full border border-current opacity-40" />
          )}
          <span className="truncate">{t(`scenario.${item.scenario}`)}</span>
          <span className="rounded border px-1 text-[10px] uppercase">{item.language}</span>
        </li>
      ))}
    </ol>
  );
}

/** Throughput over the last refreshes (cases closed per minute), as a tiny line. */
function Sparkline({ values, title }: { values: number[]; title: string }) {
  if (values.length < 2) return null;
  const width = 80;
  const height = 20;
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = (index / (SPARK_POINTS - 1)) * width;
      const y = height - (value / max) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={title}>
      <title>{title}</title>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
