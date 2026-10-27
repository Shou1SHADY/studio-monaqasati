"use client";

import { useTranslations } from 'next-intl';
import { ArrowLeft, BadgeCheck, Package } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { messageList } from '@/lib/message-list';
import { SectionHeader } from './SectionHeader';
import { Reveal } from './Reveal';
import type { LandingPreview } from './preview';

/** The supplier network teaser: live verified count, material categories, a few (redacted) suppliers. */
export function LnNetwork({ data, onStart }: { data: LandingPreview | null; onStart: () => void }) {
  const t = useTranslations('LandingNew.network');
  const cats = messageList(t.raw('cats'));
  const suppliers = (data?.suppliers ?? []).slice(0, 3);
  const count = data?.supplierCount ?? 0;

  return (
    <section id="network" className="relative py-20 md:py-28 scroll-mt-20 overflow-hidden">
      <div className="absolute inset-0 ln-grid-bg opacity-40 pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <SectionHeader label={t('label')} title={t('title')} sub={t('sub')} />

        <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-6 items-stretch">
          <Reveal className="h-full">
            <div className="h-full rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/10 to-cta/5 p-8 flex flex-col">
              {count > 0 && (
                <div className="mb-6">
                  <p className="text-5xl md:text-6xl font-black text-white tracking-latin">{count}+</p>
                  <p className="mt-2 text-slate-300 font-semibold">{t('count_label')}</p>
                </div>
              )}
              <p className="text-slate-300 leading-[1.85] mb-8 flex items-start gap-2">
                <Package size={18} className="text-accent shrink-0 mt-1" aria-hidden="true" />
                {t('categories_line')}
              </p>

              {suppliers.length > 0 && (
                <ul className="space-y-2.5 mb-8">
                  {suppliers.map(s => (
                    <li key={s.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-slate-950/40 px-3 py-2.5">
                      {/* The avatar colour comes from the API (one gradient per supplier). */}
                      <span className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-black shrink-0" style={{ background: s.bg }} aria-hidden="true">
                        {s.initial}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block h-3 w-28 max-w-full rounded bg-white/25 blur-[2px] my-1" title={t('hidden')} aria-hidden="true" />
                        <span className="sr-only">{t('hidden')}</span>
                        <span className="block text-xs text-slate-400 truncate">{s.category}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-success shrink-0">
                        <BadgeCheck size={13} /> {t('verified')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-auto flex flex-col sm:flex-row gap-3">
                <Button asChild className="flex-1 w-full h-11 rounded-xl font-bold gap-2"><Link href="/supplier-signup">{t('cta_supplier')} <ArrowLeft size={15} className="ltr:rotate-180" /></Link></Button>
                <Button variant="ghost" onClick={onStart} className="flex-1 h-11 rounded-xl font-bold text-slate-200 border border-white/10 hover:bg-white/5 hover:text-white">
                  {t('cta_contractor')}
                </Button>
              </div>
            </div>
          </Reveal>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {cats.map((c, i) => (
              <Reveal key={c} delay={(i % 6) * 0.05}>
                <div className="h-full min-h-[84px] rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-4 flex items-center gap-3 transition-colors hover:border-accent/30 hover:bg-white/[0.05]">
                  <span className="w-2 h-2 rounded-sm bg-accent rotate-45 shrink-0" aria-hidden="true" />
                  <span className="text-sm md:text-base font-semibold text-slate-200">{c}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
