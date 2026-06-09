import type { Metadata } from 'next';
import { alternatesForPath } from '@/lib/seo';
import HomeContent from './content';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const titleAr = 'مدماك تيك — منصة المناقصات الذكية لربط المقاولين بالموردين في السعودية';
  const titleEn = 'Mdmak Tech — Smart B2B Procurement & RFQ Platform for Saudi Construction';
  const descAr = 'اربط مقاوليك بأفضل موردي مواد البناء في السعودية. منصة ذكية لطرح المناقصات، استقبال عروض الأسعار، ومقارنة العروض لتوفير الوقت وخفض التكاليف. سجّل مجاناً.';
  const descEn = "Saudi Arabia's leading B2B procurement platform connecting contractors with trusted suppliers for steel, cement, electrical, HVAC, paints, sanitary ware, insulation, flooring, and doors. Streamline RFQ, compare quotes, and manage construction sourcing intelligently.";

  const title = locale === 'ar' ? titleAr : titleEn;
  const description = locale === 'ar' ? descAr : descEn;
  const siteName = locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech';

  return {
    title,
    description,
    manifest: '/site.webmanifest',
    icons: {
      icon: [
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon.ico', sizes: '48x48' },
      ],
      shortcut: '/favicon.ico',
      apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    },
    keywords: locale === 'ar'
      ? ['مدماك تيك', 'مقاولين', 'موردين', 'مشتريات', 'حديد', 'أسمنت', 'كهرباء', 'دهانات', 'أدوات صحية', 'عروض أسعار', 'منصة B2B', 'السعودية', 'بناء', 'توريد', 'تكييف', 'عزل', 'أرضيات', 'أبواب']
      : ['Mdmak Tech', 'contractors', 'suppliers', 'procurement', 'steel', 'cement', 'electrical', 'paints', 'sanitary ware', 'RFQ', 'B2B platform', 'Saudi Arabia', 'construction', 'supply', 'HVAC', 'insulation', 'flooring', 'doors'],
    alternates: alternatesForPath('/', locale),
    openGraph: {
      type: 'website',
      locale: locale === 'ar' ? 'ar_SA' : 'en_US',
      siteName,
      title,
      description,
      url: locale === 'ar' ? 'https://mdmaktech.sa' : `https://mdmaktech.sa/${locale}`,
      images: [
        {
          url: '/og-image.jpg',
          width: 1200,
          height: 630,
          alt: siteName,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og-image.jpg'],
    },
  };
}

export default function Page() {
  return <HomeContent />;
}
