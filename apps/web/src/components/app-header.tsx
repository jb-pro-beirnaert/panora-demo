'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { routing, type AppLocale } from '@/i18n/routing';
import { useBroker } from '@/lib/broker';

const selectClass =
  'h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

export function AppHeader() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { brokers, broker, select } = useBroker();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/" className="mr-auto">
          <div className="text-lg font-semibold">{t('app.title')}</div>
          <div className="text-xs text-muted-foreground">{t('app.subtitle')}</div>
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="hover:underline">
            {t('header.inbox')}
          </Link>
          <Link href="/evals" className="hover:underline">
            {t('header.evals')}
          </Link>
        </nav>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('header.broker')}</span>
          <select
            className={selectClass}
            value={broker?.id ?? ''}
            onChange={(event) => select(event.target.value)}
          >
            {!broker && <option value="">{t('header.brokerPlaceholder')}</option>}
            {brokers.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} — {candidate.brokerage.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('header.language')}</span>
          <select
            className={selectClass}
            value={locale}
            onChange={(event) =>
              router.replace(pathname, { locale: event.target.value as AppLocale })
            }
          >
            {routing.locales.map((candidate) => (
              <option key={candidate} value={candidate}>
                {t(`locale.${candidate}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
