"use client";

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { DemoRequestSection } from '@/components/DemoRequestSection';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { ComparisonSection } from '@/components/landing/ComparisonSection';
import { LnTopBar } from './LnTopBar';
import { LnNavbar } from './LnNavbar';
import { LnHero } from './LnHero';
import { LnPartners } from './LnPartners';
import { LnWhy } from './LnWhy';
import { LnNetwork } from './LnNetwork';
import { LnChannels } from './LnChannels';
import { LnHowItWorks } from './LnHowItWorks';
import { LnAssistant } from './LnAssistant';
import { LnApp } from './LnApp';
import { LnImageBand } from './LnImageBand';
import { LnPlans } from './LnPlans';
import { LnFaq } from './LnFaq';
import { LnContactNote } from './LnContactNote';
import { LnFooter } from './LnFooter';
import { LnWhatsAppFab } from './LnWhatsAppFab';
import { isLandingPreview, type LandingPreview } from './preview';

const LandingChatWidget = dynamic(
  () => import('@/components/rag/LandingChatWidget').then(m => ({ default: m.LandingChatWidget })),
  { ssr: false },
);

/**
 * The new landing (UAT preview at /landing-new): midmak.sa's sectioning — offer bar, hero with
 * floating figures, why, network, channels, steps, assistant, app, plans, contact — in Mdmak's
 * theme, keeping the current landing's photo band, partners, before/after, FAQ and demo form.
 */
export function LandingNewPage() {
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [data, setData] = useState<LandingPreview | null>(null);
  const start = () => setOnboardingOpen(true);

  useEffect(() => {
    fetch('/api/landing/preview')
      .then(r => (r.ok ? r.json() : null))
      .then((d: unknown) => { if (isLandingPreview(d)) setData(d); })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-svh bg-slate-950 font-body text-foreground overflow-x-hidden scroll-smooth selection:bg-cta/30">
      <LnTopBar />
      <LnNavbar onStart={start} />
      <main>
        <LnHero data={data} onStart={start} />
        <LnPartners />
        <LnWhy />
        <ComparisonSection />
        <LnNetwork data={data} onStart={start} />
        <LnChannels />
        <LnHowItWorks />
        <LnAssistant />
        <LnApp />
        <LnImageBand onStart={start} />
        <LnPlans onStart={start} />
        <LnFaq />
        <div id="contact" className="scroll-mt-20">
          <DemoRequestSection />
          <LnContactNote />
        </div>
      </main>
      <LnFooter />
      <LnWhatsAppFab />
      <LandingChatWidget />
      <OnboardingWizard open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
    </div>
  );
}
