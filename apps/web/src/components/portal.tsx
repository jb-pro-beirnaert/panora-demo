'use client';

import type {
  AgentEventView,
  CaseDetail,
  ClientDetail,
  ClientSummary,
  InsurerClauses,
  InsurerPolicySummary,
} from '@demo/shared';
import { Eye } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LanguageBadge, StatusBadge } from '@/components/case-badges';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { ApiError, coreApi } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * V17: the insurer's extranet and the brokerage's client base, read-only. Opened from the header,
 * or from a source of a case: then "what the agent saw" sits next to the current data.
 */

function useData<T>(
  load: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({
    data: null,
    error: null,
  });
  useEffect(() => {
    let live = true;
    load()
      .then((data) => live && setState({ data, error: null }))
      .catch(
        (error) =>
          live &&
          setState({
            data: null,
            error: error instanceof ApiError ? error.message : String(error),
          }),
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function useDates() {
  const format = useFormatter();
  return {
    date: (value: string | null) =>
      value ? format.dateTime(new Date(value), { dateStyle: 'medium' }) : '—',
    money: (value: number) => format.number(value, { style: 'currency', currency: 'EUR' }),
  };
}

function PageTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="space-y-1">
      <h1 className="text-xl font-semibold">{title}</h1>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      className="h-9 w-full max-w-sm rounded-lg border border-input bg-background px-3 text-sm"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function PolicyStatus({ status }: { status: string }) {
  const t = useTranslations('policyStatus');
  return (
    <Badge
      variant="outline"
      className={cn(
        status === 'active' && 'border-emerald-300 text-emerald-800',
        status === 'terminated' && 'border-red-300 text-red-800',
        status === 'suspended' && 'border-amber-300 text-amber-800',
      )}
    >
      {t(status)}
    </Badge>
  );
}

// --- "What the agent saw" ---

/** Top-level values of a result, readable (nested objects and arrays summarised). */
function Fields({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc pl-4">
        {value.slice(0, 8).map((item, index) => (
          <li key={index}>
            <Fields value={item} />
          </li>
        ))}
        {value.length > 8 && <li>… ({value.length})</li>}
      </ul>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
        <div key={key} className="contents">
          <dt className="font-mono text-muted-foreground">{key}</dt>
          <dd className="min-w-0 break-words">
            {item !== null && typeof item === 'object' ? (
              <Fields value={item} />
            ) : (
              String(item ?? '—')
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Scalar fields that differ between what the agent received and the data now. */
function changes(saw: unknown, now: Record<string, unknown> | null): [string, unknown, unknown][] {
  if (!now || !saw || typeof saw !== 'object' || Array.isArray(saw)) return [];
  return Object.entries(saw as Record<string, unknown>).flatMap(([key, value]) => {
    if (value !== null && typeof value === 'object') return [];
    if (!(key in now)) return [];
    const current = now[key];
    return current !== value && (current === null || typeof current !== 'object')
      ? [[key, value, current] as [string, unknown, unknown]]
      : [];
  });
}

/**
 * V17: when the page is opened from a source of a case (`?case=…&event=…`), what the tool
 * returned to the agent at that moment, and what changed since.
 */
export function AgentSaw({ current }: { current?: Record<string, unknown> | null }) {
  const t = useTranslations();
  const format = useFormatter();
  const params = useSearchParams();
  const caseId = params.get('case');
  const eventId = params.get('event');
  const [kase, setKase] = useState<CaseDetail | null>(null);
  useEffect(() => {
    if (!caseId) return;
    coreApi
      .case(caseId)
      .then(setKase)
      .catch(() => setKase(null));
  }, [caseId]);
  if (!caseId || !kase) return null;
  const event: AgentEventView | undefined = kase.agentEvents.find((item) => item.id === eventId);
  const diff = event ? changes(event.result, current ?? null) : [];
  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 font-medium text-blue-900">
        <Eye className="size-4" />
        {event
          ? t('portal.saw.title', {
              agent: t(`agent.${event.agent}`),
              date: format.dateTime(new Date(event.createdAt), {
                dateStyle: 'short',
                timeStyle: 'medium',
              }),
              reference: kase.reference,
            })
          : t('portal.saw.fromCase', { reference: kase.reference })}
        <Link href={`/cases/${kase.id}`} className="ml-auto text-xs underline">
          {t('portal.saw.backToCase', { reference: kase.reference })}
        </Link>
      </div>
      {event && (
        <>
          <div className="font-mono text-xs text-muted-foreground">
            {event.params.tool}{' '}
            {Object.entries(event.params)
              .filter(([k]) => k !== 'tool')
              .map(([, v]) => v)
              .join(' ')}
          </div>
          {event.result === undefined ? (
            <p className="text-xs text-muted-foreground">{t('portal.saw.noResult')}</p>
          ) : (
            <div className="max-h-72 overflow-auto rounded bg-background p-2 text-xs">
              <Fields value={event.result} />
            </div>
          )}
          {diff.length > 0 ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <div className="font-medium">{t('portal.saw.changed')}</div>
              <ul className="list-disc pl-4">
                {diff.map(([key, before, after]) => (
                  <li key={key}>
                    {t('portal.saw.change', {
                      field: key,
                      before: String(before ?? '—'),
                      after: String(after ?? '—'),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            current && <p className="text-xs text-emerald-800">{t('portal.saw.unchanged')}</p>
          )}
        </>
      )}
    </div>
  );
}

// --- Extranet: policies ---

export function InsurerPoliciesView() {
  const t = useTranslations('portal');
  const dates = useDates();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, error } = useData(() => coreApi.insurerPolicies(debounced), [debounced]);
  return (
    <div className="space-y-4">
      <PageTitle title={t('insurer.title')} subtitle={t('insurer.subtitle')} />
      <Search value={query} onChange={setQuery} placeholder={t('insurer.search')} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('policy.number')}</TableHead>
                <TableHead>{t('policy.holder')}</TableHead>
                <TableHead>{t('policy.insurer')}</TableHead>
                <TableHead>{t('policy.product')}</TableHead>
                <TableHead>{t('policy.status')}</TableHead>
                <TableHead>{t('policy.renewal')}</TableHead>
                <TableHead>{t('policy.end')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((policy: InsurerPolicySummary) => (
                <TableRow key={policy.number}>
                  <TableCell>
                    <Link
                      href={`/insurer/policies/${policy.number}`}
                      className="font-mono text-xs text-blue-700 hover:underline"
                    >
                      {policy.number}
                    </Link>
                  </TableCell>
                  <TableCell>{policy.holderName}</TableCell>
                  <TableCell className="text-xs">{policy.insurer.name}</TableCell>
                  <TableCell className="text-xs">{policy.product}</TableCell>
                  <TableCell>
                    <PolicyStatus status={policy.status} />
                  </TableCell>
                  <TableCell className="text-xs">{dates.date(policy.renewalDate)}</TableCell>
                  <TableCell className="text-xs">
                    {policy.endDate
                      ? `${dates.date(policy.endDate)} (${t(`endReason.${policy.endReason ?? 'unknown'}`)})`
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export function InsurerPolicyPage({ number }: { number: string }) {
  const t = useTranslations('portal');
  const tPeril = useTranslations('peril');
  const dates = useDates();
  const { data: policy, error } = useData(() => coreApi.insurerPolicy(number), [number]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!policy) return <p className="text-muted-foreground">{t('loading')}</p>;
  const known = policy.brokerage;
  const mismatch = known && known.knownStatus !== policy.status;
  return (
    <div className="space-y-4">
      <Link href="/insurer" className="text-sm text-muted-foreground hover:underline">
        ← {t('insurer.back')}
      </Link>
      <AgentSaw current={policy as unknown as Record<string, unknown>} />
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-lg font-semibold">{policy.number}</span>
            <PolicyStatus status={policy.status} />
            <span className="text-sm">{policy.product}</span>
            <span className="text-sm text-muted-foreground">{policy.insurer.name}</span>
            <LanguageBadge language={policy.insurer.locale} />
          </div>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <Row label={t('policy.holder')}>
              {policy.holderName} — SIREN {policy.holderSiren}
            </Row>
            <Row label={t('policy.start')}>{dates.date(policy.startDate)}</Row>
            <Row label={t('policy.renewal')}>{dates.date(policy.renewalDate)}</Row>
            <Row label={t('policy.end')}>
              {policy.endDate
                ? `${dates.date(policy.endDate)} (${t(`endReason.${policy.endReason ?? 'unknown'}`)})`
                : '—'}
            </Row>
            {policy.cancellationRequestedAt && (
              <Row label={t('policy.cancellationRequested')}>
                {dates.date(policy.cancellationRequestedAt)}
              </Row>
            )}
          </dl>
          {known && (
            <div
              className={cn(
                'rounded-lg border p-2 text-sm',
                mismatch ? 'border-red-300 bg-red-50 text-red-900' : 'bg-muted/40',
              )}
            >
              {t(mismatch ? 'policy.mismatch' : 'policy.match', {
                known: t(`policyStatusShort.${known.knownStatus}`),
                actual: t(`policyStatusShort.${policy.status}`),
              })}{' '}
              <Link href={`/clients/${known.client.id}`} className="underline">
                {known.client.companyName}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
      <Card id="coverages">
        <CardHeader>
          <CardTitle>{t('policy.coverages')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('policy.coverage')}</TableHead>
                <TableHead className="text-right">{t('policy.limit')}</TableHead>
                <TableHead className="text-right">{t('policy.deductible')}</TableHead>
                <TableHead>{t('policy.exclusions')}</TableHead>
                <TableHead>{t('policy.clause')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policy.coverages.map((coverage) => (
                <TableRow key={coverage.clauseRef}>
                  <TableCell>
                    {coverage.label}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({tPeril(coverage.peril)})
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{dates.money(coverage.limit)}</TableCell>
                  <TableCell className="text-right">{dates.money(coverage.deductible)}</TableCell>
                  <TableCell className="text-xs">
                    {coverage.exclusions.join(' ; ') || '—'}
                  </TableCell>
                  <TableCell>
                    <ClauseLink clauseRef={coverage.clauseRef} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('policy.conditions')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          {policy.generalClauses.map((clause) => (
            <span key={clause.ref} className="rounded border px-2 py-1">
              <ClauseLink clauseRef={clause.ref} /> {clause.title}
            </span>
          ))}
        </CardContent>
      </Card>
      <Card id="claims">
        <CardHeader>
          <CardTitle>{t('policy.claims')}</CardTitle>
        </CardHeader>
        <CardContent>
          {policy.claims.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('policy.noClaim')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('policy.claimNumber')}</TableHead>
                  <TableHead>{t('policy.date')}</TableHead>
                  <TableHead>{t('policy.nature')}</TableHead>
                  <TableHead className="text-right">{t('policy.amount')}</TableHead>
                  <TableHead>{t('policy.status')}</TableHead>
                  <TableHead>{t('policy.filedBy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policy.claims.map((claim) => (
                  <TableRow key={claim.number}>
                    <TableCell className="font-mono text-xs">{claim.number}</TableCell>
                    <TableCell className="text-xs">{dates.date(claim.date)}</TableCell>
                    <TableCell className="text-xs">{tPeril(claim.nature)}</TableCell>
                    <TableCell className="text-right">{dates.money(claim.amount)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`claimStatus.${claim.status}`)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {claim.filedBy ? t('policy.filedByBrokerage', { code: claim.filedBy }) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ClauseLink({ clauseRef }: { clauseRef: string }) {
  return (
    <Link
      href={`/insurer/clauses/${encodeURIComponent(clauseRef)}#${encodeURIComponent(clauseRef)}`}
      className="font-mono text-xs text-blue-700 hover:underline"
    >
      {clauseRef}
    </Link>
  );
}

// --- Extranet: general conditions ---

/** The clause text, with the excerpt the agent cited highlighted. */
function Highlighted({ text, excerpt }: { text: string; excerpt: string | null }) {
  const at = excerpt ? text.indexOf(excerpt) : -1;
  if (!excerpt || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-yellow-200 px-0.5">{excerpt}</mark>
      {text.slice(at + excerpt.length)}
    </>
  );
}

export function ConditionsPage({ clauseRef }: { clauseRef: string }) {
  const t = useTranslations('portal');
  const params = useSearchParams();
  const highlight = params.get('highlight');
  const { data, error } = useData<InsurerClauses>(() => coreApi.conditions(clauseRef), [clauseRef]);
  useEffect(() => {
    if (data) document.getElementById(clauseRef)?.scrollIntoView({ block: 'center' });
  }, [data, clauseRef]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-muted-foreground">{t('loading')}</p>;
  const current = data.clauses.find((clause) => clause.ref === clauseRef);
  return (
    <div className="space-y-4">
      <Link href="/insurer" className="text-sm text-muted-foreground hover:underline">
        ← {t('insurer.back')}
      </Link>
      <PageTitle
        title={t('conditions.title', { insurer: data.insurer.name })}
        subtitle={t('conditions.subtitle')}
      />
      <AgentSaw
        current={current ? { ref: current.ref, title: current.title, text: current.text } : null}
      />
      <Card>
        <CardContent className="space-y-4">
          {data.clauses.map((clause) => (
            <section
              key={clause.ref}
              id={clause.ref}
              className={cn(
                'scroll-mt-24 rounded-lg p-3',
                clause.ref === clauseRef && 'border border-blue-300 bg-blue-50/50',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold">{clause.ref}</span>
                <span className="font-medium">{clause.title}</span>
                <LanguageBadge language={data.insurer.locale} />
                {clause.general && (
                  <Badge variant="outline" className="text-[10px]">
                    {t('conditions.general')}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm">
                <Highlighted
                  text={clause.text}
                  excerpt={clause.ref === clauseRef ? highlight : null}
                />
              </p>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// --- Clients ---

export function ClientsView() {
  const t = useTranslations('portal');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, error } = useData(() => coreApi.clients(debounced), [debounced]);
  return (
    <div className="space-y-4">
      <PageTitle title={t('clients.title')} subtitle={t('clients.subtitle')} />
      <Search value={query} onChange={setQuery} placeholder={t('clients.search')} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('clients.company')}</TableHead>
                <TableHead>SIREN</TableHead>
                <TableHead>{t('clients.contact')}</TableHead>
                <TableHead>{t('clients.email')}</TableHead>
                <TableHead className="text-right">{t('clients.policies')}</TableHead>
                <TableHead className="text-right">{t('clients.cases')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((client: ClientSummary) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <Link href={`/clients/${client.id}`} className="text-blue-700 hover:underline">
                      {client.companyName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{client.siren}</TableCell>
                  <TableCell className="text-xs">{client.contactName}</TableCell>
                  <TableCell className="text-xs">{client.email}</TableCell>
                  <TableCell className="text-right">{client.policies}</TableCell>
                  <TableCell className="text-right">{client.cases}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function ClientPage({ id }: { id: string }) {
  const t = useTranslations('portal');
  const tRequest = useTranslations('requestType');
  const tAction = useTranslations('actionType');
  const format = useFormatter();
  const dates = useDates();
  const { data: client, error } = useData<ClientDetail>(() => coreApi.client(id), [id]);
  const current = useMemo(
    () =>
      client
        ? {
            companyName: client.companyName,
            siren: client.siren,
            contactName: client.contactName,
            email: client.email,
          }
        : null,
    [client],
  );
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!client) return <p className="text-muted-foreground">{t('loading')}</p>;
  return (
    <div className="space-y-4">
      <Link href="/clients" className="text-sm text-muted-foreground hover:underline">
        ← {t('clients.back')}
      </Link>
      <AgentSaw current={current} />
      <Card>
        <CardContent className="space-y-1 text-sm">
          <div className="text-lg font-semibold">{client.companyName}</div>
          <div className="text-muted-foreground">
            SIREN {client.siren} · {client.contactName} · {client.email}
          </div>
        </CardContent>
      </Card>
      <Card id="policies">
        <CardHeader>
          <CardTitle>{t('clients.policiesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('policy.number')}</TableHead>
                <TableHead>{t('policy.insurer')}</TableHead>
                <TableHead>{t('policy.product')}</TableHead>
                <TableHead>{t('clients.knownStatus')}</TableHead>
                <TableHead>{t('policy.renewal')}</TableHead>
                <TableHead>{t('clients.cancellation')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {client.policies.map((policy) => (
                <TableRow key={policy.number}>
                  <TableCell>
                    <Link
                      href={`/insurer/policies/${policy.number}`}
                      className="font-mono text-xs text-blue-700 hover:underline"
                    >
                      {policy.number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{policy.insurerName}</TableCell>
                  <TableCell className="text-xs">{policy.product}</TableCell>
                  <TableCell>
                    <PolicyStatus status={policy.knownStatus} />
                  </TableCell>
                  <TableCell className="text-xs">{dates.date(policy.renewalDate)}</TableCell>
                  <TableCell className="text-xs">
                    {dates.date(policy.cancellationEffectiveDate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">{t('clients.knownStatusHint')}</p>
        </CardContent>
      </Card>
      <Card id="cases">
        <CardHeader>
          <CardTitle>{t('clients.casesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {client.cases.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('clients.noCase')}</p>
          ) : (
            <Table>
              <TableBody>
                {client.cases.map((kase) => (
                  <TableRow key={kase.id}>
                    <TableCell>
                      <Link
                        href={`/cases/${kase.id}`}
                        className="font-mono text-xs text-blue-700 hover:underline"
                      >
                        {kase.reference}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      {format.dateTime(new Date(kase.receivedAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </TableCell>
                    <TableCell className="text-xs">{kase.subject}</TableCell>
                    <TableCell className="text-xs">
                      {kase.requestType ? tRequest(kase.requestType) : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={kase.status as CaseDetail['status']} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {kase.lastAction ? tAction(kase.lastAction) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
