"use client";
import React from 'react';
import { ArrowRight, Mail, MapPin } from 'lucide-react';
import Link from 'next/link';

export default function ContactUs() {
  return (
    <div className="min-h-screen bg-[#020617] text-white font-body py-24" dir="rtl">
      <div className="max-w-4xl mx-auto px-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors mb-12">
          <ArrowRight size={20} /> العودة للرئيسية
        </Link>
        
        <div className="mb-12">
          <h1 className="text-4xl font-black tracking-tight mb-4">تواصل معنا</h1>
          <p className="text-slate-400 text-lg">فريق الدعم في مدماك تيك مستعد دائماً لخدمتك والإجابة على كافة استفساراتك.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-8">
            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col gap-4">
              <div className="w-12 h-12 bg-cta/20 text-sky-400 rounded-xl flex items-center justify-center">
                <Mail size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-1">البريد الإلكتروني</h3>
                <p className="text-slate-400 text-sm mb-3">للأسئلة العامة وطلب الانضمام كشريك:</p>
                <a href="mailto:info.mdmak@mdmaktech.sa" className="text-xl font-bold text-sky-400 hover:text-sky-300 transition-colors" dir="ltr">
                  info.mdmak@mdmaktech.sa
                </a>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col gap-4">
              <div className="w-12 h-12 bg-cta/20 text-sky-400 rounded-xl flex items-center justify-center">
                <MapPin size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-1">المقر الرئيسي</h3>
                <p className="text-slate-400 text-sm mb-3">نسعد بزيارتكم:</p>
                <p className="text-lg font-bold">المملكة العربية السعودية<br/>الرياض</p>
              </div>
            </div>
          </div>

          <form className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col gap-6" onSubmit={(e) => e.preventDefault()}>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">الاسم الكريم</label>
              <input type="text" className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-4 text-white focus:outline-none focus:border-sky-400 transition-colors" placeholder="أدخل اسمك" />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">البريد الإلكتروني للعمل</label>
              <input type="email" className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-4 text-white focus:outline-none focus:border-sky-400 transition-colors" placeholder="email@company.com" dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">رسالتك</label>
              <textarea className="w-full h-32 bg-white/5 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-sky-400 transition-colors resize-none" placeholder="كيف يمكننا مساعدتك؟" />
            </div>
            <button type="submit" className="h-12 bg-cta hover:bg-sky-500 text-white font-bold rounded-xl transition-colors">
              إرسال الرسالة
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
