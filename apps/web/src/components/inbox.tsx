'use client';

import type { CaseSummary, Locale } from '@demo/shared';
import { Columns3, LayoutList } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentsPanel } from '@/components/agents-panel';
import { AlertBadges, LanguageBadge, VerdictBadge } from '@/components/case-badges';
import { PipelinePills, StageLabel } from '@/components/pipeline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useRouter } from '@/i18n/navigation';
import { coreApi } from '@/lib/api';
import { useNotifications } from '@/lib/notifications';
import { useRealtime } from '@/lib/realtime';
import { caseGroup, type CaseGroup } from '@/lib/stage';
import { useStored } from '@/lib/use-stored';
import { cn } from '@/lib/utils';

type Tab = 'all' | 'inProgress' | 'toApprove' | 'done' | 'failed';
type View = 'table' | 'board';

const TABS: Tab[] = ['all', 'inProgress', 'toApprove', 'done', 'failed'];
const BOARD: CaseGroup[] = ['queued', 'agents', 'toApprove', 'done', 'failed'];
const VIEW_KEY = 'demo.inboxView';
const SEEN_KEY = 'demo.seenCases';
const HIGHLIGHT_MS = 3_000;
/** Above this many new cases at once (a burst), no toast and no animation. */
const QUIET_ABOVE = 5;
const BOARD_LIMIT = 25;

function inTab(tab: Tab, kase: CaseSummary): boolean {
  const group = caseGroup(kase.stage);
  switch (tab) {
    case 'all':
      return true;
    case 'inProgress':
      return group === 'queued' || group === 'agents';
    default:
      return group === tab;
  }
}

/** `read_clause CG-HZ-12.1`: the tool and its most telling argument. */
function toolLabel(params: Record<string, unknown>): string | null {
  const { tool, ...args } = params;
  if (typeof tool !== 'string') return null;
  const argument = Object.values(args).find((value) => typeof value === 'string');
  return argument ? `${tool} ${argument}` : tool;
}

export function Inbox() {
  return (
    <div className="space-y-4">
      <AgentsPanel />
      <CaseList />
    </div>
  );
}

