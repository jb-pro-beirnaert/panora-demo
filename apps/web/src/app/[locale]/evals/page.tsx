import type { EvalReport } from '@demo/shared';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { traceUrl } from '@/lib/config';
import { loadEvalReports } from '@/lib/eval-reports';

export const dynamic = 'force-dynamic';

const caseCorrect = (report: EvalReport) =>
  report.aggregates.find((a) => a.agent === 'workflow' && a.scorer === 'case_correct')?.mean ??
  null;

export default async function EvalsPage({ params }: PageProps<'/[locale]/evals'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('evals');
  const tAgent = await getTranslations('agent');
  const format = await getFormatter();
  const reports = await loadEvalReports();
  const latest = reports[0];
  const pct = (value: number | null | undefined) =>
    value === null || value === undefined
      ? '—'
      : format.number(value, { style: 'percent', maximumFractionDigits: 1 });

  if (!latest) {
    return <p className="text-muted-foreground">{t('empty')}</p>;
  }
  const failing = latest.cases.filter((result) =>
    result.scores.some((score) => score.agent === 'workflow' && score.value === 0),
  );
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            {t('latest')} —{' '}
            {format.dateTime(new Date(latest.startedAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('models')} :{' '}
            {Object.entries(latest.models)
              .map(([agent, model]) => `${tAgent(agent)} ${model}`)
              .join(' · ')}{' '}
            — {t('judge')} : {latest.judge ?? t('judgeOff')}
            {latest.costPerCaseUsd != null && (
              <>
                {' '}
                — {t('cost')} :{' '}
                {format.number(latest.costPerCaseUsd, {
                  style: 'currency',
                  currency: 'USD',
                  maximumFractionDigits: 4,
                })}
              </>
            )}
            {latest.latencyMs && (
              <>
                {' '}
                — {t('latency')} :{' '}
                {format.number(latest.latencyMs.p50 / 1000, { maximumFractionDigits: 0 })} s /{' '}
                {format.number(latest.latencyMs.p95 / 1000, { maximumFractionDigits: 0 })} s
              </>
            )}
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.agent')}</TableHead>
                <TableHead>{t('columns.scorer')}</TableHead>
                <TableHead className="text-right">{t('columns.score')}</TableHead>
                <TableHead className="text-right">{t('columns.fr')}</TableHead>
                <TableHead className="text-right">{t('columns.en')}</TableHead>
                <TableHead className="text-right">{t('columns.cases')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {latest.aggregates.map((aggregate) => (
                <TableRow key={`${aggregate.agent}/${aggregate.scorer}`}>
                  <TableCell>{tAgent(aggregate.agent)}</TableCell>
                  <TableCell className="font-mono text-xs">{aggregate.scorer}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {pct(aggregate.mean)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(aggregate.byLanguage.fr)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(aggregate.byLanguage.en)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{aggregate.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('failing')}</CardTitle>
        </CardHeader>
        <CardContent>
          {failing.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noFailing')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.case')}</TableHead>
                  <TableHead>{t('columns.scenario')}</TableHead>
                  <TableHead>{t('columns.language')}</TableHead>
                  <TableHead>{t('columns.reason')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {failing.map((result) => (
                  <TableRow key={result.id}>
                    <TableCell className="font-mono text-xs">{result.id}</TableCell>
                    <TableCell>{result.scenario}</TableCell>
                    <TableCell className="uppercase">{result.language}</TableCell>
                    <TableCell className="text-xs">
                      {result.error ??
                        result.scores.find((score) => score.agent === 'workflow')?.comment}
                    </TableCell>
                    <TableCell>
                      {result.traceId && traceUrl(result.traceId) && (
                        <a
                          href={traceUrl(result.traceId)!}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          {t('viewTrace')} ↗
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('history')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.date')}</TableHead>
                <TableHead>{t('columns.dataset')}</TableHead>
                <TableHead className="text-right">{t('columns.caseCorrect')}</TableHead>
                <TableHead className="text-right">{t('cost')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((report) => (
                <TableRow key={report.runId}>
                  <TableCell>
                    {format.dateTime(new Date(report.startedAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                  <TableCell>
                    {report.dataset.name} ({report.dataset.size})
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(caseCorrect(report))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {report.costPerCaseUsd != null
                      ? format.number(report.costPerCaseUsd, {
                          style: 'currency',
                          currency: 'USD',
                          maximumFractionDigits: 4,
                        })
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
