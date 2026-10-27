"use client";

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, ExternalLink, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IS_UAT } from '@/lib/app-env';
import { cn } from '@/lib/utils';
import { PhoneFrame } from './PhoneFrame';
import { ln } from './tone';

/** The mobile app's web build (the PWA) — there is no store listing yet. */
const APP_URL = IS_UAT ? 'https://mdmak-mobile-uat.web.app' : 'https://mdmak-mobile.web.app';

type Side = 'contractor' | 'supplier';

export function LnApp() {
  const t = useTranslations('LandingNew.app');
  const isAr = useLocale() === 'ar';
  const reduce = useReducedMotion();
  const [side, setSide] = useState<Side>('contractor');

  const points = side === 'contractor' ? [t('c_1'), t('c_2'), t('c_3')] : [t('s_1'), t('s_2'), t('s_3')];
  const shot = side === 'contractor'
    ? { src: '/images/contractor-mobile.png', alt: t('alt_contractor') }
    : { src: '/images/supplier-mobile-clean.png', alt: t('alt_supplier') };

  return (
    <section id="app" className={cn('relative py-20 md:py-28 scroll-mt-20 overflow-hidden', ln.page)}>
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 items-center">
        <div className="order-2 lg:order-1 relative mx-auto w-full max-w-[270px]">
          <div className="absolute -inset-10 rounded-full bg-gradient-to-br from-cta/15 to-accent/20 blur-[80px] pointer-events-none" aria-hidden="true" />
          <AnimatePresence mode="wait">
            <motion.div
              key={side}
              initial={reduce ? false : { opacity: 0, x: isAr ? -24 : 24, rotate: -2 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: isAr ? 24 : -24 }}
              transition={{ duration: 0.35 }}
              className="relative"
            >
              <PhoneFrame src={shot.src} alt={shot.alt} />
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="order-1 lg:order-2">
          <span className={cn('inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs md:text-sm font-bold mb-4', ln.pill)}>
            <Smartphone size={14} aria-hidden="true" /> {t('label')}
          </span>
          <h2 className={cn('font-extrabold text-[clamp(26px,4vw,46px)]', ln.heading, isAr ? 'leading-[1.6]' : 'leading-[1.2] tracking-tight')}>{t('title')}</h2>
          <p className={cn('mt-4 text-base md:text-lg leading-relaxed', ln.body)}>{t('sub')}</p>

          <div role="tablist" aria-label={t('label')} className={cn('mt-8 flex w-fit rounded-xl p-1', ln.segment)}>
            {(['contractor', 'supplier'] as const).map(s => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={side === s}
                onClick={() => setSide(s)}
                className={cn('h-10 px-5 rounded-lg text-sm font-bold transition-colors', ln.focus, side === s ? ln.segmentOn : ln.segmentOff)}
              >
                {t(s === 'contractor' ? 'tab_contractor' : 'tab_supplier')}
              </button>
            ))}
          </div>

          <ul role="tabpanel" className="mt-6 space-y-3">
            {points.map(p => (
              <li key={p} className={cn('flex items-center gap-3 font-semibold', ln.strong)}>
                <CheckCircle2 size={18} className="text-success shrink-0" aria-hidden="true" /> {p}
              </li>
            ))}
          </ul>

          <Button asChild className="mt-8 h-12 px-7 rounded-xl font-black gap-2 shadow-lg shadow-cta/20">
            <a href={APP_URL} target="_blank" rel="noopener noreferrer">{t('open')} <ExternalLink size={15} aria-hidden="true" /></a>
          </Button>
          <p className={cn('mt-3 text-xs', ln.faint)}>{t('install_hint')}</p>
        </div>
      </div>
    </section>
  );
}
