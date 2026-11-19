'use client';

import type { CaseStats } from '@demo/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { coreApi, simulatorApi, type SimulatorState } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';

const SPEEDS = [1, 2, 4, 6, 10, 20, 30];
const ENGLISH_SHARES = [0, 0.1, 0.3, 0.5, 0.7, 1];

/** Top bar that drives the simulator (demo tool, not part of the product). */
export function DemoPanel() {
  const t = useTranslations('demo');
  const format = useFormatter();
  const [state, setState] = useState<SimulatorState | null>(null);
  const [stats, setStats] = useState<CaseStats | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

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
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useRealtime(() => {
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

  const counters: [string, number | undefined][] = [
    ['sent', state?.sent],
    ['inProgress', stats?.inProgress],
    ['awaitingApproval', stats?.awaitingApproval],
    ['closed', stats?.closed],
    ['failed', stats?.failed],
  ];

  return (
    <div className="border-b border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <span className="font-semibold">{t('title')}</span>
        {unavailable ? (
          <span className="text-destructive">{t('unavailable')}</span>
        ) : (
          <>
            <span className="rounded bg-amber-200/60 px-2 py-0.5 text-xs dark:bg-amber-800">
              {state?.seeding === 'pending'
                ? t('seeding')
                : t(`status.${state?.status ?? 'ready'}`)}
            </span>
            {state?.status === 'running' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run(simulatorApi.pause)}
              >
                {t('pause')}
              </Button>
            ) : state?.status === 'paused' ? (
              <Button size="sm" disabled={busy} onClick={() => run(simulatorApi.resume)}>
                {t('resume')}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || state?.seeding !== 'done'}
                onClick={() => run(simulatorApi.start)}
              >
                {t('start')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || state?.seeding !== 'done'}
              onClick={() => run(simulatorApi.sendOne)}
            >
              {t('sendOne')}
            </Button>
            <label className="flex items-center gap-1">
              <span>{t('speed')}</span>
              <select
                className="h-7 rounded border border-amber-300 bg-background px-1"
                value={state?.emailsPerMinute ?? 4}
                onChange={(event) => run(() => simulatorApi.speed(Number(event.target.value)))}
              >
                {[...new Set([...SPEEDS, state?.emailsPerMinute ?? 4])]
                  .sort((a, b) => a - b)
                  .map((speed) => (
                    <option key={speed} value={speed}>
                      {speed}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span>{t('languageMix')}</span>
              <select
                className="h-7 rounded border border-amber-300 bg-background px-1"
                value={state?.englishShare ?? 0.3}
                onChange={(event) =>
                  run(() => simulatorApi.languageMix(Number(event.target.value)))
                }
              >
                {[...new Set([...ENGLISH_SHARES, state?.englishShare ?? 0.3])]
                  .sort((a, b) => a - b)
                  .map((share) => (
                    <option key={share} value={share}>
                      {format.number(share, { style: 'percent' })}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={state?.autoValidation.enabled ?? false}
                onCheckedChange={(enabled: boolean) =>
                  run(() => simulatorApi.autoValidation({ enabled }))
                }
              />
              <span>{t('autoValidation')}</span>
              {state?.autoValidation.enabled && (
                <span className="text-xs opacity-75">
                  {t('rejectionRate', {
                    rate: format.number(state.autoValidation.rejectionRate, { style: 'percent' }),
                  })}
                </span>
              )}
            </label>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => run(simulatorApi.reset)}
            >
              {busy ? t('resetting') : t('reset')}
            </Button>
          </>
        )}
        <div className="ml-auto flex flex-wrap gap-3">
          {counters.map(([key, value]) => (
            <span key={key} className="tabular-nums">
              {t.rich('counter', {
                label: t(`counters.${key}`),
                value: String(value ?? '—'),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
