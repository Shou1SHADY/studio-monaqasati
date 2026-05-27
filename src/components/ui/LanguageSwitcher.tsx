'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/routing';
import { Button } from './button';

import { useSearchParams } from 'next/navigation';

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const toggleLanguage = () => {
    const nextLocale = locale === 'ar' ? 'en' : 'ar';
    const query = searchParams.toString();
    const newPath = query ? `${pathname}?${query}` : pathname;
    router.replace(newPath as any, { locale: nextLocale });
  };

  return (
    <Button variant="ghost" size="sm" onClick={toggleLanguage} className={`font-semibold px-3 py-2 ${className || ''}`}>
      {locale === 'ar' ? 'English' : 'العربية'}
    </Button>
  );
}
