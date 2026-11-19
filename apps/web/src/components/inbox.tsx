'use client';

import type { CaseSummary, Locale } from '@demo/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { AlertBadges, LanguageBadge, StatusBadge, VerdictBadge } from '@/components/case-badges';
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
import { useRealtime } from '@/lib/realtime';

export function Inbox() {
  const t = useTranslations('inbox');
  const format = useFormatter();
  const router = useRouter();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [language, setLanguage] = useState<Locale | 'all'>('all');
  const tLocale = useTranslations('locale');
  const visible = language === 'all' ? cases : cases.filter((kase) => kase.language === language);

  const load = useCallback(() => {
    coreApi
      .cases()
      .then(setCases)
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);
  const { connected } = useRealtime((event) => {
    if (event.type === 'demo.reset') setCases([]);
    else if (event.type !== 'case.step') load();
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('title')}</CardTitle>
        <label className="ml-auto mr-4 flex items-center gap-2 text-sm">
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
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={`size-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`}
          />
          {connected ? t('live') : t('offline')}
        </span>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.reference')}</TableHead>
                <TableHead>{t('columns.receivedAt')}</TableHead>
                <TableHead>{t('columns.client')}</TableHead>
                <TableHead>{t('columns.subject')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.verdict')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((kase) => (
                <TableRow
                  key={kase.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/cases/${kase.id}`)}
                >
                  <TableCell className="font-mono text-xs">{kase.reference}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {format.dateTime(new Date(kase.receivedAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                  <TableCell>
                    <div>{kase.clientName ?? t('unknownClient')}</div>
                    <div className="text-xs text-muted-foreground">{kase.from}</div>
                  </TableCell>
                  <TableCell className="max-w-80">
                    <div className="flex items-center gap-2">
                      <LanguageBadge language={kase.language} />
                      <span className="truncate">{kase.subject}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={kase.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <VerdictBadge verdict={kase.verdict} />
                      <AlertBadges alerts={kase.alerts} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
