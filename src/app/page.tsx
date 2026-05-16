"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Building2, ShoppingCart, ArrowLeft, CheckCircle2, FileCheck,
  MapPin, Phone, Mail, Zap, ShieldCheck, Users, BarChart3,
  ChevronRight, Globe, ArrowRight, Truck, Star, TrendingUp,
  LayoutDashboard, Search, FileText, CheckCircle
} from 'lucide-react';

const heroSlides = [
  {
    img: '/images/warehouse-desk.jpg',
    badge: 'منصة المورد الذكية',
    title: 'أتمتة المشتريات',
    titleAccent: 'بذكاء وشفافية مطلقة',
    sub: 'المنصة السعودية الرائدة التي تجمع المقاولين والموردين في نظام بيئي رقمي موحد، لضمان الكفاءة وتقليل التكاليف وتسريع عمليات التوريد.',
  },
  {
    img: '/images/construction-site.jpg',
    badge: 'لقطاع البناء والتشييد',
    title: 'تبني الشراكات',
    titleAccent: 'وتطور التوريد',
    sub: 'حلول رقمية متكاملة لقطاع البناء والتشييد تضمن الشفافية والعدالة في المنافسة، مع تتبع دقيق لكل خطوة في عملية الشراء.',
  },
  {
    img: '/images/loading-dock.jpg',
    badge: 'شبكة موردين معتمدة',
    title: 'شراكات تجارية',
    titleAccent: 'بثقة واحترافية',
    sub: 'تواصل مباشر وسريع بين كبار المقاولين والموردين المعتمدين في المملكة، مع إدارة رقمية كاملة لطلبات الشراء وعروض الأسعار.',
  },
];

