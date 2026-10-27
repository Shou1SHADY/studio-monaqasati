"use client";

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openLandingAssistant } from '@/lib/landing-assistant';
import { cn } from '@/lib/utils';
import { GridBackdrop } from './GridBackdrop';
import { ln } from './tone';

/** The assistant section: a short scripted exchange, and a button that opens the real assistant. */
export function LnAssistant() {
  const t = useTranslations('LandingNew.assistant');
  const isAr = useLocale() === 'ar';
  const reduce = useReducedMotion();
  const chatRef = useRef<HTMLDivElement>(null);
  const inView = useInView(chatRef, { once: true, margin: '-120px' });
  const [stage, setStage] = useState<0 | 1 | 2>(0); // 0 nothing · 1 question + typing · 2 answer

  useEffect(() => {
    if (!inView) return;
    if (reduce) { setStage(2); return; }
    setStage(1);
    const id = setTimeout(() => setStage(2), 1600);
    return () => clearTimeout(id);
  }, [inView, reduce]);

  const features = [t('f1'), t('f2'), t('f3'), t('f4')];

  return (
    <section id="assistant" className={cn('relative py-20 md:py-28 scroll-mt-20 overflow-hidden', ln.band)}>
      <GridBackdrop />
      <div className="absolute top-1/2 -translate-y-1/2 start-[-10%] w-[480px] h-[480px] rounded-full bg-accent/15 blur-[140px] pointer-events-none dark:bg-accent/10" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className={cn('inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs md:text-sm font-bold mb-4', ln.pill)}>
            <Sparkles size={14} aria-hidden="true" /> {t('label')}
          </span>
          <h2 className={cn('font-extrabold text-[clamp(26px,4vw,46px)]', ln.heading, isAr ? 'leading-[1.6]' : 'leading-[1.2] tracking-tight')}>{t('title')}</h2>
          <p className={cn('mt-4 text-base md:text-lg leading-relaxed', ln.body)}>{t('sub')}</p>
          <ul className="mt-8 grid sm:grid-cols-2 gap-3">
            {features.map(f => (
              <li key={f} className={cn('flex items-center gap-2.5 font-semibold', ln.strong)}>
                <CheckCircle2 size={18} className="text-success shrink-0" aria-hidden="true" /> {f}
              </li>
            ))}
          </ul>
          <Button onClick={openLandingAssistant} className="mt-9 h-12 px-7 rounded-xl font-black gap-2 shadow-lg shadow-cta/20">
            <Sparkles size={16} aria-hidden="true" /> {t('cta')}
          </Button>
        </div>

        <div ref={chatRef} className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 overflow-hidden dark:border-white/10 dark:bg-slate-950/80 dark:shadow-black/40" aria-hidden="true">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50/80 dark:border-white/5 dark:bg-white/[0.02]">
            <span className="w-10 h-10 rounded-full bg-gradient-to-br from-cta to-accent flex items-center justify-center text-white"><Sparkles size={18} /></span>
            <div className="leading-tight">
              <p className={cn('font-bold text-sm', ln.heading)}>{t('name')}</p>
              <p className="text-[11px] text-emerald-700 dark:text-success flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-success" />{t('online')}</p>
            </div>
          </div>
          <div className="min-h-[280px] p-5 flex flex-col gap-3">
            <AnimatePresence>
              {stage >= 1 && (
                <motion.p key="q" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="self-end max-w-[85%] rounded-2xl rounded-ee-sm bg-cta px-4 py-3 text-sm text-white leading-relaxed">
                  {t('demo_q')}
                </motion.p>
              )}
              {stage === 1 && (
                <motion.p key="typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="self-start rounded-2xl rounded-es-sm bg-slate-100 px-4 py-3 text-xs text-slate-500 flex items-center gap-2 dark:bg-white/[0.06] dark:text-slate-400">
                  <span className="flex gap-1">
                    {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                  </span>
                  {t('typing')}
                </motion.p>
              )}
              {stage === 2 && (
                <motion.p key="a" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="self-start max-w-[90%] rounded-2xl rounded-es-sm border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 leading-[1.85] dark:border-white/[0.06] dark:bg-white/[0.05] dark:text-slate-200">
                  {t('demo_a')}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
