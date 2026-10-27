"use client";

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

/** The full-bleed photo band of the current landing (the loading dock), kept as it is. */
export function LnImageBand({ onStart }: { onStart: () => void }) {
  const t = useTranslations('Landing.Partnership');
  const tFooter = useTranslations('Landing.Footer');

  return (
    <section className="relative py-20 md:py-40 overflow-hidden border-y border-white/5">
      <Image fill src="/images/loading-dock.jpg" alt="" className="object-cover grayscale opacity-30" sizes="100vw" />
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-transparent to-slate-950" aria-hidden="true" />

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center space-y-8">
        <span className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-cta/10 border border-cta/20 text-sky-400 text-xs font-black">
          {t('tagline')}
        </span>
        {/* The title carries its own highlight span (message markup, as on the current landing). */}
        <h2 className="text-2xl sm:text-3xl md:text-5xl lg:text-6xl font-bold text-white leading-[1.6]" dangerouslySetInnerHTML={{ __html: t.raw('title') }} />
        <p className="text-slate-300 text-base md:text-xl leading-relaxed font-medium">{t('desc')}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
          <Button onClick={onStart} className="h-12 md:h-14 px-8 md:px-12 text-base font-black rounded-2xl shadow-xl shadow-cta/20">
            {t('cta')}
          </Button>
          <Button asChild variant="outline" className="h-12 md:h-14 px-8 md:px-12 text-base font-black rounded-2xl border-white/15 bg-transparent text-white hover:bg-white/5 hover:text-white"><Link href="/about">{tFooter('l_about')}</Link></Button>
        </div>
      </div>
    </section>
  );
}
