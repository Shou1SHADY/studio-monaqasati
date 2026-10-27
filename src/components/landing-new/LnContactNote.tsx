"use client";

import { useTranslations } from 'next-intl';
import { Mail, MessageCircle, Phone, Quote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Reveal } from './Reveal';
import { ln } from './tone';

const PHONE = '+966550013416';
const EMAIL = 'info@mdmaktech.sa';

/** The team's own note under the demo form, with the direct lines. */
export function LnContactNote() {
  const t = useTranslations('LandingNew.contact');
  const tWa = useTranslations('LandingNew.wa');

  const lines = [
    { icon: MessageCircle, label: tWa('label'), href: 'https://wa.me/966550013416', external: true },
    { icon: Phone, label: PHONE, href: `tel:${PHONE}`, external: false },
    { icon: Mail, label: EMAIL, href: `mailto:${EMAIL}`, external: false },
  ];

  return (
    <div className="bg-slate-50 pb-20 md:pb-28 dark:bg-slate-950">
      <Reveal className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className={cn('rounded-3xl p-7 md:p-10 grid md:grid-cols-[1.4fr_1fr] gap-8 items-center', ln.card)}>
          <figure>
            <Quote size={28} className="text-cta mb-4 rtl:-scale-x-100 dark:text-accent" aria-hidden="true" />
            <blockquote className={cn('text-base md:text-lg leading-[1.9]', ln.strong)}>{t('note')}</blockquote>
            <figcaption className="mt-4 font-bold text-cta dark:text-accent">{t('sign')}</figcaption>
          </figure>
          <div>
            <p className={cn('text-sm font-bold mb-3', ln.faint)}>{t('or')}</p>
            <ul className="space-y-2.5">
              {lines.map(l => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                      'border-slate-200 bg-slate-50 text-slate-700 hover:border-cta/30 hover:text-primary',
                      'dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-slate-200 dark:hover:border-accent/30 dark:hover:text-white',
                      ln.focus,
                    )}
                  >
                    <l.icon size={18} className="text-cta shrink-0 dark:text-accent" aria-hidden="true" />
                    <span className="text-sm font-semibold" dir={l.external ? undefined : 'ltr'}>{l.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
