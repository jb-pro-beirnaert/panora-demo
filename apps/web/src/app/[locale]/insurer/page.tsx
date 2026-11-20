import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { InsurerPoliciesView } from '@/components/portal';

export default async function InsurerPage({ params }: PageProps<'/[locale]/insurer'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <InsurerPoliciesView />
    </Suspense>
  );
}
