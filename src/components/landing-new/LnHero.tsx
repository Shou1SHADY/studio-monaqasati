"use client";

import { useLocale, useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, BadgeCheck, Clock, Layers, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PhoneFrame } from './PhoneFrame';
import { FALLBACK_OFFERS, type LandingPreview } from './preview';

export function LnHero({ data, onStart }: { data: LandingPreview | null; onStart: () => void }) {
  const t = useTranslations('LandingNew.hero');
  const tStats = useTranslations('Landing.Stats');
  const isAr = useLocale() === 'ar';
  const reduce = useReducedMotion();

  const offers = data?.rfq?.offersCount || FALLBACK_OFFERS;
  const avatars = (data?.suppliers ?? []).slice(0, 4);

  const chip = (delay: number) => (reduce ? {} : {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: [0, -6, 0] },
    transition: { opacity: { delay, duration: 0.4 }, y: { delay: delay + 0.4, duration: 5, repeat: Infinity, ease: 'easeInOut' as const } },
  });

  return (
    <section id="home" className="relative overflow-hidden scroll-mt-24">
      <div className="absolute inset-0 ln-grid-bg opacity-60 pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-32 start-1/2 w-[640px] h-[640px] rounded-full bg-accent/10 blur-[140px] pointer-events-none" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-16 md:pt-16 md:pb-24 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-8 items-center">
        {/* Text */}
        <div className="hero-text-in text-center lg:text-start">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-4 py-1.5 text-xs md:text-sm font-bold text-accent mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" aria-hidden="true" />
            {t('badge')}
          </span>
          <h1 className={cn('font-black text-white text-[clamp(34px,5.4vw,68px)]', isAr ? 'leading-[1.6]' : 'leading-[1.12] tracking-tight')}>
            <span className="block">{t('title_1')}</span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-accent">{t('title_2')}</span>
          </h1>
          <p className="mt-5 text-slate-300/90 text-base md:text-lg leading-[1.85] max-w-xl mx-auto lg:mx-0">{t('sub')}</p>

          <div className="mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-center lg:justify-start gap-3">
            <Button onClick={onStart} className="h-12 px-7 rounded-xl font-black gap-2 shadow-xl shadow-cta/25">
              {t('cta_contractor')} <ArrowLeft size={16} className="ltr:rotate-180" />
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto h-12 px-6 rounded-xl font-bold border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"><Link href="/supplier-signup">{t('cta_supplier')}</Link></Button>
            <a href="#contact" className="text-sm font-bold text-slate-300 hover:text-white underline-offset-4 hover:underline px-2 py-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {t('cta_demo')}
            </a>
          </div>

          <div className="mt-8 flex items-center justify-center lg:justify-start gap-3">
            {avatars.length > 0 ? (
              <div className="flex -space-x-2 rtl:space-x-reverse" aria-hidden="true">
                {avatars.map(s => (
                  // The avatar colour comes from the API (one gradient per supplier).
                  <span key={s.id} className="w-9 h-9 rounded-full border-2 border-slate-950 flex items-center justify-center text-white text-xs font-black" style={{ background: s.bg }}>
                    {s.initial}
                  </span>
                ))}
              </div>
            ) : (
              <ShieldCheck size={20} className="text-accent" aria-hidden="true" />
            )}
            <p className="text-sm font-semibold text-slate-400">{t('trusted')}</p>
          </div>
        </div>

        {/* Visual */}
        <div className="relative mx-auto w-full max-w-[300px] sm:max-w-[320px]">
          <div className="absolute inset-6 rounded-[3rem] border border-accent/20 rotate-6 pointer-events-none" aria-hidden="true" />
          <div className="absolute inset-0 -z-0 rounded-full bg-cta/20 blur-[90px] pointer-events-none" aria-hidden="true" />
          <div className="hero-card-in relative">
            <PhoneFrame src="/images/contractor-mobile.png" alt={t('screenshot_alt')} priority />
          </div>

          <motion.div {...chip(0.5)} className="absolute top-[12%] -start-6 sm:-start-16 z-10 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-primary/90 backdrop-blur-md px-3.5 py-2.5 shadow-xl">
            <span className="w-9 h-9 rounded-xl bg-success/15 text-success flex items-center justify-center"><BadgeCheck size={18} /></span>
            <span className="leading-tight">
              <span className="block text-lg font-black text-white tracking-latin">{offers}</span>
              <span className="block text-[11px] font-semibold text-slate-400">{t('chip_offers')}</span>
            </span>
          </motion.div>

          <motion.div {...chip(0.8)} className="absolute top-[46%] -end-6 sm:-end-14 z-10 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-primary/90 backdrop-blur-md px-3.5 py-2.5 shadow-xl">
            <span className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center"><Clock size={18} /></span>
            <span className="leading-tight">
              <span className="block text-lg font-black text-white tracking-latin" dir="ltr">{tStats('response_val')}</span>
              <span className="block text-[11px] font-semibold text-slate-400">{t('chip_response')}</span>
            </span>
          </motion.div>

          <motion.div {...chip(1.1)} className="absolute bottom-[10%] -start-4 sm:-start-12 z-10 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-primary/90 backdrop-blur-md px-3.5 py-2.5 shadow-xl">
            <span className="w-9 h-9 rounded-xl bg-sky-400/15 text-sky-300 flex items-center justify-center"><Layers size={18} /></span>
            <span className="leading-tight">
              <span className="block text-lg font-black text-white tracking-latin">20</span>
              <span className="block text-[11px] font-semibold text-slate-400">{t('chip_categories')}</span>
            </span>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
