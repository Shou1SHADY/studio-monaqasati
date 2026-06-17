import React from 'react';
import { ArrowRight, Building2, CheckCircle2, Star, Shield, Zap } from 'lucide-react';
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

  const values = [
    { icon: Shield, key: 'transparency' as const },
    { icon: Zap, key: 'efficiency' as const },
    { icon: Star, key: 'reliability' as const },
  ] as const;

  const contractorBenefits = [
    t('for_contractors_1'),
    t('for_contractors_2'),
    t('for_contractors_3'),
    t('for_contractors_4'),
  ];

  const supplierBenefits = [
    t('for_suppliers_1'),
    t('for_suppliers_2'),
    t('for_suppliers_3'),
    t('for_suppliers_4'),
  ];

  return (
    <div className="min-h-screen bg-[#020617] text-white font-body py-24">
      <div className="max-w-4xl mx-auto px-6">

        {/* Nav row */}
        <div className="flex items-center justify-between mb-12">
          <Link href="/" className="inline-flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors group">
            <ArrowRight size={20} className="group-hover:-translate-x-1 transition-transform rtl:rotate-0 ltr:rotate-180" />
            {t("back_to_home")}
          </Link>
          <LanguageSwitcher />
        </div>

        {/* Hero / title */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 bg-cta/10 rounded-2xl flex items-center justify-center text-sky-400 shrink-0">
            <Building2 size={32} />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight mb-2">{t("title")}</h1>
            <p className="text-slate-400 font-medium">{t("subtitle")}</p>
          </div>
        </div>

        {/* Who we are */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-sky-400 mb-4">{t("who_we_are")}</h2>
          <p className="text-slate-300 text-lg leading-relaxed mb-4">{t("description")}</p>
          <p className="text-slate-400 italic border-s-2 border-sky-400/40 ps-4">{t("tagline")}</p>
        </section>

        {/* Legal identity */}
        <div className="bg-white/5 border border-white/10 rounded-3xl p-8 mb-12">
          <h2 className="text-2xl font-bold mb-4">{t("legal_identity")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-slate-300">
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

        {/* Vision & Mission */}
        <section className="mb-12 space-y-8">
          <div>
            <h2 className="text-2xl font-bold text-sky-400 mb-3">{t("vision_title")}</h2>
            <p className="text-slate-300 text-lg leading-relaxed">{t("vision_desc")}</p>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-sky-400 mb-3">{t("mission_title")}</h2>
            <p className="text-slate-300 text-lg leading-relaxed">{t("mission_desc")}</p>
          </div>
        </section>

        {/* Values */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6">{t("values_title")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {values.map(({ icon: Icon, key }) => (
              <div key={key} className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <div className="w-10 h-10 bg-sky-400/10 rounded-xl flex items-center justify-center text-sky-400 mb-3">
                  <Icon size={20} />
                </div>
                <h3 className="font-bold text-lg mb-1">{t(`value_${key}`)}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{t(`value_${key}_desc`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* What sets us apart */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6">{t("differentiators_title")}</h2>
          <div className="space-y-4">

            {/* Zero commission */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="font-bold text-lg text-sky-400 mb-2">{t("zero_commission_title")}</h3>
              <p className="text-slate-300 leading-relaxed mb-3">{t("zero_commission_desc")}</p>
              <span className="inline-block bg-sky-400/10 text-sky-300 text-sm font-semibold px-4 py-1.5 rounded-full border border-sky-400/20">
                {t("zero_commission_badge")}
              </span>
            </div>

            {/* Governance */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="font-bold text-lg text-sky-400 mb-2">{t("governance_title")}</h3>
              <p className="text-slate-300 leading-relaxed">{t("governance_desc")}</p>
            </div>

            {/* Vision 2030 */}
            <div className="bg-gradient-to-br from-emerald-900/20 to-teal-900/20 border border-emerald-500/20 rounded-2xl p-6">
              <h3 className="font-bold text-lg text-emerald-400 mb-2">{t("vision2030_title")}</h3>
              <p className="text-slate-300 leading-relaxed mb-3">{t("vision2030_desc")}</p>
              <p className="text-emerald-400/70 text-sm font-medium">{t("vision2030_pillars")}</p>
            </div>
          </div>
        </section>

        {/* For contractors / suppliers */}
        <section>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Contractors */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-bold text-sky-400 mb-4">{t("for_contractors_title")}</h2>
              <ul className="space-y-3">
                {contractorBenefits.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-slate-300">
                    <CheckCircle2 size={18} className="text-sky-400 mt-0.5 shrink-0" />
                    <span className="text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Suppliers */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-bold text-sky-400 mb-4">{t("for_suppliers_title")}</h2>
              <ul className="space-y-3">
                {supplierBenefits.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-slate-300">
                    <CheckCircle2 size={18} className="text-sky-400 mt-0.5 shrink-0" />
                    <span className="text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
