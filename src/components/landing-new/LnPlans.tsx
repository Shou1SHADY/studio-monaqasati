"use client";

import { useTranslations } from 'next-intl';
import { ArrowLeft, CheckCircle2, Gift } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { messageList } from '@/lib/message-list';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import { Reveal } from './Reveal';
import { ln } from './tone';

/** The /pricing tiers, with the free supplier account on top. */
export function LnPlans({ onStart }: { onStart: () => void }) {
  const t = useTranslations('LandingNew.plans');
  const tp = useTranslations('Pricing');
  const tNav = useTranslations('LandingNew.nav');

  const tiers = [
    { name: tp('free_tier'), desc: tp('free_tier_desc'), price: tp('free'), features: messageList(tp.raw('free_features')), cta: tNav('start'), popular: false, action: 'start' as const },
    { name: tp('growth_tier'), desc: tp('growth_tier_desc'), price: tp('contact_us'), features: messageList(tp.raw('growth_features')), cta: tp('request_quote'), popular: true, action: 'contact' as const },
    { name: tp('enterprise_tier'), desc: tp('enterprise_tier_desc'), price: tp('custom'), features: messageList(tp.raw('enterprise_features')), cta: tp('contact_sales'), popular: false, action: 'contact' as const },
  ];

  const quietBtn = 'w-full h-12 rounded-xl font-bold border border-slate-200 bg-white text-primary hover:bg-slate-50 hover:text-primary dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 dark:hover:text-white';

  return (
    <section id="plans" className={cn('relative py-20 md:py-28 scroll-mt-20 overflow-hidden', ln.band)}>
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHeader label={t('label')} title={t('title')} sub={t('sub')} />

        <Reveal>
          <div className="mb-10 rounded-2xl border border-success/25 bg-success/[0.07] px-5 py-5 md:px-7 flex flex-col md:flex-row md:items-center gap-4 dark:bg-success/10">
            <span className="w-12 h-12 rounded-xl bg-success/15 text-success flex items-center justify-center shrink-0"><Gift size={22} aria-hidden="true" /></span>
            <div className="flex-1">
              <p className={cn('font-black text-lg', ln.heading)}>{t('banner_title')}</p>
              <p className={cn('text-sm leading-relaxed mt-1', ln.body)}>{t('banner_desc')}</p>
            </div>
            <Button asChild variant="success" className="w-full md:w-auto h-11 px-6 rounded-xl font-bold gap-2">
              <Link href="/supplier-signup">{t('banner_cta')} <ArrowLeft size={15} className="ltr:rotate-180" /></Link>
            </Button>
          </div>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-5 md:gap-6 items-stretch">
          {tiers.map((tier, i) => (
            <Reveal key={tier.name} delay={i * 0.1} className="h-full">
              <article className={cn(
                'relative h-full rounded-3xl p-7 md:p-8 flex flex-col',
                tier.popular
                  ? 'border-2 border-cta bg-white shadow-2xl shadow-cta/15 md:-translate-y-3 dark:border-accent/50 dark:bg-gradient-to-b dark:from-accent/10 dark:to-slate-950 dark:shadow-accent/10'
                  : ln.card,
              )}>
                {tier.popular && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-cta px-4 py-1 text-xs font-black text-white shadow-md shadow-cta/30 dark:bg-accent dark:text-primary">
                    {tp('most_popular')}
                  </span>
                )}
                <h3 className={cn('text-2xl font-bold', ln.heading)}>{tier.name}</h3>
                <p className={cn('text-sm mt-1.5', ln.body)}>{tier.desc}</p>
                <p className={cn('mt-6 mb-7 text-4xl font-black', ln.heading)}>{tier.price}</p>
                <ul className="space-y-3.5 mb-9 flex-1">
                  {tier.features.map(f => (
                    <li key={f} className={cn('flex items-start gap-3', ln.strong)}>
                      <CheckCircle2 size={18} className="text-cta shrink-0 mt-0.5 dark:text-accent" aria-hidden="true" /> {f}
                    </li>
                  ))}
                </ul>
                {tier.action === 'start' ? (
                  <Button variant="ghost" onClick={onStart} className={quietBtn}>{tier.cta}</Button>
                ) : tier.popular ? (
                  <Button asChild className="w-full h-12 rounded-xl font-bold shadow-lg shadow-cta/20"><a href="#contact">{tier.cta}</a></Button>
                ) : (
                  <Button asChild variant="ghost" className={quietBtn}><a href="#contact">{tier.cta}</a></Button>
                )}
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
