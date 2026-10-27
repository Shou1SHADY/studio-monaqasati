import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/seo';
import { SupplierSignupContent } from './SupplierSignupContent';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'SupplierSignup' });
  return buildPageMetadata({
    locale,
    title: t('metaTitle'),
    description: t('metaDesc'),
    path: '/supplier-signup',
  });
}

export default function SupplierSignupPage() {
  return <SupplierSignupContent />;
}
