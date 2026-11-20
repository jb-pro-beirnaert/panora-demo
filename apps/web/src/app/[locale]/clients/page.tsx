import { setRequestLocale } from 'next-intl/server';
import { ClientsView } from '@/components/portal';

export default async function ClientsPage({ params }: PageProps<'/[locale]/clients'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ClientsView />;
}
