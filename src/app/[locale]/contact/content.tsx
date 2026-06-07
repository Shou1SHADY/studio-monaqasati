"use client";
import React from 'react';
import { ArrowRight, Mail, MapPin, Phone } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

export default function ContactUs() {
  const t = useTranslations("Contact");

  return (
    <div className="min-h-screen bg-[#020617] text-white font-body py-24 rtl:dir-rtl ltr:dir-ltr">
      <div className="max-w-4xl mx-auto px-6">
        <div className="flex items-center justify-between mb-12">
          <Link href="/" className="inline-flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors group">
            <ArrowRight size={20} className="group-hover:-translate-x-1 transition-transform rtl:rotate-0 ltr:rotate-180" /> {t("back_to_home")}
          </Link>
          <LanguageSwitcher />
        </div>
        
        <div className="mb-12">
          <h1 className="text-4xl font-black tracking-tight mb-4">{t("title")}</h1>
          <p className="text-slate-400 text-lg">{t("subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-8 text-start">
            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col gap-4">
              <div className="w-12 h-12 bg-cta/20 text-sky-400 rounded-xl flex items-center justify-center">
                <Mail size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-1">{t("email_title")}</h3>
                <p className="text-slate-400 text-sm mb-3">{t("email_desc")}</p>
                <a href="mailto:info.mdmak@mdmaktech.sa" className="text-xl font-bold text-sky-400 hover:text-sky-300 transition-colors" dir="ltr">
                  info.mdmak@mdmaktech.sa
                </a>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col gap-4">
              <div className="w-12 h-12 bg-cta/20 text-emerald-400 rounded-xl flex items-center justify-center">
                <Phone size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-1">{t("phone_title")}</h3>
                <p className="text-slate-400 text-sm mb-3">{t("phone_desc")}</p>
                <a href="https://wa.me/966550013416" target="_blank" rel="noopener noreferrer" className="text-xl font-bold text-emerald-400 hover:text-emerald-300 transition-colors" dir="ltr">
                  +966550013416
                </a>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col gap-4">
              <div className="w-12 h-12 bg-cta/20 text-sky-400 rounded-xl flex items-center justify-center">
                <MapPin size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-1">{t("hq_title")}</h3>
                <p className="text-slate-400 text-sm mb-3">{t("hq_desc")}</p>
                <p className="text-lg font-bold" dangerouslySetInnerHTML={{ __html: t.raw("hq_address") }}></p>
              </div>
              
              <div className="mt-2 rounded-xl overflow-hidden border border-white/10 h-[250px] w-full relative group">
                <iframe
                  src="https://maps.google.com/maps?q=Prince%20Sultan%20Ibn%20Abdulaziz%20Road,%20North%20Mathar%20District,%20Riyadh&t=&z=14&ie=UTF8&iwloc=&output=embed"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Google Maps"
                  className="absolute inset-0 grayscale contrast-125 opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500"
                />
              </div>
            </div>
          </div>

          <form className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col gap-6 text-start h-fit" onSubmit={(e) => e.preventDefault()}>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">{t("form_name")}</label>
              <input type="text" className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-4 text-white focus:outline-none focus:border-sky-400 transition-colors" placeholder={t("form_name_ph")} />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">{t("form_email")}</label>
              <input type="email" className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-4 text-white focus:outline-none focus:border-sky-400 transition-colors text-start" placeholder={t("form_email_ph")} dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">{t("form_message")}</label>
              <textarea className="w-full h-32 bg-white/5 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-sky-400 transition-colors resize-none" placeholder={t("form_message_ph")} />
            </div>
            <button type="submit" className="h-12 bg-cta hover:bg-sky-500 text-white font-bold rounded-xl transition-colors">
              {t("submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