function CaseList() {
  const t = useTranslations('inbox');
  const tLocale = useTranslations('locale');
  const tNotify = useTranslations('notify');
  const locale = useLocale();
  const router = useRouter();
  const { notify } = useNotifications();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [language, setLanguage] = useState<Locale | 'all'>('all');
  const [tab, setTab] = useState<Tab>('all');
  const [view, setView] = useStored<View>(VIEW_KEY, 'table');
  const [seenIds, setSeenIds] = useStored<string[]>(SEEN_KEY, []);
  const seen = useMemo(() => new Set(seenIds), [seenIds]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    coreApi
      .cases()
      .then((next) => {
        const previous = known.current;
        known.current = new Set(next.map((kase) => kase.id));
        setCases(next);
        if (!previous) return; // first load: nothing is "new"
        const arrived = next.filter((kase) => !previous.has(kase.id));
        if (arrived.length === 0 || arrived.length > QUIET_ABOVE) return;
        setFresh((current) => new Set([...current, ...arrived.map((kase) => kase.id)]));
        setTimeout(
          () =>
            setFresh((current) => {
              const remaining = new Set(current);
              for (const kase of arrived) remaining.delete(kase.id);
              return remaining;
            }),
          HIGHLIGHT_MS,
        );
        for (const kase of arrived) {
          notify({
            title: tNotify('newEmail', { from: kase.clientName ?? kase.from }),
            body: kase.subject,
            href: `/${locale}/cases/${kase.id}`,
          });
        }
      })
      .catch(() => undefined);
  }, [locale, notify, tNotify]);

  // At most one reload every 400 ms, whatever the event rate.
  const scheduleLoad = useCallback(() => {
    if (reloadTimer.current) return;
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      load();
    }, 400);
  }, [load]);

  useEffect(load, [load]);
  const { connected } = useRealtime((event) => {
    if (event.type === 'demo.reset') {
      known.current = new Set();
      setCases([]);
      return;
    }
    if (event.type === 'case.agent_event' && event.caseId) {
      // Patched in place: no reload for each tool call.
      const { eventType, params } = event.data as {
        eventType?: string;
        params?: Record<string, unknown>;
      };
      setCases((current) =>
        current.map((kase) => {
          if (kase.id !== event.caseId) return kase;
          if (eventType === 'step_started' && typeof params?.step === 'string') {
            return {
              ...kase,
              status: 'processing',
              stage: params.step as CaseSummary['stage'],
              currentTool: null,
            };
          }
          if (eventType === 'tool_call' && params) {
            return { ...kase, currentTool: toolLabel(params) };
          }
          return kase;
        }),
      );
      return;
    }
    if (event.type !== 'case.step') scheduleLoad();
  });

  const open = (id: string) => {
    if (!seen.has(id)) setSeenIds([...seenIds, id].slice(-500));
    router.push(`/cases/${id}`);
  };

  const byLanguage = useMemo(
    () => (language === 'all' ? cases : cases.filter((kase) => kase.language === language)),
    [cases, language],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((candidate) => [
          candidate,
          byLanguage.filter((kase) => inTab(candidate, kase)).length,
        ]),
      ) as Record<Tab, number>,
    [byLanguage],
  );
  const visible = byLanguage.filter((kase) => inTab(tab, kase));
  const rowProps = { seen, fresh, open };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-3">
        <CardTitle className="mr-auto">{t('title')}</CardTitle>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('languageFilter.label')}</span>
          <select
            className="h-8 rounded-lg border border-input bg-background px-2"
            value={language}
            onChange={(event) => setLanguage(event.target.value as Locale | 'all')}
          >
            <option value="all">{t('languageFilter.all')}</option>
            <option value="fr">{tLocale('fr')}</option>
            <option value="en">{tLocale('en')}</option>
          </select>
        </label>
        <div className="flex rounded-lg border p-0.5">
          {(['table', 'board'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              title={t(`view.${candidate}`)}
              aria-pressed={view === candidate}
              onClick={() => setView(candidate)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                view === candidate ? 'bg-muted font-medium' : 'text-muted-foreground',
              )}
            >
              {candidate === 'table' ? (
                <LayoutList className="size-3.5" />
              ) : (
                <Columns3 className="size-3.5" />
              )}
              {t(`view.${candidate}`)}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={`size-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`}
          />
          {connected ? t('live') : t('offline')}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {view === 'table' && (
          <nav className="flex flex-wrap gap-1 border-b">
            {TABS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setTab(candidate)}
                className={cn(
                  '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm',
                  tab === candidate
                    ? 'border-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`tabs.${candidate}`)}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs tabular-nums',
                    candidate === 'toApprove' && counts.toApprove > 0
                      ? 'bg-amber-500 text-white'
                      : candidate === 'failed' && counts.failed > 0
                        ? 'bg-red-500 text-white'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {counts[candidate]}
                </span>
              </button>
            ))}
          </nav>
        )}
        {byLanguage.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : view === 'board' ? (
          <Board cases={byLanguage} {...rowProps} />
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('emptyTab')}</p>
        ) : (
          <CaseTable cases={visible} {...rowProps} />
        )}
      </CardContent>
    </Card>
  );
}

interface RowProps {
  seen: Set<string>;
  fresh: Set<string>;
  open: (id: string) => void;
}

function UnreadDot({ unread }: { unread: boolean }) {
  const t = useTranslations('inbox');
  return (
    <span
      title={unread ? t('unread') : undefined}
      className={cn('size-2 shrink-0 rounded-full', unread ? 'bg-blue-500' : 'bg-transparent')}
    />
  );
}

