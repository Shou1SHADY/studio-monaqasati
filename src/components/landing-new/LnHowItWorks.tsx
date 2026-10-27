"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Award, BadgeCheck, FileUp, Inbox, Scale, Send, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';

type Side = 'contractor' | 'supplier';

export function LnHowItWorks() {
  const t = useTranslations('LandingNew.how');
  const reduce = useReducedMotion();
  const [side, setSide] = useState<Side>('contractor');

  const steps: Record<Side, { icon: LucideIcon; title: string; desc: string }[]> = {
    contractor: [
      { icon: FileUp, title: t('c1_title'), desc: t('c1_desc') },
      { icon: Inbox, title: t('c2_title'), desc: t('c2_desc') },
      { icon: Scale, title: t('c3_title'), desc: t('c3_desc') },
    ],
    supplier: [
      { icon: BadgeCheck, title: t('s1_title'), desc: t('s1_desc') },
      { icon: Send, title: t('s2_title'), desc: t('s2_desc') },
      { icon: Award, title: t('s3_title'), desc: t('s3_desc') },
    ],
  };

  return (
    <section id="how" className="relative py-20 md:py-28 scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <SectionHeader label={t('label')} title={t('title')} sub={t('sub')} />

        <div role="tablist" aria-label={t('label')} className="mx-auto mb-10 flex w-fit rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
          {(['contractor', 'supplier'] as const).map(s => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={side === s}
              onClick={() => setSide(s)}
              className={cn(
                'h-11 px-6 rounded-xl text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                side === s ? 'bg-cta text-white shadow-lg shadow-cta/25' : 'text-slate-400 hover:text-white',
              )}
            >
              {t(s === 'contractor' ? 'tab_contractor' : 'tab_supplier')}
            </button>
          ))}
        </div>

        <div className="relative">
          <div className="hidden md:block absolute top-12 inset-x-[16%] border-t-2 border-dashed border-white/10" aria-hidden="true" />
          <AnimatePresence mode="wait">
            <motion.ol
              key={side}
              role="tabpanel"
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="relative grid md:grid-cols-3 gap-5 md:gap-8"
            >
              {steps[side].map((s, i) => (
                <li key={s.title} className="text-center">
                  <div className="relative mx-auto mb-6 w-24 h-24 rounded-3xl border border-accent/25 bg-slate-950 flex items-center justify-center shadow-xl shadow-accent/5">
                    <s.icon size={34} className="text-accent" aria-hidden="true" />
                    <span className="absolute -top-3 -end-3 w-9 h-9 rounded-xl bg-cta text-white text-sm font-black flex items-center justify-center tracking-latin">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{s.title}</h3>
                  <p className="text-slate-400 leading-[1.85] max-w-sm mx-auto">{s.desc}</p>
                </li>
              ))}
            </motion.ol>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
