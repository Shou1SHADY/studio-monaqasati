"use client";

import { useTranslations } from 'next-intl';

const WA_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.528 5.862L0 24l6.293-1.508A11.933 11.933 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.807 9.807 0 0 1-5.196-1.487l-.372-.221-3.86.924.976-3.754-.243-.387A9.815 9.815 0 0 1 2.182 12C2.182 6.572 6.572 2.182 12 2.182S21.818 6.572 21.818 12 17.428 21.818 12 21.818z';

/** Floating WhatsApp button — on the side opposite the assistant's bubble. */
export function LnWhatsAppFab() {
  const t = useTranslations('LandingNew.wa');
  return (
    <a
      href="https://wa.me/966550013416"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('label')}
      title={t('label')}
      className="fixed bottom-6 start-6 z-40 w-14 h-14 rounded-full bg-success text-white flex items-center justify-center shadow-xl shadow-success/30 transition-transform hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7" aria-hidden="true"><path d={WA_PATH} /></svg>
    </a>
  );
}
