"use client";

import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import {
  BellRing, ChevronDown, FileSpreadsheet, Globe, LayoutDashboard, Link2, MessageCircle, Smartphone, Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import { Reveal } from './Reveal';

type Channel = { icon: LucideIcon; label: string };

/** Lines from every channel to the hub (or back out). Drawn LTR; mirrored in RTL, where the columns swap sides. */
function Fan({ count, direction }: { count: number; direction: 'in' | 'out' }) {
  const ys = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * 100);
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="hidden lg:block w-full h-full rtl:-scale-x-100" aria-hidden="true">
      {ys.map(y => {
        const [x1, y1, x2, y2] = direction === 'in' ? [0, y, 100, 50] : [0, 50, 100, y];
        return (
          <g key={y}>
            <path d={`M${x1} ${y1} C 50 ${y1}, 50 ${y2}, ${x2} ${y2}`} fill="none" stroke="currentColor" className="text-white/10" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <path d={`M${x1} ${y1} C 50 ${y1}, 50 ${y2}, ${x2} ${y2}`} fill="none" stroke="currentColor" className="text-accent/70 ln-dash" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </svg>
  );
}

function Column({ title, items, tone }: { title: string; items: Channel[]; tone: 'in' | 'out' }) {
  return (
    <div className="flex flex-col">
      <p className="text-center lg:text-start text-sm font-black text-slate-300 mb-4">{title}</p>
      <ul className="grid grid-cols-2 lg:grid-cols-1 gap-3 lg:gap-0 lg:flex-1 lg:flex lg:flex-col">
        {items.map(c => (
          <li key={c.label} className="lg:flex-1 lg:flex lg:items-center lg:py-1.5">
            <span className="w-full flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
              <span className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', tone === 'in' ? 'bg-sky-400/10 text-sky-300' : 'bg-success/10 text-success')}>
                <c.icon size={17} />
              </span>
              <span className="text-xs sm:text-sm font-semibold text-slate-200 leading-snug">{c.label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LnChannels() {
  const t = useTranslations('LandingNew.channels');
  const locale = useLocale();

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
    <section className="relative py-20 md:py-28 bg-primary overflow-hidden">
      <div className="absolute inset-0 ln-grid-bg opacity-50 pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHeader label={t('label')} title={t('title')} sub={t('sub')} />

        <Reveal>
          <figure aria-label={t('diagram_label')} className="grid lg:grid-cols-[1fr_88px_auto_88px_1fr] gap-4 lg:gap-0 items-stretch">
            <Column title={t('users_label')} items={inbound} tone="in" />
            <div className="hidden lg:block pt-9"><Fan count={inbound.length} direction="in" /></div>
            <ChevronDown className="lg:hidden mx-auto text-accent animate-bounce" aria-hidden="true" />

            <div className="flex items-center justify-center lg:pt-9">
              <div className="relative">
                <span className="absolute -inset-3 rounded-[2rem] border border-accent/30 animate-pulse" aria-hidden="true" />
                <div className="relative w-56 rounded-3xl border border-accent/30 bg-gradient-to-b from-slate-900 to-slate-950 p-6 text-center shadow-2xl shadow-accent/10">
                  <Image src="/logo1.png" alt={locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech'} width={140} height={48} className="h-10 w-auto mx-auto object-contain mb-3" />
                  <p className="text-white font-black">{t('platform_label')}</p>
                  <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">{t('platform_sub')}</p>
                </div>
              </div>
            </div>

            <ChevronDown className="lg:hidden mx-auto text-accent animate-bounce" aria-hidden="true" />
            <div className="hidden lg:block pt-9"><Fan count={outbound.length} direction="out" /></div>
            <Column title={t('vendor_label')} items={outbound} tone="out" />
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
