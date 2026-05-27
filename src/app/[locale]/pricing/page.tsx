import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

export default function Pricing() {
  const t = useTranslations("Pricing");

  return (
    <div className="min-h-screen bg-[#020617] text-white font-body py-24 rtl:dir-rtl ltr:dir-ltr">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between mb-12">
          <Link href="/" className="inline-flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors group">
            <ArrowRight size={20} className="group-hover:-translate-x-1 transition-transform rtl:rotate-0 ltr:rotate-180" /> {t("back_to_home")}
          </Link>
          <LanguageSwitcher />
        </div>
        
        <div className="text-center mb-20">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-6">{t("title")}</h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">{t("subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Free Tier */}
          <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col">
            <h3 className="text-2xl font-bold mb-2">{t("free_tier")}</h3>
            <p className="text-slate-400 text-sm mb-6">{t("free_tier_desc")}</p>
            <div className="mb-8">
              <span className="text-5xl font-black">{t("free")}</span>
            </div>
            <ul className="space-y-4 mb-10 flex-1">
              {t.raw("free_features").map((feature: string) => (
                <li key={feature} className="flex items-center gap-3 text-slate-300">
                  <CheckCircle2 size={18} className="text-sky-400 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link href="/register" className="w-full h-12 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl flex items-center justify-center transition-colors">
              {t("register_free")}
            </Link>
          </div>

          {/* Growth Tier */}
          <div className="bg-cta border border-sky-400 rounded-3xl p-8 flex flex-col relative transform md:-translate-y-4 shadow-2xl shadow-cta/20">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sky-400 text-primary px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest whitespace-nowrap">
              {t("most_popular")}
            </div>
            <h3 className="text-2xl font-bold mb-2 text-white">{t("growth_tier")}</h3>
            <p className="text-sky-100 text-sm mb-6">{t("growth_tier_desc")}</p>
            <div className="mb-8">
              <span className="text-5xl font-black text-white">{t("contact_us")}</span>
            </div>
            <ul className="space-y-4 mb-10 flex-1">
              {t.raw("growth_features").map((feature: string) => (
                <li key={feature} className="flex items-center gap-3 text-white">
                  <CheckCircle2 size={18} className="text-sky-300 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link href="/contact" className="w-full h-12 bg-white text-primary hover:bg-sky-50 font-black rounded-xl flex items-center justify-center transition-colors">
              {t("request_quote")}
            </Link>
          </div>

          {/* Enterprise Tier */}
          <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col">
            <h3 className="text-2xl font-bold mb-2">{t("enterprise_tier")}</h3>
            <p className="text-slate-400 text-sm mb-6">{t("enterprise_tier_desc")}</p>
            <div className="mb-8">
              <span className="text-5xl font-black">{t("custom")}</span>
            </div>
            <ul className="space-y-4 mb-10 flex-1">
              {t.raw("enterprise_features").map((feature: string) => (
                <li key={feature} className="flex items-center gap-3 text-slate-300">
                  <CheckCircle2 size={18} className="text-sky-400 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link href="/contact" className="w-full h-12 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl flex items-center justify-center transition-colors">
              {t("contact_sales")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
