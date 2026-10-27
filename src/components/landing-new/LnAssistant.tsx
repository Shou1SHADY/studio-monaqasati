"use client";

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openLandingAssistant } from '@/lib/landing-assistant';
import { cn } from '@/lib/utils';

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
    <section id="assistant" className="relative py-20 md:py-28 bg-primary scroll-mt-20 overflow-hidden">
      <div className="absolute top-1/2 -translate-y-1/2 start-[-10%] w-[480px] h-[480px] rounded-full bg-accent/10 blur-[140px] pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-sm border border-accent/20 bg-accent/10 px-3.5 py-1.5 text-xs md:text-sm font-bold text-accent mb-4">
            <Sparkles size={14} aria-hidden="true" /> {t('label')}
          </span>
          <h2 className={cn('font-extrabold text-white text-[clamp(26px,4vw,48px)]', isAr ? 'leading-[1.6]' : 'leading-[1.2] tracking-tight')}>{t('title')}</h2>
          <p className="mt-4 text-slate-400 text-base md:text-lg leading-relaxed">{t('sub')}</p>
          <ul className="mt-8 grid sm:grid-cols-2 gap-3">
            {features.map(f => (
              <li key={f} className="flex items-center gap-2.5 text-slate-200 font-semibold">
                <CheckCircle2 size={18} className="text-accent shrink-0" aria-hidden="true" /> {f}
              </li>
            ))}
          </ul>
          <Button onClick={openLandingAssistant} className="mt-9 h-12 px-7 rounded-xl font-black gap-2">
            <Sparkles size={16} aria-hidden="true" /> {t('cta')}
          </Button>
        </div>

        <div ref={chatRef} className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/80 shadow-2xl shadow-black/40 overflow-hidden" aria-hidden="true">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5 bg-white/[0.02]">
            <span className="w-10 h-10 rounded-full bg-gradient-to-br from-cta to-accent flex items-center justify-center text-white"><Sparkles size={18} /></span>
            <div className="leading-tight">
              <p className="text-white font-bold text-sm">{t('name')}</p>
              <p className="text-[11px] text-success flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-success" />{t('online')}</p>
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
                  className="self-start rounded-2xl rounded-es-sm bg-white/[0.06] px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
                  <span className="flex gap-1">
                    {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                  </span>
                  {t('typing')}
                </motion.p>
              )}
              {stage === 2 && (
                <motion.p key="a" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="self-start max-w-[90%] rounded-2xl rounded-es-sm border border-white/[0.06] bg-white/[0.05] px-4 py-3 text-sm text-slate-200 leading-[1.85]">
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
