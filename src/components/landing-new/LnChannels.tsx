"use client";

import { useTranslations } from 'next-intl';
import {
  BellRing, ChevronDown, FileSpreadsheet, Globe, LayoutDashboard, Link2, MessageCircle, Smartphone, Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import { Reveal } from './Reveal';
import { GridBackdrop } from './GridBackdrop';
import { LnLogo } from './LnNavbar';
import { ln } from './tone';

type Channel = { icon: LucideIcon; label: string };

/** Lines from every channel to the hub (or back out). Drawn LTR; mirrored in RTL, where the columns swap sides. */
function Fan({ count, direction }: { count: number; direction: 'in' | 'out' }) {
  const ys = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * 100);
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="hidden lg:block w-full h-full rtl:-scale-x-100" aria-hidden="true">
      {ys.map(y => {
        const [x1, y1, x2, y2] = direction === 'in' ? [0, y, 100, 50] : [0, 50, 100, y];
        const d = `M${x1} ${y1} C 50 ${y1}, 50 ${y2}, ${x2} ${y2}`;
        return (
          <g key={y}>
            <path d={d} fill="none" stroke="currentColor" className="text-slate-300 dark:text-white/10" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <path d={d} fill="none" stroke="currentColor" className="text-cta dark:text-accent ln-dash" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </svg>
  );
}

function Column({ title, items, tone }: { title: string; items: Channel[]; tone: 'in' | 'out' }) {
  return (
    <div className="flex flex-col">
      <p className={cn('text-center lg:text-start text-sm font-black mb-4', ln.strong)}>{title}</p>
      <ul className="grid grid-cols-2 lg:grid-cols-1 gap-3 lg:gap-0 lg:flex-1 lg:flex lg:flex-col">
        {items.map(c => (
          <li key={c.label} className="lg:flex-1 lg:flex lg:items-center lg:py-1.5">
            <span className={cn('w-full flex items-center gap-3 rounded-xl px-3.5 py-3', ln.card)}>
              <span className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                tone === 'in' ? 'bg-sky-500/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300' : 'bg-success/10 text-success',
              )}>
                <c.icon size={17} />
              </span>
              <span className={cn('text-xs sm:text-sm font-semibold leading-snug', ln.strong)}>{c.label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LnChannels() {
  const t = useTranslations('LandingNew.channels');

  const inbound: Channel[] = [
    { icon: Globe, label: t('in_1') },
    { icon: Smartphone, label: t('in_2') },
    { icon: FileSpreadsheet, label: t('in_3') },
    { icon: Sparkles, label: t('in_4') },
    { icon: MessageCircle, label: t('in_5') },
  ];
  const outbound: Channel[] = [
    { icon: LayoutDashboard, label: t('out_1') },
    { icon: Link2, label: t('out_2') },
    { icon: Smartphone, label: t('out_3') },
    { icon: BellRing, label: t('out_4') },
  ];

  return (
    <section className={cn('relative py-20 md:py-28 overflow-hidden', ln.band)}>
      <GridBackdrop />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHeader label={t('label')} title={t('title')} sub={t('sub')} />

        <Reveal>
          <figure aria-label={t('diagram_label')} className="grid lg:grid-cols-[1fr_88px_auto_88px_1fr] gap-4 lg:gap-0 items-stretch">
            <Column title={t('users_label')} items={inbound} tone="in" />
            <div className="hidden lg:block pt-9"><Fan count={inbound.length} direction="in" /></div>
            <ChevronDown className="lg:hidden mx-auto text-cta dark:text-accent animate-bounce" aria-hidden="true" />

            <div className="flex items-center justify-center lg:pt-9">
              <div className="relative">
                <span className="absolute -inset-3 rounded-[2rem] border-2 border-cta/20 animate-pulse dark:border-accent/30" aria-hidden="true" />
                <div className="relative w-56 rounded-3xl border border-cta/20 bg-white p-6 text-center shadow-2xl shadow-cta/15 dark:border-accent/30 dark:bg-gradient-to-b dark:from-slate-900 dark:to-slate-950 dark:shadow-accent/10">
                  <LnLogo className="h-10 mx-auto mb-3" />
                  <p className={cn('font-black', ln.heading)}>{t('platform_label')}</p>
                  <p className={cn('mt-1.5 text-[11px] leading-relaxed', ln.body)}>{t('platform_sub')}</p>
                </div>
              </div>
            </div>

            <ChevronDown className="lg:hidden mx-auto text-cta dark:text-accent animate-bounce" aria-hidden="true" />
            <div className="hidden lg:block pt-9"><Fan count={outbound.length} direction="out" /></div>
            <Column title={t('vendor_label')} items={outbound} tone="out" />
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
