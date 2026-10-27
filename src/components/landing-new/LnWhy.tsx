"use client";

import { useTranslations } from 'next-intl';
import { BadgeCheck, Route, Scale, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import { Reveal } from './Reveal';
import { ln } from './tone';

export function LnWhy() {
  const t = useTranslations('LandingNew.why');
  const cards: { icon: LucideIcon; title: string; desc: string; accent: string }[] = [
    { icon: Scale, title: t('c1_title'), desc: t('c1_desc'), accent: 'from-cta to-sky-400' },
    { icon: BadgeCheck, title: t('c2_title'), desc: t('c2_desc'), accent: 'from-success to-emerald-400' },
    { icon: Route, title: t('c3_title'), desc: t('c3_desc'), accent: 'from-accent to-cyan-300' },
  ];

  return (
    <section id="why" className={cn('relative py-20 md:py-28 scroll-mt-20 overflow-hidden', ln.page)}>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <SectionHeader label={t('label')} title={t('title')} sub={t('sub')} />
        <div className="grid md:grid-cols-3 gap-5 md:gap-6">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.1} className="h-full">
              <article className={cn('group relative h-full overflow-hidden rounded-2xl p-7 md:p-8', ln.card, ln.cardHover)}>
                <span className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r opacity-80', c.accent)} aria-hidden="true" />
                <span className={cn('w-14 h-14 rounded-2xl flex items-center justify-center mb-6 transition-transform group-hover:scale-110', ln.iconTile)}>
                  <c.icon size={26} />
                </span>
                <h3 className={cn('text-xl font-bold mb-3', ln.heading)}>{c.title}</h3>
                <p className={cn('leading-[1.85]', ln.body)}>{c.desc}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
