import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

export default function Pricing() {
  return (
    <div className="min-h-screen bg-[#020617] text-white font-body py-24" dir="rtl">
      <div className="max-w-6xl mx-auto px-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors mb-12">
          <ArrowRight size={20} /> العودة للرئيسية
        </Link>
        
        <div className="text-center mb-20">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-6">باقات مصممة لنمو أعمالك</h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">اختر الباقة التي تتناسب مع حجم وطبيعة أعمالك. الشفافية التامة بدون رسوم خفية.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Free Tier */}
          <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col">
            <h3 className="text-2xl font-bold mb-2">البداية</h3>
            <p className="text-slate-400 text-sm mb-6">للمقاولين والموردين الجدد</p>
            <div className="mb-8">
              <span className="text-5xl font-black">مجاناً</span>
            </div>
            <ul className="space-y-4 mb-10 flex-1">
              {['طرح حتى 5 مناقصات شهرياً', 'استقبال عروض الأسعار الأساسية', 'حساب مستخدم واحد', 'دعم فني عبر البريد'].map(feature => (
                <li key={feature} className="flex items-center gap-3 text-slate-300">
                  <CheckCircle2 size={18} className="text-sky-400 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link href="/register" className="w-full h-12 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl flex items-center justify-center transition-colors">
              سجل مجاناً
            </Link>
          </div>

          {/* Growth Tier */}
          <div className="bg-cta border border-sky-400 rounded-3xl p-8 flex flex-col relative transform md:-translate-y-4 shadow-2xl shadow-cta/20">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sky-400 text-primary px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest">
              الأكثر طلباً
            </div>
            <h3 className="text-2xl font-bold mb-2 text-white">النمو الاحترافي</h3>
            <p className="text-sky-100 text-sm mb-6">للشركات المتوسطة والنشطة</p>
            <div className="mb-8">
              <span className="text-5xl font-black text-white">تواصل معنا</span>
            </div>
            <ul className="space-y-4 mb-10 flex-1">
              {['عدد لا محدود من المناقصات', 'مقارنة عروض الأسعار الذكية', 'إدارة الموردين المفضلة', 'حتى 5 مستخدمين', 'دعم فني أولوية'].map(feature => (
                <li key={feature} className="flex items-center gap-3 text-white">
                  <CheckCircle2 size={18} className="text-sky-300 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link href="/contact" className="w-full h-12 bg-white text-primary hover:bg-sky-50 font-black rounded-xl flex items-center justify-center transition-colors">
              اطلب عرض سعر
            </Link>
          </div>

          {/* Enterprise Tier */}
          <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col">
            <h3 className="text-2xl font-bold mb-2">المؤسسات الكبرى</h3>
            <p className="text-slate-400 text-sm mb-6">للشركات الضخمة والمشاريع القومية</p>
            <div className="mb-8">
              <span className="text-5xl font-black">مخصصة</span>
            </div>
            <ul className="space-y-4 mb-10 flex-1">
              {['تكامل مع أنظمة ERP', 'مدير حساب مخصص', 'عدد لا محدود من المستخدمين', 'تقارير أداء متقدمة', 'استضافة خاصة (اختياري)'].map(feature => (
                <li key={feature} className="flex items-center gap-3 text-slate-300">
                  <CheckCircle2 size={18} className="text-sky-400 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link href="/contact" className="w-full h-12 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl flex items-center justify-center transition-colors">
              تواصل مع المبيعات
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
