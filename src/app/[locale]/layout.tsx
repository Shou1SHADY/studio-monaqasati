import type {Metadata} from 'next';
import { Inter, Noto_Sans_Arabic } from 'next/font/google';
import '../globals.css';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { Toaster } from '@/components/ui/toaster';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import StructuredData from '@/components/StructuredData';

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-body',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const notoNaskhArabic = { variable: '--font-headline' };

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
    icons: {
      icon: '/logo.png',
      shortcut: '/logo.png',
      apple: '/logo.png',
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
          url: '/logo.png',
          width: 512,
          height: 512,
          alt: locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: locale === 'ar' ? titleAr : titleEn,
      description: locale === 'ar' ? descAr : descEn,
      images: ['/logo.png'],
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
        className={`${locale === 'ar' ? notoSansArabic.variable : inter.variable} ${notoNaskhArabic.variable} font-body antialiased bg-background text-foreground overflow-x-hidden`} 
        suppressHydrationWarning
      >
        <NextIntlClientProvider messages={messages}>
          <FirebaseClientProvider>
            <StructuredData />
            {children}
            <Toaster />
          </FirebaseClientProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
