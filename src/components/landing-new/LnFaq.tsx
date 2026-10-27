"use client";

import { useTranslations } from 'next-intl';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import { ln } from './tone';

const ITEMS = [1, 2, 3, 4, 5, 6] as const;

/** The current landing's questions, under the new section head. */
export function LnFaq() {
  const t = useTranslations('Landing.FAQ');
  const tl = useTranslations('LandingNew.faq');

  return (
    <section className={cn('py-20 md:py-28', ln.page)}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <SectionHeader label={tl('label')} title={t('heading')} sub={t('subtitle')} />
        <Accordion type="single" collapsible className="space-y-3">
          {ITEMS.map(n => (
            <AccordionItem
              key={n}
              value={`faq-${n}`}
              className={cn('rounded-2xl px-5 md:px-6 border-b-0 data-[state=open]:border-cta/30 dark:data-[state=open]:border-accent/30', ln.card)}
            >
              <AccordionTrigger className={cn('py-5 text-start font-bold text-base md:text-lg hover:no-underline hover:text-cta dark:hover:text-accent', ln.heading)}>
                {t(`q${n}`)}
              </AccordionTrigger>
              <AccordionContent className={cn('pb-6 text-sm md:text-base leading-[1.85]', ln.body)}>
                {t(`a${n}`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
