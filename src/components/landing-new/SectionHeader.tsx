"use client";

import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import { Reveal } from './Reveal';

/** The head every section shares: a label pill, the title and one line under it. */
export function SectionHeader({ label, title, sub, align = 'center', className }: {
  label: string;
  title: string;
  sub?: string;
  align?: 'center' | 'start';
  className?: string;
}) {
  const isAr = useLocale() === 'ar';
  return (
    <Reveal className={cn('mb-10 md:mb-14', align === 'center' ? 'text-center mx-auto max-w-3xl' : 'text-start max-w-2xl', className)}>
      <span className="inline-block rounded-sm border border-accent/20 bg-accent/10 px-3.5 py-1.5 text-xs md:text-sm font-bold text-accent mb-4">
        {label}
      </span>
      <h2 className={cn('font-extrabold text-white text-[clamp(26px,4vw,48px)]', isAr ? 'leading-[1.6]' : 'leading-[1.2] tracking-tight')}>
        {title}
      </h2>
      {sub && <p className="mt-4 text-slate-400 text-base md:text-lg leading-relaxed">{sub}</p>}
    </Reveal>
  );
}
