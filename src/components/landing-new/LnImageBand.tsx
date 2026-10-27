"use client";

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

/**
 * The full-bleed photo band of the current landing (the loading dock). Light: the photo in
 * colour under a brand-blue wash; dark: grey under navy, as on the current landing.
 */
export function LnImageBand({ onStart }: { onStart: () => void }) {
  const t = useTranslations('Landing.Partnership');
  const tFooter = useTranslations('Landing.Footer');

  return (
    <section className="relative py-24 md:py-40 overflow-hidden">
      <Image fill src="/images/loading-dock.jpg" alt="" className="object-cover dark:grayscale dark:opacity-30" sizes="100vw" />
      <div className="absolute inset-0 bg-gradient-to-br from-primary/90 via-cta/75 to-primary/85 dark:hidden" aria-hidden="true" />
      <div className="absolute inset-0 hidden dark:block bg-gradient-to-b from-slate-950 via-transparent to-slate-950" aria-hidden="true" />

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center space-y-8">
        <span className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-white/10 border border-white/20 text-white text-xs font-black backdrop-blur dark:bg-cta/10 dark:border-cta/20 dark:text-sky-400">
          {t('tagline')}
        </span>
        {/* The title carries its own highlight span (message markup, as on the current landing). */}
        <h2 className="text-2xl sm:text-3xl md:text-5xl lg:text-6xl font-bold text-white leading-[1.6] [&_span]:!text-sky-200 dark:[&_span]:!text-sky-400" dangerouslySetInnerHTML={{ __html: t.raw('title') }} />
        <p className="text-sky-50/90 text-base md:text-xl leading-relaxed font-medium dark:text-slate-300">{t('desc')}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
          <Button onClick={onStart} className="h-12 md:h-14 px-8 md:px-12 text-base font-black rounded-2xl bg-white text-primary hover:bg-sky-50 hover:text-primary shadow-xl shadow-black/20 dark:bg-cta dark:text-white dark:hover:bg-cta/90">
            {t('cta')}
          </Button>
          <Button asChild variant="outline" className="h-12 md:h-14 px-8 md:px-12 text-base font-black rounded-2xl border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
            <Link href="/about">{tFooter('l_about')}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
