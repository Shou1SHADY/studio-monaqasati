import { getTranslations } from 'next-intl/server';
import { buildPageMetadata } from '@/lib/seo';
import type { Metadata } from 'next';
import ContactUs from './content';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Contact' });
  return buildPageMetadata({
    locale,
    title: t('title'),
    description: t('subtitle'),
    path: '/contact',
  });
}

export default function Page() {
  return <ContactUs />;
}
