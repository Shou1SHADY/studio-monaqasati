"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BarChart3, LayoutDashboard, PackageSearch, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import { BrowserFrame } from './BrowserFrame';
import { GridBackdrop } from './GridBackdrop';
import { ln } from './tone';

type Screen = { id: string; icon: LucideIcon; tab: string; desc: string; src: string; alt: string; url: string };

/** The web app's screens, one at a time in a browser window, picked from the tabs. */
export function LnTour() {
  const t = useTranslations('LandingNew.tour');
  const reduce = useReducedMotion();
  const screens: Screen[] = [
    { id: 'contractor', icon: LayoutDashboard, tab: t('tab_1'), desc: t('desc_1'), src: '/images/contractor-desktop.png', alt: t('alt_1'), url: 'mdmak.sa/contractor' },
    { id: 'compare', icon: BarChart3, tab: t('tab_2'), desc: t('desc_2'), src: '/images/platform-comparison.png', alt: t('alt_2'), url: 'mdmak.sa/contractor/rfqs' },
    { id: 'supplier', icon: PackageSearch, tab: t('tab_3'), desc: t('desc_3'), src: '/images/supplier-desktop-clean.png', alt: t('alt_3'), url: 'mdmak.sa/supplier' },
  ];
  const [active, setActive] = useState(screens[0].id);
  const cur = screens.find(s => s.id === active) ?? screens[0];

  return (
    <section id="tour" className={cn('relative py-20 md:py-28 scroll-mt-20 overflow-hidden', ln.band)}>
      <GridBackdrop />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHeader label={t('label')} title={t('title')} sub={t('sub')} />

        <div role="tablist" aria-label={t('label')} className="grid sm:grid-cols-3 gap-3 mb-8">
          {screens.map(s => {
            const on = s.id === active;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                id={`tour-tab-${s.id}`}
                aria-selected={on}
                aria-controls="tour-panel"
                onClick={() => setActive(s.id)}
                className={cn(
                  'flex items-start gap-3 rounded-2xl border p-4 text-start transition-all',
                  ln.focus,
                  on
                    ? 'border-cta/40 bg-white shadow-lg shadow-cta/10 dark:border-accent/40 dark:bg-white/[0.06] dark:shadow-none'
                    : 'border-transparent hover:bg-white/70 dark:hover:bg-white/[0.03]',
                )}
              >
                <span className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', on ? 'bg-cta text-white dark:bg-accent dark:text-primary' : ln.iconTile)}>
                  <s.icon size={19} aria-hidden="true" />
                </span>
                <span>
                  <span className={cn('block font-bold', ln.heading)}>{s.tab}</span>
                  <span className={cn('block text-sm mt-1 leading-relaxed', ln.body)}>{s.desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${cur.id}`} className="relative">
          <div className="absolute -inset-x-6 -bottom-6 top-10 rounded-[2rem] bg-gradient-to-b from-cta/10 to-accent/10 blur-2xl pointer-events-none" aria-hidden="true" />
          <AnimatePresence mode="wait">
            <motion.div
              key={cur.id}
              initial={reduce ? false : { opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="relative"
            >
              <BrowserFrame src={cur.src} alt={cur.alt} url={cur.url} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
