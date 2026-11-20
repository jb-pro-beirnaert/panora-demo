import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { ConditionsPage } from '@/components/portal';

export default async function ClausePage({ params }: PageProps<'/[locale]/insurer/clauses/[ref]'>) {
  const { locale, ref } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <ConditionsPage clauseRef={decodeURIComponent(ref)} />
    </Suspense>
  );
}
