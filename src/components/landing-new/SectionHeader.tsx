"use client";

import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import { Reveal } from './Reveal';
import { ln } from './tone';

/** The head every section shares: a label pill, the title and one line under it. */
export function SectionHeader({ label, icon, title, sub, align = 'center', className }: {
  label: string;
  icon?: ReactNode;
  title: string;
  sub?: string;
  align?: 'center' | 'start';
  className?: string;
}) {
  const isAr = useLocale() === 'ar';
  return (
    <Reveal className={cn('mb-10 md:mb-14', align === 'center' ? 'text-center mx-auto max-w-3xl' : 'text-start max-w-2xl', className)}>
      <span className={cn('inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs md:text-sm font-bold mb-4', ln.pill)}>
        {icon}
        {label}
      </span>
      <h2 className={cn('font-extrabold text-[clamp(26px,4vw,46px)]', ln.heading, isAr ? 'leading-[1.6]' : 'leading-[1.2] tracking-tight')}>
        {title}
      </h2>
      {sub && <p className={cn('mt-4 text-base md:text-lg leading-relaxed', ln.body)}>{sub}</p>}
    </Reveal>
  );
}
