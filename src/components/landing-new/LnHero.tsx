"use client";

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, BadgeCheck, Clock, Layers, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GridBackdrop } from './GridBackdrop';
import { PhoneFrame } from './PhoneFrame';
import { FALLBACK_OFFERS, type LandingPreview } from './preview';
import { ln } from './tone';

function FloatChip({ delay, className, icon, iconCls, value, label, valueDir }: {
  delay: number; className: string; icon: ReactNode; iconCls: string; value: ReactNode; label: string; valueDir?: 'ltr';
}) {
  const reduce = useReducedMotion();
  const motionProps = reduce ? {} : {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: [0, -6, 0] },
    transition: { opacity: { delay, duration: 0.4 }, y: { delay: delay + 0.4, duration: 5, repeat: Infinity, ease: 'easeInOut' as const } },
  };
  return (
    <motion.div {...motionProps} className={cn('absolute z-10 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5', ln.chip, className)}>
      <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center', iconCls)}>{icon}</span>
      <span className="leading-tight">
        <span className={cn('block text-lg font-black tracking-latin', ln.heading)} dir={valueDir}>{value}</span>
        <span className={cn('block text-[11px] font-semibold', ln.body)}>{label}</span>
      </span>
    </motion.div>
  );
}

export function LnHero({ data, onStart }: { data: LandingPreview | null; onStart: () => void }) {
  const t = useTranslations('LandingNew.hero');
  const tStats = useTranslations('Landing.Stats');
  const isAr = useLocale() === 'ar';

  const offers = data?.rfq?.offersCount || FALLBACK_OFFERS;
  const avatars = (data?.suppliers ?? []).slice(0, 4);

  return (
    <section id="home" className="relative overflow-hidden scroll-mt-24 bg-gradient-to-b from-sky-50 via-white to-white dark:from-slate-950 dark:via-slate-950 dark:to-slate-950">
      <GridBackdrop />
      <div className="absolute -top-40 start-1/3 w-[620px] h-[620px] rounded-full bg-accent/20 blur-[150px] pointer-events-none dark:bg-accent/10" aria-hidden="true" />
      <div className="absolute top-1/3 -end-40 w-[420px] h-[420px] rounded-full bg-cta/10 blur-[130px] pointer-events-none dark:bg-cta/15" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-20 md:pt-14 md:pb-28 grid lg:grid-cols-[1.1fr_0.9fr] gap-14 lg:gap-8 items-center">
        {/* Text */}
        <div className="hero-text-in text-center lg:text-start">
          <span className={cn('inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs md:text-sm font-bold mb-6', ln.pill)}>
            <span className="w-1.5 h-1.5 rounded-full bg-cta dark:bg-accent animate-pulse" aria-hidden="true" />
            {t('badge')}
          </span>
          <h1 className={cn('font-black text-[clamp(34px,5.4vw,66px)]', ln.heading, isAr ? 'leading-[1.6]' : 'leading-[1.12] tracking-tight')}>
            <span className="block">{t('title_1')}</span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-cta to-cyan-600 dark:from-sky-400 dark:to-accent">{t('title_2')}</span>
          </h1>
          <p className={cn('mt-5 text-base md:text-lg leading-[1.85] max-w-xl mx-auto lg:mx-0', ln.body)}>{t('sub')}</p>

          <div className="mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-center lg:justify-start gap-3">
            <Button onClick={onStart} className="h-12 px-7 rounded-xl font-black gap-2 shadow-xl shadow-cta/25 transition-transform hover:scale-[1.02]">
              {t('cta_contractor')} <ArrowLeft size={16} className="ltr:rotate-180" />
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto h-12 px-6 rounded-xl font-bold border-slate-300 bg-white text-primary hover:bg-slate-50 hover:text-primary dark:border-accent/40 dark:bg-transparent dark:text-accent dark:hover:bg-accent/10 dark:hover:text-accent">
              <Link href="/supplier-signup">{t('cta_supplier')}</Link>
            </Button>
            <a href="#contact" className={cn('text-sm font-bold underline-offset-4 hover:underline px-2 py-3 rounded', ln.link, ln.focus)}>
              {t('cta_demo')}
            </a>
          </div>

          <div className="mt-9 flex items-center justify-center lg:justify-start gap-3">
            {avatars.length > 0 ? (
              <div className="flex -space-x-2 rtl:space-x-reverse" aria-hidden="true">
                {avatars.map(s => (
                  // The avatar colour comes from the API (one gradient per supplier).
                  <span key={s.id} className="w-9 h-9 rounded-full border-2 border-white dark:border-slate-950 flex items-center justify-center text-white text-xs font-black" style={{ background: s.bg }}>
                    {s.initial}
                  </span>
                ))}
              </div>
            ) : (
              <ShieldCheck size={20} className="text-success" aria-hidden="true" />
            )}
            <p className={cn('text-sm font-semibold', ln.body)}>{t('trusted')}</p>
          </div>
        </div>

        {/* Visual */}
        <div className="relative mx-auto w-full max-w-[280px] sm:max-w-[310px]">
          <div className="absolute inset-6 rounded-[3rem] border-2 border-dashed border-cta/20 rotate-6 pointer-events-none dark:border-accent/20" aria-hidden="true" />
          <div className="absolute inset-0 rounded-full bg-cta/15 blur-[90px] pointer-events-none dark:bg-cta/25" aria-hidden="true" />
          <div className="hero-card-in relative">
            <PhoneFrame src="/images/contractor-mobile.png" alt={t('screenshot_alt')} priority />
          </div>

          <FloatChip delay={0.5} className="top-[12%] -start-8 sm:-start-20" iconCls="bg-success/15 text-success"
            icon={<BadgeCheck size={18} />} value={offers} label={t('chip_offers')} />
          <FloatChip delay={0.8} className="top-[46%] -end-6 sm:-end-16" iconCls="bg-cta/10 text-cta dark:bg-accent/15 dark:text-accent"
            icon={<Clock size={18} />} value={tStats('response_val')} valueDir="ltr" label={t('chip_response')} />
          <FloatChip delay={1.1} className="bottom-[10%] -start-6 sm:-start-14" iconCls="bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300"
            icon={<Layers size={18} />} value="20" label={t('chip_categories')} />
        </div>
      </div>
    </section>
  );
}
