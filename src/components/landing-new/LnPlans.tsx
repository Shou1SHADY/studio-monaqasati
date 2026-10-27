"use client";

import { useTranslations } from 'next-intl';
import { ArrowLeft, CheckCircle2, Gift } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { messageList } from '@/lib/message-list';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import { Reveal } from './Reveal';

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

  return (
    <section id="plans" className="relative py-20 md:py-28 bg-primary scroll-mt-20 overflow-hidden">
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHeader label={t('label')} title={t('title')} sub={t('sub')} />

        <Reveal>
          <div className="mb-8 rounded-2xl border border-success/25 bg-success/10 px-5 py-5 md:px-7 flex flex-col md:flex-row md:items-center gap-4">
            <span className="w-12 h-12 rounded-xl bg-success/15 text-success flex items-center justify-center shrink-0"><Gift size={22} aria-hidden="true" /></span>
            <div className="flex-1">
              <p className="text-white font-black text-lg">{t('banner_title')}</p>
              <p className="text-slate-300 text-sm leading-relaxed mt-1">{t('banner_desc')}</p>
            </div>
            <Button asChild variant="success" className="w-full md:w-auto h-11 px-6 rounded-xl font-bold gap-2"><Link href="/supplier-signup">{t('banner_cta')} <ArrowLeft size={15} className="ltr:rotate-180" /></Link></Button>
          </div>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-5 md:gap-6 items-stretch">
          {tiers.map((tier, i) => (
            <Reveal key={tier.name} delay={i * 0.1} className="h-full">
              <article className={cn(
                'relative h-full rounded-3xl border p-7 md:p-8 flex flex-col',
                tier.popular ? 'border-accent/40 bg-gradient-to-b from-accent/10 to-slate-950 shadow-2xl shadow-accent/10 md:-translate-y-3' : 'border-white/10 bg-white/[0.03]',
              )}>
                {tier.popular && (
                  <span className="absolute -top-3.5 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 rounded-full bg-accent px-4 py-1 text-xs font-black text-primary">
                    {tp('most_popular')}
                  </span>
                )}
                <h3 className="text-2xl font-bold text-white">{tier.name}</h3>
                <p className="text-slate-400 text-sm mt-1.5">{tier.desc}</p>
                <p className="mt-6 mb-7 text-4xl font-black text-white">{tier.price}</p>
                <ul className="space-y-3.5 mb-9 flex-1">
                  {tier.features.map(f => (
                    <li key={f} className="flex items-start gap-3 text-slate-300">
                      <CheckCircle2 size={18} className="text-accent shrink-0 mt-0.5" aria-hidden="true" /> {f}
                    </li>
                  ))}
                </ul>
                {tier.action === 'start' ? (
                  <Button variant="ghost" onClick={onStart} className="w-full h-12 rounded-xl font-bold bg-white/10 text-white hover:bg-white/20 hover:text-white">{tier.cta}</Button>
                ) : (
                  <Button asChild variant={tier.popular ? 'default' : 'ghost'} className={cn('w-full h-12 rounded-xl font-bold', !tier.popular && 'bg-white/10 text-white hover:bg-white/20 hover:text-white')}><a href="#contact">{tier.cta}</a></Button>
                )}
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
