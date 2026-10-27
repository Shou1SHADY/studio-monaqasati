import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { IS_UAT } from '@/lib/app-env';
import { landingNewAllowed } from '@/lib/landing-new';
import { LandingNewPage } from '@/components/landing-new/LandingNewPage';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'LandingNew.meta' });
  return { title: t('title'), description: t('description'), robots: { index: false, follow: false } };
}

export default function Page() {
  if (!landingNewAllowed(IS_UAT, process.env.NODE_ENV)) notFound();
  return <LandingNewPage />;
}
