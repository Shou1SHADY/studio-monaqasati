"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, X } from 'lucide-react';
import { Link } from '@/i18n/routing';

/** The thin offer strip above the navigation: the free supplier account. */
export function LnTopBar() {
  const t = useTranslations('LandingNew.bar');
  const [open, setOpen] = useState(true);
  if (!open) return null;

  return (
    <div className="relative z-50 bg-gradient-to-r from-cta via-sky-700 to-cta text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-center gap-3 text-xs sm:text-sm">
        <p className="font-semibold text-center line-clamp-2">{t('text')}</p>
        <Link
          href="/supplier-signup"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 px-3 py-1 font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {t('cta')}
          <ArrowLeft size={13} className="ltr:rotate-180" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('close')}
          className="shrink-0 rounded-full p-1.5 hover:bg-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
