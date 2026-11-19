import { setRequestLocale } from 'next-intl/server';
import { Inbox } from '@/components/inbox';

export default async function InboxPage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Inbox />;
}
