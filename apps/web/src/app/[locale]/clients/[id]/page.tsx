import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { ClientPage } from '@/components/portal';

export default async function ClientDetailPage({ params }: PageProps<'/[locale]/clients/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <ClientPage id={decodeURIComponent(id)} />
    </Suspense>
  );
}
