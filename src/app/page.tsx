"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  ShoppingCart,
  ArrowLeft,
  CheckCircle2,
  FileCheck,
  MapPin,
  Phone,
  Mail,
  Zap,
  ShieldCheck,
  Users,
  BarChart3,
  ChevronRight,
  Globe,
  ArrowRight,
  Truck
} from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-white flex flex-col font-body text-right overflow-x-hidden selection:bg-primary/10 selection:text-primary" dir="rtl">

      {/* Premium Digital Grid */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(#0F172A 1px, transparent 1px), linear-gradient(90deg, #0F172A 1px, transparent 1px)`,
          backgroundSize: '100px 100px'
        }}>
      </div>

      {/* Navigation - Ultra Glass */}
      <nav className="w-full bg-white/90 backdrop-blur-md border-b border-slate-100 sticky top-0 z-50 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4 group cursor-pointer">
            <div className="w-10 h-10 bg-[#0F172A] rounded-lg flex items-center justify-center font-bold text-xl text-white transition-transform group-hover:scale-110">
              م
            </div>
            <span className="text-xl font-bold text-[#0F172A] font-headline tracking-tight">مدماك تيك</span>
          </div>

          <div className="hidden md:flex items-center gap-10 text-slate-500 font-semibold text-sm">
            <Link href="#features" className="hover:text-primary transition-all">المميزات</Link>
            <Link href="/register?role=Supplier" className="hover:text-primary transition-all">بوابة الموردين</Link>
            <Link href="/register?role=Contractor" className="hover:text-primary transition-all">بوابة المقاولين</Link>
            <Link href="#about" className="hover:text-primary transition-all">عن المنصة</Link>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" className="font-bold text-slate-600 px-5">
                دخول
              </Button>
            </Link>
            <Link href="/register">
              <Button className="font-bold bg-[#0F172A] hover:bg-[#1E293B] text-white px-7 rounded-lg h-11 transition-all hover:shadow-xl hover:-translate-y-0.5">
                ابدأ مجاناً
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="relative z-10 animate-in fade-in duration-1000">

        {/* Hero Section - Pro Max Refined */}
        <section className="relative pt-16 pb-24 md:pt-32 md:pb-48 overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-20 items-center">

            {/* Text Content */}
            <div className="lg:col-span-7 space-y-10 animate-in slide-in-from-right duration-1000 delay-200">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest">
                <Zap size={14} className="text-primary" />
                مستقبل قطاع المشتريات في المملكة
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-5xl font-bold text-[#0F172A] font-headline leading-[1.3] tracking-tight">
                أتمتة المشتريات <br />
                <span className="text-[#0369A1]">بذكاء وشفافية مطلقة</span>
              </h1>

              <p className="text-lg text-slate-500 leading-relaxed max-w-xl font-medium font-body">
                المنصة السعودية الرائدة التي تجمع المقاولين والموردين في نظام بيئي رقمي موحد، لضمان الكفاءة، تقليل التكاليف، وتسريع عمليات التوريد.
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-5 pt-4">
                <Link href="/register" className="w-full sm:w-auto">
                  <Button className="w-full sm:w-auto h-16 px-10 text-lg font-bold rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white shadow-2xl shadow-indigo-500/10 gap-3 transition-all hover:scale-[1.02]">
                    سجل الآن مجاناً
                    <ArrowLeft size={20} />
                  </Button>
                </Link>
                <div className="flex items-center gap-4 py-2 opacity-80 hover:opacity-100 transition-opacity">
                  <div className="flex -space-x-2 rtl:space-x-reverse">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="w-9 h-9 rounded-full border-2 border-white bg-slate-200 overflow-hidden">
                        <img src={`https://i.pravatar.cc/100?img=${i + 50}`} alt="User" />
                      </div>
                    ))}
                  </div>
                  <div className="text-xs font-bold text-slate-400">
                    أكثر من <span className="text-[#0F172A] font-black">+500</span> شركة مسجلة
                  </div>
                </div>
              </div>
            </div>

            {/* Visual Part - Premium Glass */}
            <div className="lg:col-span-5 relative animate-in zoom-in duration-1000 delay-300">
              <div className="relative rounded-[2.5rem] overflow-hidden shadow-[0_40px_100px_-20px_rgba(0,0,0,0.15)] border-4 border-white bg-slate-50 group">
                <img
                  src="/images/hero-modern.png"
                  alt="Midmak Experience"
                  className="w-full h-full object-cover aspect-[4/5] scale-105 transition-transform duration-1000 group-hover:scale-100 opacity-95"
                />

                {/* Floating Micro-Card */}
                <div className="absolute bottom-6 right-6 left-6 p-6 bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/50 animate-float">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">أحدث عرض سعر</span>
                    <Badge className="bg-emerald-500 text-white border-none text-[10px] font-bold px-3">مقبول</Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-[#0F172A]">
                      <BarChart3 size={18} />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between text-[10px] font-bold text-slate-500">
                        <span>إكمال المشروع</span>
                        <span>85%</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full w-[85%] bg-[#0F172A] rounded-full"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid - Pro Max Balanced */}
        <section id="features" className="py-24 md:py-32 bg-slate-50/30">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center max-w-2xl mx-auto mb-24 space-y-4">
              <h2 className="text-3xl md:text-4xl font-bold text-[#0F172A] font-headline tracking-tight">قوة التحول الرقمي</h2>
              <p className="text-lg text-slate-500 font-medium font-body opacity-80">كل ما تحتاجه لإدارة مشترياتك الإنشائية في مكان واحد، وبذكاء اصطناعي</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { title: "شفافية المناقصات", desc: "نظام إلكتروني يضمن عدالة المنافسة وشفافية العروض لجميع الأطراف والحد من التلاعب.", icon: ShieldCheck },
                { title: "سرعة التنفيذ", desc: "تقليل الوقت المستغرق في طلب المواد والمفاضلة بين الموردين بنسبة تصل إلى 70%.", icon: Zap },
                { title: "تحليلات متقدمة", desc: "تقارير ذكية حول الأسعار، الجودة، والتزام الموردين بالمواعيد لاتخاذ قرارات أدق.", icon: BarChart3 }
              ].map((f, i) => (
                <div key={i} className="p-10 rounded-[2rem] bg-white border border-slate-100 hover:shadow-2xl hover:shadow-indigo-500/5 transition-all duration-500 group hover:-translate-y-2">
                  <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 mb-8 group-hover:bg-[#0F172A] group-hover:text-white transition-all">
                    <f.icon size={28} />
                  </div>
                  <h3 className="text-xl font-bold text-[#0F172A] mb-4 font-body">{f.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed font-medium font-body">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Experience Section - Refined Contrast */}
        <section className="py-32 md:py-48 bg-white overflow-hidden relative">
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">

              <div className="space-y-10">
                <div className="inline-flex items-center gap-3 text-[#0369A1] font-black text-xs uppercase tracking-[0.2em]">
                  <div className="w-8 h-[2px] bg-[#0369A1]"></div>
                  للموردين ومصانع المواد
                </div>
                <h2 className="text-4xl md:text-5xl font-bold text-[#0F172A] font-headline leading-[1.3] tracking-tight">
                  وسع قاعدة عملائك <br /> وزد مبيعاتك رقمياً
                </h2>
                <p className="text-lg text-slate-500 font-medium leading-relaxed max-w-xl font-body">
                  تلقى طلبات الشراء المباشرة من كبار المقاولين في المملكة. نظامنا يضمن لك وصولاً أسرع لفرص البيع وإدارة أسهل لعروض الأسعار ومتابعة الدفعات.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {[
                    "وصول لمشاريع كبرى",
                    "إدارة عروض رقمية",
                    "تتبع الدفعات والتوريد",
                    "نظام تقييم معتمد"
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 text-slate-600 font-bold text-sm bg-slate-50 p-4 rounded-xl border border-slate-100 hover:bg-white hover:shadow-md transition-all">
                      <CheckCircle2 size={18} className="text-emerald-500" />
                      {item}
                    </div>
                  ))}
                </div>

                <Link href="/register?role=Supplier" className="inline-block pt-6">
                  <Button className="h-14 px-10 text-base font-bold rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white shadow-xl transition-all hover:scale-[1.02]">
                    سجل كمورد الآن
                  </Button>
                </Link>
              </div>

              <div className="relative">
                <div className="rounded-[3rem] overflow-hidden border-8 border-slate-50 shadow-2xl group relative">
                  <img
                    src="/images/supplier-modern.png"
                    alt="Supplier"
                    className="w-full aspect-[4/3] object-cover transition-transform duration-1000 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-60"></div>

                  {/* Stats Overlay - Refined */}
                  <div className="absolute top-8 left-8 p-6 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/50 animate-float">
                    <div className="text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">الطلبات النشطة</div>
                    <div className="text-3xl font-black text-[#0F172A] font-body">24</div>
                    <div className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full w-2/3 bg-emerald-500 rounded-full"></div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Process Flow - Clean & Precise */}
        <section className="py-24 md:py-32 bg-slate-50/50">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center max-w-2xl mx-auto mb-24 space-y-4">
              <h2 className="text-3xl md:text-4xl font-bold text-[#0F172A] font-headline tracking-tight">كيف تعمل المنصة؟</h2>
              <p className="text-lg text-slate-500 font-medium font-body opacity-80">خطوات بسيطة لتحويل مشترياتك التقليدية إلى منظومة رقمية</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-12 relative">
              {[
                { step: "01", title: "طرح الطلب", desc: "تحديد الكميات والمواصفات في دقائق.", icon: FileCheck },
                { step: "02", title: "استقبال العروض", desc: "وصول عروض تنافسية من الموردين.", icon: ShoppingCart },
                { step: "03", title: "الترسية والتعميد", desc: "المفاضلة والاعتماد بضغطة زر واحدة.", icon: ShieldCheck },
                { step: "04", title: "التوريد والدفع", desc: "متابعة التوريد وضمان الاستلام والدفع.", icon: Truck }
              ].map((s, i) => (
                <div key={i} className="flex flex-col items-center text-center space-y-8 group">
                  <div className="w-20 h-20 rounded-[2.5rem] bg-white shadow-xl flex items-center justify-center text-[#0F172A] font-bold text-xl relative group-hover:bg-[#0F172A] group-hover:text-white transition-all duration-500 group-hover:-translate-y-2">
                    <s.icon size={32} />
                    <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-[#0369A1] text-white text-xs font-black flex items-center justify-center border-4 border-white">
                      {s.step}
                    </div>
                  </div>
                  <div className="space-y-3 px-4">
                    <h4 className="text-xl font-bold text-[#0F172A] font-headline">{s.title}</h4>
                    <p className="text-sm text-slate-500 leading-relaxed font-medium font-body">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section - Professional Impact */}
        <section className="py-24 px-6">
          <div className="max-w-6xl mx-auto rounded-[3rem] bg-[#0F172A] p-16 md:p-24 text-center space-y-12 relative overflow-hidden shadow-2xl">
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-[100px]"></div>

            <h2 className="text-3xl md:text-5xl font-bold text-white font-headline leading-tight relative z-10 tracking-tight">
              ابدأ رحلة التحول الرقمي <br /> في مشترياتك اليوم
            </h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto relative z-10 font-body leading-relaxed">
              انضم إلى مئات الشركات السعودية التي تعتمد على مدماك تيك في رفع كفاءة سلاسل الإمداد وتوفير التكاليف التشغيلية.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 relative z-10">
              <Link href="/register">
                <Button className="h-16 px-12 text-xl font-bold rounded-xl bg-white text-[#0F172A] hover:bg-slate-100 transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-white/10">
                  ابدأ الآن مجاناً
                </Button>
              </Link>
              <Link href="#contact">
                <Button variant="outline" className="h-16 px-12 text-xl font-bold rounded-xl border-2 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm transition-all">
                  تواصل معنا
                </Button>
              </Link>
            </div>

            <div className="pt-8 flex items-center justify-center gap-8 text-[10px] font-black text-white/40 uppercase tracking-[0.3em] relative z-10">
              <span>لا يتطلب بطاقة ائتمان</span>
              <div className="w-1.5 h-1.5 rounded-full bg-white/20"></div>
              <span>إعداد سريع في دقيقتين</span>
            </div>
          </div>
        </section>

      </main>

      {/* Professional Footer - Refined */}
      <footer className="bg-white border-t border-slate-100 pt-32 pb-16 relative z-10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-20">
          <div className="col-span-1 md:col-span-2 space-y-8">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 bg-[#0F172A] text-white rounded-xl flex items-center justify-center font-bold text-xl shadow-lg">م</div>
              <span className="text-2xl font-bold text-[#0F172A] font-headline tracking-tight">مدماك تيك</span>
            </div>
            <p className="text-slate-500 leading-relaxed max-w-sm font-medium font-body text-lg">
              المنصة التقنية السعودية الرائدة لتحويل قطاع المشتريات الإنشائية إلى منظومة رقمية ذكية متكاملة تواكب رؤية 2030.
            </p>
            <div className="flex items-center gap-5">
              {[Globe, Phone, Mail].map((Icon, idx) => (
                <Link key={idx} href="#" className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 hover:text-primary hover:bg-primary/5 transition-all hover:-translate-y-1">
                  <Icon size={22} />
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-[#0F172A] font-black mb-10 text-[10px] uppercase tracking-[0.2em]">الروابط</h4>
            <ul className="space-y-5 text-sm text-slate-500 font-bold font-body">
              <li><Link href="#" className="hover:text-primary transition-colors">عن المنصة</Link></li>
              <li><Link href="#" className="hover:text-primary transition-colors">المميزات</Link></li>
              <li><Link href="#" className="hover:text-primary transition-colors">بوابة الموردين</Link></li>
              <li><Link href="#" className="hover:text-primary transition-colors">حلول المقاولين</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-[#0F172A] font-black mb-10 text-[10px] uppercase tracking-[0.2em]">القانونية</h4>
            <ul className="space-y-5 text-sm text-slate-500 font-bold font-body">
              <li><Link href="#" className="hover:text-primary transition-colors">سياسة الخصوصية</Link></li>
              <li><Link href="#" className="hover:text-primary transition-colors">الشروط والأحكام</Link></li>
              <li><Link href="#" className="hover:text-primary transition-colors">مركز المساعدة</Link></li>
              <li><Link href="#" className="hover:text-primary transition-colors">اتصل بنا</Link></li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 mt-32 pt-10 border-t border-slate-50 flex flex-col md:flex-row justify-between items-center gap-6 text-[10px] font-black text-slate-400 tracking-[0.3em] uppercase">
          <p>© {new Date().getFullYear()} MIDMAK TECH PLATFORM</p>
          <div className="flex items-center gap-10">
            <span className="flex items-center gap-2 text-slate-900"><Globe size={14} /> العربية</span>
            <span>بكل فخر في المملكة العربية السعودية 🇸🇦</span>
          </div>
        </div>
      </footer>

      {/* Global Pro Max Animations */}
      <style jsx global>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 5s ease-in-out infinite;
        }
        html {
          scroll-behavior: smooth;
        }
      `}</style>
    </div>
  );
}
