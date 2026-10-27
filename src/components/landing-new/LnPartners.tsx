"use client";

import Image from 'next/image';
import { useTranslations } from 'next-intl';

const LOGOS = [
  { src: '/images/logo-qudra.png', alt: 'Qudra' },
  { src: '/images/logo-naya.jpeg', alt: 'Naya' },
  { src: '/images/logo-itc.png', alt: 'ITC' },
];

/** The early partners' logos, kept from the current landing. */
export function LnPartners() {
  const t = useTranslations('Landing');
  return (
    <section className="py-10 border-y border-white/5 bg-primary/40">
      <div className="max-w-4xl mx-auto px-6 flex flex-col md:flex-row items-center justify-center gap-6 md:gap-10">
        <p className="text-slate-400 text-sm font-bold shrink-0">{t('Partners')}</p>
        <div className="flex items-center justify-center gap-4 md:gap-8 flex-wrap">
          {LOGOS.map(l => (
            <div key={l.src} className="relative w-28 md:w-36 h-14 md:h-16 rounded-xl border border-white/10 bg-white/5">
              <Image fill src={l.src} alt={l.alt} sizes="144px" className="object-contain p-3 opacity-60 hover:opacity-90 transition-opacity" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
