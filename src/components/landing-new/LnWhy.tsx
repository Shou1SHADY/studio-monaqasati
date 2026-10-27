"use client";

import { useTranslations } from 'next-intl';
import { BadgeCheck, Route, Scale, type LucideIcon } from 'lucide-react';
import { SectionHeader } from './SectionHeader';
import { Reveal } from './Reveal';

export function LnWhy() {
  const t = useTranslations('LandingNew.why');
  const cards: { icon: LucideIcon; title: string; desc: string }[] = [
    { icon: Scale, title: t('c1_title'), desc: t('c1_desc') },
    { icon: BadgeCheck, title: t('c2_title'), desc: t('c2_desc') },
    { icon: Route, title: t('c3_title'), desc: t('c3_desc') },
  ];

  return (
    <section id="why" className="relative py-20 md:py-28 bg-primary scroll-mt-20 overflow-hidden">
      <div className="absolute -bottom-40 -end-40 w-[520px] h-[520px] rounded-full bg-cta/10 blur-[130px] pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <SectionHeader label={t('label')} title={t('title')} sub={t('sub')} />
        <div className="grid md:grid-cols-3 gap-5 md:gap-6">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.1}>
              <article className="group h-full rounded-2xl border border-white/[0.07] bg-white/[0.03] p-7 md:p-8 transition-all duration-300 hover:-translate-y-1 hover:border-accent/30 hover:bg-white/[0.05]">
                <span className="w-14 h-14 rounded-2xl bg-accent/10 text-accent flex items-center justify-center mb-6 transition-transform group-hover:scale-110">
                  <c.icon size={26} />
                </span>
                <h3 className="text-xl font-bold text-white mb-3">{c.title}</h3>
                <p className="text-slate-400 leading-[1.85]">{c.desc}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
