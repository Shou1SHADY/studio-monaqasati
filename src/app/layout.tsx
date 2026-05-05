 
import type {Metadata} from 'next';
import { Noto_Sans_Arabic, Noto_Naskh_Arabic } from 'next/font/google';
import './globals.css';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { Toaster } from '@/components/ui/toaster';

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-body',
});

const notoNaskhArabic = Noto_Naskh_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-headline',
});

export const metadata: Metadata = {
  title: 'مدماك تيك - منصة التقنية للمقاولين والموردين',
  description: 'منصة B2B متكاملة لربط المقاولين بالموردين في قطاع الإنشاءات',
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${notoSansArabic.variable} ${notoNaskhArabic.variable} font-body antialiased bg-background text-foreground overflow-x-hidden`} suppressHydrationWarning>
        <FirebaseClientProvider>
          {children}
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
