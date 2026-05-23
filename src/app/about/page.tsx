import React from 'react';
import { ArrowRight, Building2 } from 'lucide-react';
import Link from 'next/link';

export default function AboutUs() {
  return (
    <div className="min-h-screen bg-[#020617] text-white font-body py-24" dir="rtl">
      <div className="max-w-4xl mx-auto px-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors mb-12">
          <ArrowRight size={20} /> العودة للرئيسية
        </Link>
        
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 bg-cta/10 rounded-2xl flex items-center justify-center text-sky-400">
            <Building2 size={32} />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight mb-2">عن مدماك تيك</h1>
            <p className="text-slate-400 font-medium">المنصة التقنية السعودية الرائدة</p>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-3xl p-8 mb-12">
          <h2 className="text-2xl font-bold mb-4">هويتنا القانونية</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-slate-300">
            <div>
              <span className="block text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">الاسم التجاري</span>
              <span className="font-bold text-lg">شركة مدماك تيك لتقنية المعلومات</span>
            </div>
            <div>
              <span className="block text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">رقم السجل التجاري (CR)</span>
              <span className="font-bold text-lg text-sky-400">[سيتم إضافته قريباً]</span>
            </div>
          </div>
        </div>

        <div className="prose prose-invert prose-lg max-w-none prose-headings:text-sky-400">
          <h3>رؤيتنا</h3>
          <p>
            تطمح مدماك تيك إلى قيادة التحول الرقمي في قطاع المشتريات الإنشائية في المملكة العربية السعودية، 
            متماشين مع أهداف رؤية المملكة 2030 لتعزيز الكفاءة والشفافية في القطاع الخاص والمقاولات.
          </p>

          <h3>مهمتنا</h3>
          <p>
            توفير منصة سحابية (SaaS) متكاملة تربط بين المقاولين والموردين بشكل سلس، مما يسرّع من عملية طرح المناقصات، 
            وطلب عروض الأسعار (RFQs)، واختيار أفضل العروض بناءً على معايير الجودة والشفافية.
          </p>
        </div>
      </div>
    </div>
  );
}
