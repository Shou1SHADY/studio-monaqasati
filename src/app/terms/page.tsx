import React from 'react';
import { ArrowRight, Scale } from 'lucide-react';
import Link from 'next/link';

export default function TermsAndConditions() {
  return (
    <div className="min-h-screen bg-[#020617] text-white font-body py-24" dir="rtl">
      <div className="max-w-4xl mx-auto px-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors mb-12">
          <ArrowRight size={20} /> العودة للرئيسية
        </Link>
        
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 bg-cta/10 rounded-2xl flex items-center justify-center text-sky-400">
            <Scale size={32} />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight mb-2">الشروط والأحكام</h1>
            <p className="text-slate-400 font-medium">آخر تحديث: {new Date().toLocaleDateString('ar-SA')}</p>
          </div>
        </div>

        <div className="prose prose-invert prose-lg max-w-none prose-headings:text-sky-400 prose-a:text-cta hover:prose-a:text-sky-300">
          <p>
            مرحباً بك في منصة <strong>مدماك تيك</strong>. يرجى قراءة هذه الشروط بعناية قبل استخدام خدماتنا. 
            يعتبر استخدامك للمنصة موافقة صريحة وملزمة قانوناً على جميع الشروط والأحكام المذكورة أدناه.
          </p>
          
          <h3>1. قبول الشروط</h3>
          <p>
            باستخدامك أو وصولك لمنصة مدماك، فإنك تؤكد أنك مخول نظاماً لتمثيل الشركة أو الكيان التجاري المسجل، وأنك توافق على الامتثال للأنظمة المعمول بها في المملكة العربية السعودية.
          </p>

          <h3>2. الحسابات والمسؤولية</h3>
          <ul>
            <li>يجب على المستخدم تقديم معلومات دقيقة ومحدثة، بما في ذلك رقم السجل التجاري (CR) الصالح.</li>
            <li>أنت مسؤول بالكامل عن الحفاظ على سرية معلومات حسابك وكلمة المرور الخاصة بك.</li>
            <li>لا تتحمل منصة مدماك أي مسؤولية عن أي خسائر تنتج عن الاستخدام غير المصرح به لحسابك.</li>
          </ul>

          <h3>3. استخدام المنصة للمناقصات</h3>
          <p>
            توفر مدماك أداة برمجية كخدمة (SaaS) لتسهيل طلبات عروض الأسعار (RFQs) وعمليات الشراء الإنشائية. 
            لا تعتبر منصة مدماك طرفاً في أي عقد أو اتفاقية تجارية يتم إبرامها بين المقاولين والموردين عبر المنصة.
          </p>

          <h3>4. الرسوم والمدفوعات</h3>
          <p>
            يتم تحديد الرسوم والاشتراكات بناءً على باقة التسعير المختارة. تحتفظ منصة مدماك بالحق في تعديل هيكل التسعير مع تقديم إشعار مسبق مدته 30 يوماً للمشتركين النشطين.
          </p>

          <h3>5. حدود المسؤولية</h3>
          <p>
            تُقدم الخدمة "كما هي" دون أي ضمانات صريحة أو ضمنية. لا تتحمل مدماك أي مسؤولية عن أخطاء التسعير، أو التأخير في التوريد، أو جودة المواد الإنشائية المقدمة من الموردين، حيث تخضع هذه الأمور للاتفاق المباشر بين أطراف المعاملة.
          </p>

          <h3>6. القانون المطبق</h3>
          <p>
            تخضع هذه الشروط والأحكام وتفسر وفقاً لأنظمة المملكة العربية السعودية. أي نزاع ينشأ عن أو يتعلق بهذه الشروط يخضع للاختصاص الحصري للمحاكم السعودية في مدينة الرياض.
          </p>
        </div>
      </div>
    </div>
  );
}
