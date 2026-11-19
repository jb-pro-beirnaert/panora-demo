'use client';

import type { AlertType, CaseStatus, Locale, Verdict } from '@demo/shared';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<CaseStatus, string> = {
  received: 'bg-slate-100 text-slate-700',
  processing: 'bg-blue-100 text-blue-800',
  awaiting_approval: 'bg-amber-100 text-amber-900',
  classified: 'bg-slate-100 text-slate-700',
  claim_filed: 'bg-emerald-100 text-emerald-800',
  ready_to_send: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
};

const VERDICT_STYLES: Record<Verdict, string> = {
  covered: 'bg-emerald-100 text-emerald-800',
  not_covered: 'bg-red-100 text-red-800',
  uncertain: 'bg-amber-100 text-amber-900',
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  const t = useTranslations('status');
  return <Badge className={cn('border-0', STATUS_STYLES[status])}>{t(status)}</Badge>;
}

export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  const t = useTranslations('verdict');
  if (!verdict) return <span className="text-muted-foreground">—</span>;
  return <Badge className={cn('border-0', VERDICT_STYLES[verdict])}>{t(verdict)}</Badge>;
}

export function AlertBadges({ alerts }: { alerts: AlertType[] }) {
  const t = useTranslations('alert');
  return (
    <span className="flex flex-wrap gap-1">
      {alerts.map((alert) => (
        <Badge key={alert} variant="destructive">
          {t(alert)}
        </Badge>
      ))}
    </span>
  );
}

/** Language of free text written by an agent (or of the inbound e-mail). */
export function LanguageBadge({ language }: { language: Locale }) {
  return (
    <Badge variant="outline" className="font-mono text-[10px] uppercase">
      {language}
    </Badge>
  );
}
