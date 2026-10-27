"use client";

import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { Mail, MapPin, Phone } from 'lucide-react';
import { Link } from '@/i18n/routing';

const SOCIAL = [
  { href: 'https://x.com/mdmaktech', label: 'X (Twitter)', path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
  { href: 'https://linkedin.com/company/mdmaktech', label: 'LinkedIn', path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
];

export function LnFooter() {
  const t = useTranslations('Landing.Footer');
  const tNew = useTranslations('LandingNew.footer');
  const tNav = useTranslations('LandingNew.nav');
  const locale = useLocale();

  const quick = [
    { label: tNav('why'), href: '#why' },
    { label: tNav('how'), href: '#how' },
    { label: tNav('plans'), href: '#plans' },
    { label: tNav('contact'), href: '#contact' },
  ];
  const pages = [
    { label: t('l_about'), href: '/about' },
    { label: t('l_suppliers'), href: '/supplier-signup' },
    { label: t('l_privacy'), href: '/privacy' },
    { label: t('l_terms'), href: '/terms' },
  ];

  return (
    <footer className="relative bg-slate-950 border-t border-white/5 overflow-hidden">
      <div className="absolute -bottom-48 -end-48 w-[600px] h-[600px] bg-cta/10 rounded-full blur-[140px] pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-16 pb-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1.2fr]">
        <div className="space-y-5">
          <Image src="/logo1.png" alt={locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech'} width={140} height={48} className="h-10 w-auto object-contain" />
          <p className="text-white font-bold text-lg leading-relaxed max-w-[28ch]">{tNew('tagline')}</p>
          <p className="text-slate-400 text-sm leading-[1.85] max-w-[36ch]">{t('desc')}</p>
          <div className="flex items-center gap-2.5">
            {SOCIAL.map(s => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                className="w-10 h-10 rounded-xl border border-white/10 bg-white/[0.04] flex items-center justify-center text-slate-400 hover:text-accent hover:border-accent/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true"><path d={s.path} /></svg>
              </a>
            ))}
          </div>
        </div>

        <nav aria-label={t('quick_links')}>
          <h3 className="text-slate-200 text-sm font-bold mb-4">{t('quick_links')}</h3>
          <ul className="space-y-3">
            {quick.map(l => (
              <li key={l.href}><a href={l.href} className="text-sm text-slate-400 hover:text-white transition-colors">{l.label}</a></li>
            ))}
          </ul>
        </nav>

        <nav aria-label={t('legal')}>
          <h3 className="text-slate-200 text-sm font-bold mb-4">{t('legal')}</h3>
          <ul className="space-y-3">
            {pages.map(l => (
              <li key={l.href}><Link href={l.href} className="text-sm text-slate-400 hover:text-white transition-colors">{l.label}</Link></li>
            ))}
          </ul>
        </nav>

        <div>
          <h3 className="text-slate-200 text-sm font-bold mb-4">{t('address_title')}</h3>
          <div className="space-y-3.5 text-sm">
            <p className="flex items-start gap-2.5 text-slate-400 leading-[1.75]">
              <MapPin size={15} className="text-slate-500 mt-1 shrink-0" aria-hidden="true" />
              {/* The address carries <br/> line breaks in the message (as on the current landing). */}
              <span dangerouslySetInnerHTML={{ __html: t.raw('address_value') }} />
            </p>
            <a href="https://wa.me/966550013416" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-slate-400 hover:text-white">
              <Phone size={15} className="text-slate-500 shrink-0" aria-hidden="true" /><span dir="ltr">{t('support_phone')}</span>
            </a>
            <a href="mailto:info@mdmaktech.sa" className="flex items-center gap-2.5 text-slate-400 hover:text-white">
              <Mail size={15} className="text-slate-500 shrink-0" aria-hidden="true" />info@mdmaktech.sa
            </a>
          </div>
        </div>
      </div>

      <div className="relative border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <p>{t('copyright', { year: new Date().getFullYear() })}</p>
          <p>{t('made_in')}</p>
        </div>
      </div>
    </footer>
  );
}