function CaseTable({ cases, seen, fresh, open }: RowProps & { cases: CaseSummary[] }) {
  const t = useTranslations('inbox');
  const format = useFormatter();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('columns.reference')}</TableHead>
          <TableHead>{t('columns.receivedAt')}</TableHead>
          <TableHead>{t('columns.client')}</TableHead>
          <TableHead>{t('columns.subject')}</TableHead>
          <TableHead>{t('columns.progress')}</TableHead>
          <TableHead>{t('columns.verdict')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cases.map((kase) => {
          const unread = !seen.has(kase.id);
          return (
            <TableRow
              key={kase.id}
              className={cn(
                'cursor-pointer transition-colors duration-1000',
                fresh.has(kase.id) && 'animate-in slide-in-from-top-2 fade-in bg-blue-50',
                kase.stage === 'awaiting_approval' && 'bg-amber-50/60',
              )}
              onClick={() => open(kase.id)}
            >
              <TableCell>
                <span className="flex items-center gap-2">
                  <UnreadDot unread={unread} />
                  <span className={cn('font-mono text-xs', unread && 'font-semibold')}>
                    {kase.reference}
                  </span>
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">
                {format.dateTime(new Date(kase.receivedAt), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </TableCell>
              <TableCell>
                <div className={cn(unread && 'font-semibold')}>
                  {kase.clientName ?? t('unknownClient')}
                </div>
                <div className="text-xs text-muted-foreground">{kase.from}</div>
              </TableCell>
              <TableCell className="max-w-72">
                <div className="flex items-center gap-2">
                  <LanguageBadge language={kase.language} />
                  <span className={cn('truncate', unread && 'font-semibold')}>{kase.subject}</span>
                </div>
              </TableCell>
              <TableCell className="min-w-48">
                <div className="flex flex-col gap-1">
                  <PipelinePills stage={kase.stage} status={kase.status} />
                  <StageLabel
                    stage={kase.stage}
                    currentTool={kase.currentTool}
                    revision={kase.revision}
                  />
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <VerdictBadge verdict={kase.verdict} />
                  <AlertBadges alerts={kase.alerts} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

const COLUMN_STYLES: Record<CaseGroup, string> = {
  queued: 'border-t-slate-300',
  agents: 'border-t-blue-400',
  toApprove: 'border-t-amber-400',
  done: 'border-t-emerald-400',
  failed: 'border-t-red-400',
};

/** Read-only board: cards move from column to column as the agents work. */
function Board({ cases, seen, fresh, open }: RowProps & { cases: CaseSummary[] }) {
  const t = useTranslations('inbox');
  const columns = BOARD.map((group) => ({
    group,
    cases: cases.filter((kase) => caseGroup(kase.stage) === group),
  }));
  return (
    <div className="grid gap-3 md:grid-cols-5">
      {columns.map(({ group, cases: inColumn }) => (
        <div
          key={group}
          className={cn(
            'flex min-h-40 flex-col gap-2 rounded-lg border-t-4 bg-muted/40 p-2',
            COLUMN_STYLES[group],
          )}
        >
          <div className="flex items-center justify-between px-1 text-sm font-medium">
            {t(`board.${group}`)}
            <span className="rounded-full bg-background px-1.5 text-xs tabular-nums">
              {inColumn.length}
            </span>
          </div>
          {inColumn.slice(0, BOARD_LIMIT).map((kase) => (
            <button
              key={kase.id}
              type="button"
              onClick={() => open(kase.id)}
              className={cn(
                'space-y-1.5 rounded-md border bg-background p-2 text-left text-xs shadow-xs transition-all hover:shadow-md',
                fresh.has(kase.id) && 'animate-in zoom-in-95 fade-in ring-2 ring-blue-300',
                group === 'toApprove' && 'border-amber-300',
              )}
            >
              <div className="flex items-center gap-1.5">
                <UnreadDot unread={!seen.has(kase.id)} />
                <span className="font-mono">{kase.reference}</span>
                <LanguageBadge language={kase.language} />
              </div>
              <div className="truncate font-medium">{kase.clientName ?? kase.from}</div>
              <div className="truncate text-muted-foreground">{kase.subject}</div>
              <PipelinePills stage={kase.stage} status={kase.status} compact />
              <StageLabel
                stage={kase.stage}
                currentTool={kase.currentTool}
                revision={kase.revision}
              />
            </button>
          ))}
          {inColumn.length > BOARD_LIMIT && (
            <span className="px-1 text-xs text-muted-foreground">
              {t('more', { count: inColumn.length - BOARD_LIMIT })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
