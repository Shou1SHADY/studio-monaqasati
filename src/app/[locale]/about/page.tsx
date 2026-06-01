import React from 'react';
import { ArrowRight, Building2 } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useTranslations } from "next-intl";
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { buildPageMetadata } from '@/lib/seo';
import type { Metadata } from 'next';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'About' });
  return buildPageMetadata({
    locale,
    title: t('title'),
    description: t('subtitle'),
    path: '/about',
  });
}

export default function AboutUs() {
  const t = useTranslations("About");

  return (
    <div className="min-h-screen bg-[#020617] text-white font-body py-24 rtl:dir-rtl ltr:dir-ltr">
      <div className="max-w-4xl mx-auto px-6">
        <div className="flex items-center justify-between mb-12">
          <Link href="/" className="inline-flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors group">
            <ArrowRight size={20} className="group-hover:-translate-x-1 transition-transform rtl:rotate-0 ltr:rotate-180" /> {t("back_to_home")}
          </Link>
          <LanguageSwitcher />
        </div>
        
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 bg-cta/10 rounded-2xl flex items-center justify-center text-sky-400">
            <Building2 size={32} />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight mb-2">{t("title")}</h1>
            <p className="text-slate-400 font-medium">{t("subtitle")}</p>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-3xl p-8 mb-12">
          <h2 className="text-2xl font-bold mb-4">{t("legal_identity")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-slate-300 text-start">
            <div>
              <span className="block text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">{t("trade_name")}</span>
              <span className="font-bold text-lg">{t("company_name")}</span>
            </div>
            <div>
              <span className="block text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">{t("cr_number")}</span>
              <span className="font-bold text-lg text-sky-400">{t("coming_soon")}</span>
            </div>
          </div>
        </div>

        <div className="prose prose-invert prose-lg max-w-none prose-headings:text-sky-400 text-start">
          <h3>{t("vision_title")}</h3>
          <p>{t("vision_desc")}</p>

          <h3>{t("mission_title")}</h3>
          <p>{t("mission_desc")}</p>
        </div>
      </div>
    </div>
  );
}
