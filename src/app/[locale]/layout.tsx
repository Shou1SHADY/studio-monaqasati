import type {Metadata} from 'next';
import { Inter, Noto_Sans_Arabic } from 'next/font/google';
import '../globals.css';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { Toaster } from '@/components/ui/toaster';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';

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
  return {
    title: locale === 'ar'
      ? 'مدماك تيك - منصة التقنية للمقاولين والموردين'
      : 'Mdmak Tech - Smart Procurement Platform for Contractors & Suppliers',
    description: locale === 'ar'
      ? 'منصة B2B متكاملة لربط المقاولين بالموردين في قطاع الإنشاءات'
      : 'A leading B2B platform connecting contractors with suppliers in the construction sector.',
    icons: {
      icon: '/favicon.png',
      shortcut: '/favicon.png',
      apple: '/favicon.png',
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
            {children}
            <Toaster />
          </FirebaseClientProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
