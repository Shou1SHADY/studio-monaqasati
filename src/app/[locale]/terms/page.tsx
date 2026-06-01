import React from 'react';
import { ArrowRight, Scale } from 'lucide-react';
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
  const t = await getTranslations({ locale, namespace: 'Terms' });
  return buildPageMetadata({
    locale,
    title: t('title'),
    description: t('intro').replace(/<[^>]*>/g, '').substring(0, 155),
    path: '/terms',
  });
}

export default function TermsAndConditions() {
  const t = useTranslations("Terms");

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
            <Scale size={32} />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight mb-2">{t("title")}</h1>
            <p className="text-slate-400 font-medium">{t("last_updated")} {new Date().toLocaleDateString('en-GB')}</p>
          </div>
        </div>

        <div className="prose prose-invert prose-lg max-w-none prose-headings:text-sky-400 prose-a:text-cta hover:prose-a:text-sky-300 text-start">
          <p dangerouslySetInnerHTML={{ __html: t.raw("intro") }}></p>
          
          <h3>{t("sec1_title")}</h3>
          <p>{t("sec1_desc")}</p>

          <h3>{t("sec2_title")}</h3>
          <ul>
            <li>{t("sec2_list_1")}</li>
            <li>{t("sec2_list_2")}</li>
            <li>{t("sec2_list_3")}</li>
          </ul>

          <h3>{t("sec3_title")}</h3>
          <p>{t("sec3_desc")}</p>

          <h3>{t("sec4_title")}</h3>
          <p>{t("sec4_desc")}</p>

          <h3>{t("sec5_title")}</h3>
          <p>{t("sec5_desc")}</p>

          <h3>{t("sec6_title")}</h3>
          <p>{t("sec6_desc")}</p>
        </div>
      </div>
    </div>
  );
}
