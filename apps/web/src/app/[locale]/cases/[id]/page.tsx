import { setRequestLocale } from 'next-intl/server';
import { CaseView } from '@/components/case-view';

export default async function CasePage({ params }: PageProps<'/[locale]/cases/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <CaseView caseId={id} />;
}
