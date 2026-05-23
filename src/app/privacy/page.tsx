import React from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#020617] text-white font-body py-24" dir="rtl">
      <div className="max-w-4xl mx-auto px-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors mb-12">
          <ArrowRight size={20} /> العودة للرئيسية
        </Link>
        
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 bg-cta/10 rounded-2xl flex items-center justify-center text-sky-400">
            <ShieldCheck size={32} />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight mb-2">سياسة الخصوصية</h1>
            <p className="text-slate-400 font-medium">آخر تحديث: {new Date().toLocaleDateString('ar-SA')}</p>
          </div>
        </div>

        <div className="prose prose-invert prose-lg max-w-none prose-headings:text-sky-400 prose-a:text-cta hover:prose-a:text-sky-300">
          <p>
            تلتزم شركة <strong>مدماك تيك (Mdmak Tech)</strong> بحماية خصوصيتك وضمان أمان بياناتك الشخصية والتجارية. 
            تم إعداد سياسة الخصوصية هذه لتوضيح كيفية جمعنا واستخدامنا وحمايتنا لمعلوماتك وفقاً لنظام حماية البيانات الشخصية في المملكة العربية السعودية وأفضل الممارسات العالمية.
          </p>
          
          <h3>1. المعلومات التي نجمعها</h3>
          <p>عند استخدامك لمنصة مدماك، نقوم بجمع الأنواع التالية من المعلومات:</p>
          <ul>
            <li><strong>المعلومات الأساسية:</strong> الاسم، البريد الإلكتروني، المسمى الوظيفي، ورقم التواصل السجل التجاري (CR).</li>
            <li><strong>بيانات الشركة:</strong> معلومات الشركة، السجل التجاري، تفاصيل المشتريات، وبيانات العطاءات والمناقصات.</li>
            <li><strong>البيانات التقنية:</strong> عنوان بروتوكول الإنترنت (IP)، نوع المتصفح، ومعلومات الجهاز المستخدم للوصول إلى المنصة.</li>
          </ul>

          <h3>2. كيف نستخدم معلوماتك</h3>
          <p>نستخدم بياناتك للأغراض التالية:</p>
          <ul>
            <li>تقديم وتشغيل وصيانة منصة مدماك لتسهيل عمليات المشتريات الإنشائية.</li>
            <li>تحسين تجربة المستخدم وتطوير ميزات جديدة تلبي احتياجات قطاع المقاولات.</li>
            <li>التواصل معك بخصوص التحديثات، التنبيهات الأمنية، والدعم الفني.</li>
            <li>الامتثال للمتطلبات القانونية والتنظيمية في المملكة العربية السعودية.</li>
          </ul>

          <h3>3. مشاركة وحماية البيانات</h3>
          <p>
            نحن لا نبيع بياناتك الشخصية لأي أطراف ثالثة. يتم مشاركة البيانات المتعلقة بالمناقصات فقط بين الأطراف المعنية (المقاول والموردين) وفقاً لصلاحيات الوصول المحددة من قبلك.
          </p>
          <p>
            نحن نستخدم بروتوكولات التشفير الرائدة في الصناعة (SSL/TLS) لحماية بياناتك أثناء النقل والتخزين، وتتم استضافة خوادمنا في مراكز بيانات متوافقة مع المتطلبات الأمنية المحلية (مثل متطلبات الهيئة الوطنية للأمن السيبراني NCA).
          </p>

          <h3>4. حقوقك كصاحب بيانات</h3>
          <p>وفقاً للأنظمة المحلية، يحق لك:</p>
          <ul>
            <li>الوصول إلى بياناتك الشخصية والاطلاع عليها.</li>
            <li>طلب تصحيح أو تحديث معلوماتك.</li>
            <li>طلب حذف بياناتك (وفقاً لما تسمح به الأنظمة التجارية).</li>
          </ul>

          <h3>5. تواصل معنا</h3>
          <p>
            إذا كان لديك أي أسئلة حول سياسة الخصوصية أو كيفية معالجة بياناتك، يرجى التواصل مع فريق الخصوصية لدينا عبر:
            <br />
            البريد الإلكتروني: <a href="mailto:info.mdmak@mdmaktech.sa">info.mdmak@mdmaktech.sa</a>
          </p>
        </div>
      </div>
    </div>
  );
}
