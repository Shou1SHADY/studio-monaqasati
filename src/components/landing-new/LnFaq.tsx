"use client";

import { useTranslations } from 'next-intl';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { SectionHeader } from './SectionHeader';

const ITEMS = [1, 2, 3, 4, 5, 6] as const;

/** The current landing's questions, under the new section head. */
export function LnFaq() {
  const t = useTranslations('Landing.FAQ');
  const tl = useTranslations('LandingNew.faq');

  return (
    <section className="py-20 md:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <SectionHeader label={tl('label')} title={t('heading')} sub={t('subtitle')} />
        <Accordion type="single" collapsible className="space-y-3">
          {ITEMS.map(n => (
            <AccordionItem
              key={n}
              value={`faq-${n}`}
              className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-5 md:px-6 data-[state=open]:border-accent/30"
            >
              <AccordionTrigger className="py-5 text-start text-white font-bold text-base md:text-lg hover:no-underline hover:text-accent">
                {t(`q${n}`)}
              </AccordionTrigger>
              <AccordionContent className="pb-6 text-slate-400 text-sm md:text-base leading-[1.85]">
                {t(`a${n}`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