export default function Home() {
  const [activeFlow, setActiveFlow] = useState<'contractor' | 'supplier'>('contractor');
  const [slide, setSlide] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    const t = setInterval(() => setSlide(s => (s + 1) % heroSlides.length), 6000);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearInterval(t);
    };
  }, []);

  const contractorSteps = [
    { step: "01", title: "طرح الطلب", desc: "تحديد الكميات والمواصفات بدقة في دقائق.", icon: FileText },
    { step: "02", title: "استقبال العروض", desc: "وصول عروض تنافسية فورية من الموردين.", icon: Search },
    { step: "03", title: "المفاضلة والتعميد", desc: "المقارنة الذكية والاعتماد بضغطة زر.", icon: ShieldCheck },
    { step: "04", title: "التوريد والدفع", desc: "متابعة التوريد وضمان الاستلام والتحصيل.", icon: Truck }
  ];

  const supplierSteps = [
    { step: "01", title: "استقبال الطلبات", desc: "إشعارات فورية بالمناقصات المطابقة لنشاطك.", icon: Zap },
    { step: "02", title: "تقديم العرض", desc: "إرسال عروض أسعار احترافية متكاملة.", icon: FileCheck },
    { step: "03", title: "التفاوض والاعتماد", desc: "تواصل مباشر مع المقاولين واعتماد رقمي.", icon: CheckCircle },
    { step: "04", title: "التسليم والتحصيل", desc: "تسليم المواد وتحصيل الدفعات بانتظام.", icon: BarChart3 }
  ];

  const activeSteps = activeFlow === 'contractor' ? contractorSteps : supplierSteps;

  return (
    <div className="min-h-screen bg-[#020617] flex flex-col font-body text-right overflow-x-hidden selection:bg-cta/30" dir="rtl">

      {/* Premium Navigation - Aligned with App Primary Navy & CTA Blue */}
      <nav className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-500 ${scrolled ? 'bg-[#0F172A]/80 backdrop-blur-xl border-b border-white/5 py-3' : 'bg-transparent py-5'}`}>
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="w-10 h-10 bg-cta rounded-xl flex items-center justify-center font-bold text-xl text-white transition-transform group-hover:scale-110 shadow-lg shadow-cta/20">م</div>
            <div className="flex flex-col">
              <span className="text-xl font-bold text-white tracking-tight leading-none">مدماك تيك</span>
              <span className="text-[10px] text-sky-400/80 font-bold uppercase tracking-widest mt-1">Mdmak Tech</span>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-10 text-slate-400 font-bold text-sm tracking-wide">
            <Link href="#features" className="hover:text-white transition-colors relative group">
              المميزات
              <span className="absolute -bottom-1 right-0 w-0 h-0.5 bg-cta transition-all group-hover:w-full" />
            </Link>
            <Link href="#how" className="hover:text-white transition-colors relative group">
              كيف نعمل
              <span className="absolute -bottom-1 right-0 w-0 h-0.5 bg-cta transition-all group-hover:w-full" />
            </Link>
            <Link href="/register?role=Supplier" className="hover:text-white transition-colors relative group">
              بوابة الموردين
              <span className="absolute -bottom-1 right-0 w-0 h-0.5 bg-cta transition-all group-hover:w-full" />
            </Link>
            <Link href="/register?role=Contractor" className="hover:text-white transition-colors relative group">
              بوابة المقاولين
              <span className="absolute -bottom-1 right-0 w-0 h-0.5 bg-cta transition-all group-hover:w-full" />
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost" className="text-slate-300 hover:text-white font-bold text-sm px-5 h-11 hover:bg-white/5 transition-all">دخول</Button>
            </Link>
            <Link href="/register">
              <Button className="font-bold bg-white text-primary hover:bg-cta hover:text-white px-8 rounded-xl h-11 text-sm transition-all shadow-xl shadow-white/5 border-none">ابدأ مجاناً</Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="relative">

        {/* HERO - Full bleed architectural design */}
        <section className="relative h-screen min-h-[800px] overflow-hidden flex items-center">
          {/* Slides */}
          {heroSlides.map((s, i) => (
            <div key={i} className={`absolute inset-0 transition-all duration-[1500ms] ease-in-out ${i === slide ? 'opacity-100 scale-100' : 'opacity-0 scale-110'}`}>
              <img src={s.img} alt={s.title} className="w-full h-full object-cover object-center" />
              <div className="absolute inset-0 bg-gradient-to-l from-[#020617] via-[#020617]/70 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-[#020617]/30" />
            </div>
          ))}

          {/* Decorative Mesh */}
          <div className="absolute inset-0 z-[5] opacity-20 pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>

          <div className="relative z-10 w-full max-w-7xl mx-auto px-6">
            <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-right-10 duration-1000">
              <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-cta/10 border border-cta/20 backdrop-blur-md text-sky-400 text-xs font-black uppercase tracking-[0.2em] shadow-lg shadow-cta/10">
                <div className="w-2 h-2 rounded-full bg-cta animate-pulse" />
                {heroSlides[slide].badge}
              </div>

              <h1 className="text-5xl md:text-7xl font-bold text-white leading-[1.1] tracking-tight">
                {heroSlides[slide].title}<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-200">
                  {heroSlides[slide].titleAccent}
                </span>
              </h1>

              <p className="text-slate-300 text-xl leading-relaxed font-medium max-w-xl">
                {heroSlides[slide].sub}
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-6 pt-4">
                <Link href="/register" className="w-full sm:w-auto">
                  <Button className="w-full h-16 px-10 text-lg font-black rounded-2xl bg-cta hover:bg-sky-600 text-white gap-3 transition-all hover:scale-105 shadow-2xl shadow-cta/30 border-none">
                    سجل الآن مجاناً <ArrowLeft size={20} />
                  </Button>
                </Link>
                <div className="flex items-center gap-4 group cursor-pointer py-2">
                  <div className="flex -space-x-3 rtl:space-x-reverse">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="w-10 h-10 rounded-full border-2 border-[#020617] bg-slate-800 overflow-hidden shadow-xl">
                        <img src={`https://i.pravatar.cc/100?img=${i + 20}`} alt="" />
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-white font-black text-sm tracking-tight">+500 شركة</span>
                    <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">تعتمد علينا يومياً</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Side Progress Bar */}
          <div className="absolute right-10 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-8 items-center hidden md:flex">
            {heroSlides.map((_, i) => (
              <button key={i} onClick={() => setSlide(i)}
                className={`group flex items-center gap-4 transition-all ${i === slide ? 'text-sky-400' : 'text-slate-500'}`}>
                <span className={`text-[10px] font-black uppercase tracking-widest transition-opacity ${i === slide ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>0{i + 1}</span>
                <div className={`h-12 w-[2px] transition-all duration-500 ${i === slide ? 'bg-cta h-16' : 'bg-white/10 group-hover:bg-white/30'}`} />
              </button>
            ))}
          </div>

          {/* Bottom Floating Stats */}
          <div className="absolute bottom-10 left-6 right-6 z-20">
            <div className="max-w-7xl mx-auto">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { val: '+500', label: 'شركة مسجلة', icon: Building2 },
                  { val: '+2000', label: 'مناقصة منجزة', icon: FileCheck },
                  { val: '70%', label: 'توفير في الوقت', icon: Zap },
                  { val: '15%', label: 'توفير في التكاليف', icon: TrendingUp },
                ].map((s, i) => (
                  <div key={i} className="bg-white/[0.03] backdrop-blur-md border border-white/5 rounded-2xl p-6 flex items-center gap-5 group hover:bg-white/[0.06] transition-all">
                    <div className="w-12 h-12 rounded-xl bg-cta/10 flex items-center justify-center text-sky-400 group-hover:scale-110 transition-transform">
                      <s.icon size={24} />
                    </div>
                    <div>
                      <div className="text-2xl font-black text-white leading-none">{s.val}</div>
                      <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-2">{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES - Dark depth architecture with Blue app colors */}
        <section id="features" className="py-32 relative bg-[#0F172A]">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cta/30 to-transparent" />
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-20">
              <div className="space-y-4">
                <div className="text-sky-400 font-black text-xs uppercase tracking-[0.3em]">التحول الرقمي الكامل</div>
                <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight">قوة مدماك تيك <br /> في أتمتة مشترياتك</h2>
              </div>
              <p className="text-slate-400 max-w-md text-lg leading-relaxed border-r-2 border-cta/30 pr-6">
                كل ما تحتاجه لإدارة مشترياتك الإنشائية في مكان واحد، مع نظام ذكي يضمن الدقة والشفافية.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { title: "شفافية المناقصات", desc: "نظام إلكتروني يضمن عدالة المنافسة وشفافية العروض لجميع الأطراف والحد من التلاعب.", icon: ShieldCheck, color: "cta" },
                { title: "سرعة التنفيذ", desc: "تقليل الوقت المستغرق في طلب المواد والمفاضلة بين الموردين بنسبة تصل إلى 70%.", icon: Zap, color: "blue" },
                { title: "تحليلات متقدمة", desc: "تقارير ذكية حول الأسعار، الجودة، والتزام الموردين بالمواعيد لاتخاذ قرارات أدق.", icon: BarChart3, color: "purple" }
              ].map((f, i) => (
                <div key={i} className="p-10 rounded-[2.5rem] bg-white/[0.02] border border-white/5 hover:border-cta/30 transition-all group hover:-translate-y-2 duration-500 relative overflow-hidden">
                  <div className="absolute -top-10 -left-10 w-32 h-32 bg-cta/5 rounded-full blur-3xl group-hover:bg-cta/10 transition-all" />
                  <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-sky-400 mb-8 group-hover:bg-cta group-hover:text-white transition-all duration-500 shadow-xl">
                    <f.icon size={28} />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-4 group-hover:text-sky-400 transition-colors">{f.title}</h3>
                  <p className="text-slate-400 text-base leading-relaxed">{f.desc}</p>
                  <div className="mt-8 flex items-center gap-2 text-sky-400 text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                    تعرف على المزيد <ArrowLeft size={14} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CONTRACTOR EXPERIENCE - Premium Visual Split */}
        <section className="relative overflow-hidden border-y border-white/5 bg-[#020617]">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-stretch min-h-[700px]">
            <div className="relative overflow-hidden group">
              <img src="/images/warehouse-standing.jpg" alt="Contractor" className="w-full h-full object-cover transition-transform duration-[3000ms] group-hover:scale-110" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#020617]" />
              <div className="absolute inset-0 bg-cta/10 mix-blend-overlay" />

              <div className="absolute bottom-12 right-12 p-8 bg-white/5 backdrop-blur-2xl rounded-[2rem] border border-white/10 shadow-2xl animate-float">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-cta flex items-center justify-center text-white">
                    <TrendingUp size={20} />
                  </div>
                  <div className="text-[10px] font-black text-sky-400 uppercase tracking-widest">تحسين الأداء</div>
                </div>
                <div className="text-5xl font-black text-white leading-none">15%</div>
                <div className="text-slate-400 text-sm mt-3 font-medium">توفير حقيقي في <br /> ميزانية المشتريات</div>
              </div>
            </div>

            <div className="flex items-center px-10 lg:px-24 py-24 relative bg-[#0F172A]/50">
              <div className="space-y-10 max-w-xl">
                <div className="inline-flex items-center gap-3 text-sky-400 font-black text-xs uppercase tracking-[0.4em]">
                  <div className="w-10 h-0.5 bg-cta" /> للمقاولين
                </div>
                <h2 className="text-4xl md:text-6xl font-bold text-white leading-tight tracking-tight">
                  تحكم كامل بمشتريات <br /> <span className="text-sky-400">مشاريعك الإنشائية</span>
                </h2>
                <p className="text-slate-400 text-xl leading-relaxed">أتمتة كاملة لدورة المشتريات بدءاً من طرح المناقصات ومروراً بالمفاضلة الذكية بين عروض الموردين وحتى اعتماد الدفعات واستلام المواد بضغطة زر.</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {["شبكة موردين معتمدة", "مفاضلة أسعار آلية", "توفير التكاليف والوقت", "تقارير وتحليلات لحظية"].map((item, i) => (
                    <div key={i} className="flex items-center gap-4 text-slate-300 text-sm font-bold bg-white/5 p-5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all">
                      <CheckCircle2 size={20} className="text-sky-400 shrink-0" /> {item}
                    </div>
                  ))}
                </div>

                <div className="pt-6">
                  <Link href="/register?role=Contractor">
                    <Button className="h-16 px-12 text-lg font-black rounded-2xl bg-cta hover:bg-sky-600 text-white shadow-2xl shadow-cta/20 border-none transition-all hover:scale-105">
                      سجل كمقاول الآن
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SUPPLIER EXPERIENCE - Symmetric Reverse */}
        <section className="relative overflow-hidden bg-[#020617]">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-stretch min-h-[700px]">
            <div className="flex items-center px-10 lg:px-24 py-24 relative order-2 lg:order-1 bg-[#0F172A]/30">
              <div className="space-y-10 max-w-xl">
                <div className="inline-flex items-center gap-3 text-sky-400 font-black text-xs uppercase tracking-[0.4em]">
                  <div className="w-10 h-0.5 bg-sky-400" /> للموردين
                </div>
                <h2 className="text-4xl md:text-6xl font-bold text-white leading-tight tracking-tight">
                  وسع قاعدة عملائك <br /> <span className="text-sky-400">وزد مبيعاتك رقمياً</span>
                </h2>
                <p className="text-slate-400 text-xl leading-relaxed">تلقى طلبات الشراء المباشرة من كبار المقاولين في المملكة. نظامنا يضمن لك وصولاً أسرع لفرص البيع وإدارة أسهل لعروض الأسعار.</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {["وصول لمشاريع كبرى", "إدارة عروض رقمية", "تتبع الدفعات والتوريد", "نظام تقييم معتمد"].map((item, i) => (
                    <div key={i} className="flex items-center gap-4 text-slate-300 text-sm font-bold bg-white/5 p-5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all">
                      <CheckCircle2 size={20} className="text-sky-400 shrink-0" /> {item}
                    </div>
                  ))}
                </div>

                <div className="pt-6">
                  <Link href="/register?role=Supplier">
                    <Button className="h-16 px-12 text-lg font-black rounded-2xl bg-sky-600 hover:bg-sky-500 text-white shadow-2xl shadow-sky-500/20 border-none transition-all hover:scale-105">
                      سجل كمورد الآن
                    </Button>
                  </Link>
                </div>
              </div>
            </div>

            <div className="relative overflow-hidden group order-1 lg:order-2">
              <img src="/images/supplier-dashboard.jpg" alt="Supplier" className="w-full h-full object-cover transition-transform duration-[3000ms] group-hover:scale-110" />
              <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-[#020617]" />
              <div className="absolute inset-0 bg-sky-500/10 mix-blend-overlay" />

              <div className="absolute top-12 left-12 p-8 bg-white/5 backdrop-blur-2xl rounded-[2rem] border border-white/10 shadow-2xl animate-float">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center text-white">
                    <LayoutDashboard size={20} />
                  </div>
                  <div className="text-[10px] font-black text-sky-400 uppercase tracking-widest">طلبات اليوم</div>
                </div>
                <div className="text-5xl font-black text-white leading-none">24</div>
                <div className="text-slate-400 text-sm mt-3 font-medium">طلب شراء مباشر <br /> قيد الانتظار</div>
              </div>
            </div>
          </div>
        </section>

        {/* IMAGE GALLERY STRIP - Infinite Motion */}
        <section className="py-12 bg-white/[0.01] overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-r from-[#020617] via-transparent to-[#020617] z-10 pointer-events-none" />
          <div className="flex gap-6 animate-scroll-x py-4">
            {[
              '/images/warehouse-desk.jpg', '/images/warehouse-standing.jpg', '/images/construction-site.jpg', '/images/loading-dock.jpg', '/images/supplier-dashboard.jpg',
              '/images/warehouse-desk.jpg', '/images/warehouse-standing.jpg', '/images/construction-site.jpg', '/images/loading-dock.jpg', '/images/supplier-dashboard.jpg'
            ].map((src, i) => (
              <div key={i} className="shrink-0 w-96 h-60 rounded-3xl overflow-hidden border border-white/5 shadow-2xl group relative">
                <img src={src} alt="" className="w-full h-full object-cover grayscale-[0.5] group-hover:grayscale-0 transition-all duration-700 group-hover:scale-110" />
                <div className="absolute inset-0 bg-cta/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS - Step Architecture */}
        <section id="how" className="py-32 relative bg-[#0F172A]">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-20 space-y-4">
              <div className="text-sky-400 font-black text-xs uppercase tracking-[0.4em]">منهجية العمل</div>
              <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">كيف تعمل المنصة؟</h2>
              <p className="text-slate-400 max-w-xl mx-auto text-lg leading-relaxed">خطوات بسيطة وواضحة لتحويل مشترياتك التقليدية إلى منظومة رقمية ذكية</p>
            </div>

            <div className="flex justify-center mb-16">
              <div className="bg-white/5 p-1.5 rounded-2xl inline-flex border border-white/10 relative overflow-hidden group">
                <div className={`absolute inset-y-1.5 w-[calc(50%-6px)] bg-cta rounded-xl transition-all duration-500 ease-out z-0 ${activeFlow === 'contractor' ? 'translate-x-0' : '-translate-x-[100%]'}`} />
                <button onClick={() => setActiveFlow('contractor')}
                  className={`relative z-10 px-10 py-3.5 text-sm font-black rounded-xl transition-all duration-300 ${activeFlow === 'contractor' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>
                  المقاولين
                </button>
                <button onClick={() => setActiveFlow('supplier')}
                  className={`relative z-10 px-10 py-3.5 text-sm font-black rounded-xl transition-all duration-300 ${activeFlow === 'supplier' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>
                  الموردين
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 lg:gap-12 relative" key={activeFlow}>
              {activeSteps.map((s, i) => (
                <div key={i} className="flex flex-col items-center text-center space-y-6 group relative">
                  {i < 3 && (
                    <div className="hidden md:block absolute top-10 -left-1/2 w-full h-[2px] bg-gradient-to-r from-transparent via-white/5 to-transparent z-0" />
                  )}
                  <div className="w-20 h-20 rounded-[2.5rem] bg-white/[0.02] border border-white/5 flex items-center justify-center text-slate-300 relative group-hover:bg-cta group-hover:border-cta group-hover:text-white transition-all duration-500 z-10 shadow-xl group-hover:scale-110">
                    <s.icon size={36} />
                    <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-cta text-white text-xs font-black flex items-center justify-center border-4 border-[#0F172A]">{s.step}</div>
                  </div>
                  <div className="space-y-3 z-10">
                    <h4 className="text-xl font-bold text-white group-hover:text-sky-400 transition-colors">{s.title}</h4>
                    <p className="text-slate-400 text-sm leading-relaxed px-4">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PARTNERSHIP HIGHLIGHT - Depth Image */}
        <section className="relative py-40 overflow-hidden border-t border-white/5">
          <img src="/images/loading-dock.jpg" alt="Partnership" className="absolute inset-0 w-full h-full object-cover grayscale opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#020617] via-transparent to-[#020617]" />

          <div className="relative z-10 max-w-4xl mx-auto px-6 text-center space-y-8">
            <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-cta/10 border border-cta/20 text-sky-400 text-xs font-black uppercase tracking-[0.4em]">
              بيئة عمل موثوقة
            </div>
            <h2 className="text-4xl md:text-6xl font-bold text-white tracking-tight leading-tight">
              أكبر شبكة للمقاولين والموردين <br /> <span className="text-sky-400">في مكان واحد</span>
            </h2>
            <p className="text-slate-400 text-xl leading-relaxed font-medium">
              نربط كبار المقاولين بأفضل الموردين المعتمدين لضمان جودة التوريد والالتزام بالمواصفات، مع نظام تقييم ذكي يضمن احترافية التعامل.
            </p>
            <div className="pt-4">
              <Button variant="outline" className="h-16 px-12 text-lg font-black rounded-2xl border-white/10 text-white hover:bg-white/5 transition-all">
                تعرف على شركائنا
              </Button>
            </div>
          </div>
        </section>

        {/* CTA - Final Impact */}
        <section className="py-32 relative bg-[#020617]">
          <div className="max-w-6xl mx-auto px-6">
            <div className="rounded-[4rem] bg-gradient-to-br from-cta/20 via-sky-500/5 to-transparent border border-white/10 p-12 md:p-24 text-center space-y-10 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-96 h-96 bg-cta/10 rounded-full blur-[120px] group-hover:bg-cta/20 transition-all duration-1000" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-sky-500/10 rounded-full blur-[100px]" />

              <h2 className="text-4xl md:text-7xl font-bold text-white relative z-10 leading-tight">
                ابدأ رحلة التحول الرقمي <br /> <span className="text-sky-400">في مشترياتك اليوم</span>
              </h2>
              <p className="text-slate-300 max-w-2xl mx-auto text-xl relative z-10 leading-relaxed font-medium">
                انضم إلى مئات الشركات السعودية التي تعتمد على مدماك تيك في رفع كفاءة سلاسل الإمداد وتوفير التكاليف التشغيلية.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-6 relative z-10 pt-6">
                <Link href="/register" className="w-full sm:w-auto">
                  <Button className="w-full h-18 px-14 text-xl font-black rounded-[2rem] bg-white text-primary hover:bg-cta hover:text-white transition-all hover:scale-105 shadow-2xl shadow-white/5 border-none">
                    ابدأ الآن مجاناً
                  </Button>
                </Link>
                <Link href="#how" className="w-full sm:w-auto">
                  <Button variant="outline" className="w-full h-18 px-14 text-xl font-black rounded-[2rem] border-white/10 text-white hover:bg-white/5 backdrop-blur-md transition-all">
                    تواصل معنا
                  </Button>
                </Link>
              </div>

              <div className="pt-10 flex items-center justify-center gap-10 text-[10px] font-black text-slate-500 uppercase tracking-[0.4em] relative z-10">
                <span className="flex items-center gap-2"><CheckCircle size={14} className="text-sky-400" /> إعداد سريع</span>
                <span className="flex items-center gap-2"><CheckCircle size={14} className="text-sky-400" /> بدون رسوم تسجيل</span>
                <span className="flex items-center gap-2"><CheckCircle size={14} className="text-sky-400" /> رؤية 2030</span>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* FOOTER - Refined Structure */}
      <footer className="bg-[#020617] border-t border-white/5 py-24 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-20 mb-20 relative z-10">
          <div className="col-span-1 md:col-span-2 space-y-10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-cta text-white rounded-2xl flex items-center justify-center font-bold text-2xl shadow-lg shadow-cta/20">م</div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-white leading-none">مدماك تيك</span>
                <span className="text-xs text-sky-400/70 font-bold uppercase tracking-widest mt-1">Mdmak Tech</span>
              </div>
            </div>
            <p className="text-slate-500 text-lg leading-relaxed max-w-sm font-medium">
              المنصة التقنية السعودية الرائدة لتحويل قطاع المشتريات الإنشائية إلى منظومة رقمية ذكية متكاملة تواكب تطلعات رؤية المملكة 2030.
            </p>
            <div className="flex items-center gap-4">
              {[Globe, Phone, Mail].map((Icon, idx) => (
                <Link key={idx} href="#" className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-slate-400 hover:text-sky-400 hover:bg-white/10 transition-all hover:-translate-y-1">
                  <Icon size={20} />
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-8">
            <h4 className="text-white font-black text-xs uppercase tracking-[0.3em]">الروابط السريعة</h4>
            <ul className="space-y-5 text-base text-slate-500 font-bold">
              {["عن المنصة", "المميزات", "بوابة الموردين", "حلول المقاولين", "الأسئلة الشائعة"].map(l => (
                <li key={l}><Link href="#" className="hover:text-sky-400 transition-colors flex items-center gap-2 group">
                  <div className="w-0 h-px bg-cta transition-all group-hover:w-4" /> {l}
                </Link></li>
              ))}
            </ul>
          </div>

          <div className="space-y-8">
            <h4 className="text-white font-black text-xs uppercase tracking-[0.3em]">القانونية والاتصال</h4>
            <ul className="space-y-5 text-base text-slate-500 font-bold">
              {["سياسة الخصوصية", "الشروط والأحكام", "سياسة الكوكيز", "مركز المساعدة", "اتصل بنا"].map(l => (
                <li key={l}><Link href="#" className="hover:text-sky-400 transition-colors flex items-center gap-2 group">
                  <div className="w-0 h-px bg-cta transition-all group-hover:w-4" /> {l}
                </Link></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 pt-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-8 text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] relative z-10">
          <p>© {new Date().getFullYear()} MDMAK TECH PLATFORM - ALL RIGHTS RESERVED</p>
          <div className="flex items-center gap-10">
            <span className="flex items-center gap-2 text-slate-400"><Globe size={14} /> العربية</span>
            <span>بكل فخر في المملكة العربية السعودية 🇸🇦</span>
          </div>
        </div>

        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-cta/5 rounded-full blur-[100px] pointer-events-none" />
      </footer>

      <style jsx global>{`
        @keyframes scroll-x {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-scroll-x {
          animation: scroll-x 40s linear infinite;
          width: max-content;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        html { scroll-behavior: smooth; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #020617; }
        ::-webkit-scrollbar-thumb { background: #1A1D26; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #2A2D36; }
      `}</style>
    </div>
  );
}
