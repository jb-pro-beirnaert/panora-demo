import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { InsurerPolicyPage } from '@/components/portal';

export default async function PolicyPage({
  params,
}: PageProps<'/[locale]/insurer/policies/[number]'>) {
  const { locale, number } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <InsurerPolicyPage number={decodeURIComponent(number)} />
    </Suspense>
  );
}
