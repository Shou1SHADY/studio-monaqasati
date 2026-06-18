import type { Metadata } from 'next';
import { Inter, Noto_Sans_Arabic } from 'next/font/google';
import '../globals.css';
import { Toaster } from '@/components/ui/toaster';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import StructuredData from '@/components/StructuredData';

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-body',
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const notoNaskhArabic = { variable: '--font-headline' };

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const titleAr = 'مدماك تيك — منصة المناقصات الذكية لربط المقاولين بالموردين في السعودية';
  const titleEn = 'Mdmak Tech — Smart B2B Procurement & RFQ Platform for Saudi Construction';
  const descAr = 'اربط مقاوليك بأفضل موردي مواد البناء في السعودية. منصة ذكية لطرح المناقصات، استقبال عروض الأسعار، ومقارنة العروض لتوفير الوقت وخفض التكاليف. سجّل مجاناً.';
  const descEn = "Saudi Arabia's leading B2B procurement platform connecting contractors with trusted suppliers for steel, cement, electrical, HVAC, paints, sanitary ware, insulation, flooring, and doors. Streamline RFQ, compare quotes, and manage construction sourcing intelligently.";

  return {
    metadataBase: new URL('https://mdmaktech.sa'),
    title: locale === 'ar' ? titleAr : titleEn,
    description: locale === 'ar' ? descAr : descEn,
    keywords: locale === 'ar'
      ? ['مدماك تيك', 'مقاولين', 'موردين', 'مشتريات', 'حديد', 'أسمنت', 'كهرباء', 'دهانات', 'أدوات صحية', 'عروض أسعار', 'منصة B2B', 'السعودية', 'بناء', 'توريد', 'تكييف', 'عزل', 'أرضيات', 'أبواب']
      : ['Mdmak Tech', 'contractors', 'suppliers', 'procurement', 'steel', 'cement', 'electrical', 'paints', 'sanitary ware', 'RFQ', 'B2B platform', 'Saudi Arabia', 'construction', 'supply', 'HVAC', 'insulation', 'flooring', 'doors'],
    authors: [{ name: 'Mdmak Tech' }],
    creator: 'Mdmak Tech',
    publisher: 'Mdmak Tech',
    robots: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
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
    openGraph: {
      type: 'website',
      locale: locale === 'ar' ? 'ar_SA' : 'en_US',
      siteName: locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech',
      title: locale === 'ar' ? titleAr : titleEn,
      description: locale === 'ar' ? descAr : descEn,
      url: locale === 'ar' ? 'https://mdmaktech.sa' : `https://mdmaktech.sa/${locale}`,
      images: [
        {
          url: '/og-image.jpg',
          width: 1200,
          height: 630,
          alt: locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: locale === 'ar' ? titleAr : titleEn,
      description: locale === 'ar' ? descAr : descEn,
      images: ['/og-image.jpg'],
    },
  };
}

export default async function RootLayout({
  children,
  params
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <body
        className={`${locale === 'ar' ? notoSansArabic.variable : inter.variable} ${notoNaskhArabic.variable} font-body antialiased text-foreground overflow-x-hidden`}
        suppressHydrationWarning
      >
        <NextIntlClientProvider messages={messages}>
          <StructuredData />
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
