"use client";

import { useTranslations } from 'next-intl';
import { Mail, MessageCircle, Phone, Quote } from 'lucide-react';
import { Reveal } from './Reveal';

const PHONE = '+966550013416';
const EMAIL = 'info@mdmaktech.sa';

/** The team's own note under the demo form, with the direct lines. */
export function LnContactNote() {
  const t = useTranslations('LandingNew.contact');
  const tWa = useTranslations('LandingNew.wa');

  const lines = [
    { icon: MessageCircle, label: tWa('label'), value: PHONE, href: 'https://wa.me/966550013416', external: true },
    { icon: Phone, label: PHONE, value: PHONE, href: `tel:${PHONE}`, external: false },
    { icon: Mail, label: EMAIL, value: EMAIL, href: `mailto:${EMAIL}`, external: false },
  ];

  return (
    <div className="bg-slate-950 pb-20 md:pb-28">
      <Reveal className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="rounded-3xl border border-white/[0.07] bg-gradient-to-br from-primary to-slate-950 p-7 md:p-10 grid md:grid-cols-[1.4fr_1fr] gap-8 items-center">
          <figure>
            <Quote size={28} className="text-accent mb-4 rtl:-scale-x-100" aria-hidden="true" />
            <blockquote className="text-slate-200 text-base md:text-lg leading-[1.9]">{t('note')}</blockquote>
            <figcaption className="mt-4 text-accent font-bold">{t('sign')}</figcaption>
          </figure>
          <div>
            <p className="text-sm font-bold text-slate-400 mb-3">{t('or')}</p>
            <ul className="space-y-2.5">
              {lines.map(l => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-slate-200 hover:border-accent/30 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <l.icon size={18} className="text-accent shrink-0" aria-hidden="true" />
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
