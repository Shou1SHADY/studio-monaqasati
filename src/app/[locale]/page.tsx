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
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useTranslations, useLocale } from 'next-intl';



export default function Home() {
  const tNav = useTranslations('Landing.Navbar');
  const tHero = useTranslations('Landing.HeroSlides');
  const tAction = useTranslations('Landing.HeroAction');
  const tStats = useTranslations('Landing.Stats');
  const tFeatures = useTranslations('Landing.Features');
  const tContractor = useTranslations('Landing.Contractor');
  const tSupplier = useTranslations('Landing.Supplier');
  const tHow = useTranslations('Landing.HowItWorks');
  const tPartnership = useTranslations('Landing.Partnership');
  const tCTA = useTranslations('Landing.CTA');
  const tFooter = useTranslations('Landing.Footer');
  const tLanding = useTranslations('Landing');
  const locale = useLocale();

  const heroSlides = [
    {
      img: '/images/warehouse-desk.jpg',
      badge: tHero('slide1_badge'),
      title: tHero('slide1_title'),
      titleAccent: tHero('slide1_accent'),
      sub: tHero('slide1_sub'),
    },
    {
      img: '/images/construction-site.jpg',
      badge: tHero('slide2_badge'),
      title: tHero('slide2_title'),
      titleAccent: tHero('slide2_accent'),
      sub: tHero('slide2_sub'),
    },
    {
      img: '/images/loading-dock.jpg',
      badge: tHero('slide3_badge'),
      title: tHero('slide3_title'),
      titleAccent: tHero('slide3_accent'),
      sub: tHero('slide3_sub'),
    },
  ];

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
    { step: "01", title: tHow('c_s1_title'), desc: tHow('c_s1_desc'), icon: FileText },
    { step: "02", title: tHow('c_s2_title'), desc: tHow('c_s2_desc'), icon: Search },
    { step: "03", title: tHow('c_s3_title'), desc: tHow('c_s3_desc'), icon: ShieldCheck },
    { step: "04", title: tHow('c_s4_title'), desc: tHow('c_s4_desc'), icon: Truck }
  ];

  const supplierSteps = [
    { step: "01", title: tHow('s_s1_title'), desc: tHow('s_s1_desc'), icon: Zap },
    { step: "02", title: tHow('s_s2_title'), desc: tHow('s_s2_desc'), icon: FileCheck },
    { step: "03", title: tHow('s_s3_title'), desc: tHow('s_s3_desc'), icon: CheckCircle },
    { step: "04", title: tHow('s_s4_title'), desc: tHow('s_s4_desc'), icon: BarChart3 }
  ];

  const activeSteps = activeFlow === 'contractor' ? contractorSteps : supplierSteps;

  return (
    <div className="min-h-screen bg-[#020617] flex flex-col font-body text-foreground overflow-x-hidden selection:bg-cta/30">

      {/* Premium Navigation - Aligned with App Primary Navy & CTA Blue */}
      <nav className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-500 ${scrolled ? 'bg-[#0F172A]/80 backdrop-blur-xl border-b border-white/5 py-3' : 'bg-transparent py-5'}`}>
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="w-10 h-10 bg-cta rounded-xl flex items-center justify-center font-bold text-xl text-white transition-transform group-hover:scale-110 shadow-lg shadow-cta/20">م</div>
            <div className="flex flex-col">
              <span className="text-xl font-bold text-white tracking-normal leading-none">مدماك تيك</span>
              <span className="text-[10px] text-sky-400/80 font-bold uppercase tracking-widest mt-1">Mdmak Tech</span>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-10 text-slate-400 font-bold text-sm tracking-normal">
            <Link href="#features" className="hover:text-white transition-colors relative group">
              {tNav('features')}
              <span className="absolute -bottom-1 right-0 w-0 h-0.5 bg-cta transition-all group-hover:w-full" />
            </Link>
            <Link href="#how" className="hover:text-white transition-colors relative group">
              {tNav('how_it_works')}
              <span className="absolute -bottom-1 right-0 w-0 h-0.5 bg-cta transition-all group-hover:w-full" />
            </Link>
            <Link href="/register?role=Supplier" className="hover:text-white transition-colors relative group">
              {tNav('suppliers_portal')}
              <span className="absolute -bottom-1 right-0 w-0 h-0.5 bg-cta transition-all group-hover:w-full" />
            </Link>
            <Link href="/register?role=Contractor" className="hover:text-white transition-colors relative group">
              {tNav('contractors_portal')}
              <span className="absolute -bottom-1 right-0 w-0 h-0.5 bg-cta transition-all group-hover:w-full" />
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <LanguageSwitcher className="text-slate-300 hover:text-white hover:bg-white/5" />
            <Link href="/login">
              <Button variant="ghost" className="text-slate-300 hover:text-white font-bold text-sm px-5 h-11 hover:bg-white/5 transition-all">{tNav('login')}</Button>
            </Link>
            <Link href="/register">
              <Button className="font-bold bg-white text-primary hover:bg-cta hover:text-white px-8 rounded-xl h-11 text-sm transition-all shadow-xl shadow-white/5 border-none">{tNav('start_free')}</Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="relative">

        {/* HERO - Full bleed architectural design */}
        <section className="relative h-screen min-h-[800px] overflow-hidden flex flex-col">
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

          {/* Hero Text Content */}
          <div className="relative z-10 flex-1 flex items-center w-full max-w-7xl mx-auto px-6 pt-20">
            <div className="max-w-2xl space-y-6 animate-in fade-in slide-in-from-right-10 duration-1000">
              <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-cta/10 border border-cta/20 backdrop-blur-md text-sky-400 text-xs font-black uppercase tracking-normal shadow-lg shadow-cta/10">
                <div className="w-2 h-2 rounded-full bg-cta animate-pulse" />
                {heroSlides[slide].badge}
              </div>

              <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white leading-tight tracking-normal">
                {heroSlides[slide].title}<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-200">
                  {heroSlides[slide].titleAccent}
                </span>
              </h1>

              <p className="text-slate-300 text-base md:text-lg leading-relaxed font-medium max-w-xl">
                {heroSlides[slide].sub}
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-5 pt-2">
                <Link href="/register" className="w-full sm:w-auto">
                  <Button className="w-full h-14 px-8 text-base font-black rounded-2xl bg-cta hover:bg-sky-600 text-white gap-3 transition-all hover:scale-105 shadow-2xl shadow-cta/30 border-none">
                    {tAction('register_now')} <ArrowLeft size={18} className="rtl:rotate-0 ltr:rotate-180" />
                  </Button>
                </Link>
                <div className="flex items-center gap-4 py-2">
                  <div className="flex flex-col">
                    <span className="text-white font-black text-sm tracking-normal">{tAction('join_early')}</span>
                    <span className="text-slate-400 text-[10px] font-bold uppercase tracking-normal mt-1">{tAction('exclusive_opportunities')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Side Progress Bar */}
          <div className="absolute right-10 -mr-[30px] top-1/2 -translate-y-1/2 z-20 flex-col gap-8 items-center hidden md:flex">
            {heroSlides.map((_, i) => (
              <button key={i} onClick={() => setSlide(i)}
                className={`group flex items-center gap-4 transition-all ${i === slide ? 'text-sky-400' : 'text-slate-500'}`}>
                <div className={`h-12 w-[2px] transition-all duration-500 ${i === slide ? 'bg-cta h-16' : 'bg-white/10 group-hover:bg-white/30'}`} />
              </button>
            ))}
          </div>

          {/* Bottom Floating Stats - now in normal flow */}
          <div className="relative z-20 px-6 pb-4 md:pb-6">
            <div className="max-w-7xl mx-auto">
              <div className="flex md:grid md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 overflow-x-auto snap-x snap-mandatory pb-2 hide-scrollbar w-full">
                {[
                  { val: tStats('goal_500'), label: tStats('registered_company'), icon: Building2 },
                  { val: tStats('full_automation'), label: tStats('construction_tenders'), icon: FileCheck },
                  { val: tStats('saving_70'), label: tStats('time_saving'), icon: Zap },
                  { val: tStats('improvement_15'), label: tStats('cost_improvement'), icon: TrendingUp },
                ].map((s, i) => (
                  <div key={i} className="min-w-[260px] md:min-w-0 shrink-0 snap-center bg-white/[0.03] backdrop-blur-md border border-white/5 rounded-2xl p-5 md:p-6 flex items-center gap-4 md:gap-5 group hover:bg-white/[0.06] transition-all">
                    <div className="w-12 h-12 rounded-xl bg-cta/10 flex items-center justify-center text-sky-400 group-hover:scale-110 transition-transform shrink-0">
                      <s.icon size={24} />
                    </div>
                    <div className="flex flex-col justify-center min-w-0">
                      <div className="text-lg md:text-xl font-black text-white leading-tight">{s.val}</div>
                      <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-normal mt-1">{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* TRUSTED BY LOGOS - UI/UX Pro Max */}
        <section className="py-12 border-b border-white/5 bg-[#020617] overflow-hidden relative flex flex-col items-center">
          <div className="text-slate-500 text-xs font-black uppercase tracking-normal mb-10 relative z-10 flex items-center gap-4">
            <div className="w-12 h-[1px] bg-white/10" />
            {tLanding('Partners')}
            <div className="w-12 h-[1px] bg-white/10" />
          </div>
          
          <div className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-[#020617] to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-[#020617] to-transparent z-10 pointer-events-none" />
          
          <div className="w-full flex overflow-hidden py-4">
             <div className="flex gap-12 md:gap-16 items-center animate-scroll-x-logos whitespace-nowrap min-w-full justify-around pr-12 md:pr-16">
                {[
                  '/images/logo-qudra.png',
                  '/images/logo-naya.jpeg',
                  '/images/logo-itc.png',
                  '/images/logo-qudra.png',
                  '/images/logo-naya.jpeg',
                  '/images/logo-itc.png',
                  '/images/logo-qudra.png',
                  '/images/logo-naya.jpeg',
                  '/images/logo-itc.png',
                  '/images/logo-qudra.png',
                  '/images/logo-naya.jpeg',
                  '/images/logo-itc.png',
                ].map((src, i) => (
                  <div 
                    key={i} 
                    className={`flex items-center justify-center w-32 md:w-44 h-16 md:h-20 p-2 md:p-3 shrink-0 transition-all duration-500 hover:scale-110 ${src.includes('naya') ? '' : 'bg-white/5 rounded-xl border border-white/10'}`}
                  >
                    <img 
                      src={src} 
                      alt="Partner Logo" 
                      className={`max-w-full max-h-full object-contain opacity-80 hover:opacity-100 ${src.includes('naya') ? 'mix-blend-screen' : ''}`} 
                    />
                  </div>
                ))}
             </div>
          </div>
        </section>

        {/* FEATURES - Dark depth architecture with Blue app colors */}
        <section id="features" className="py-32 relative bg-[#0F172A]">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cta/30 to-transparent" />
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-20">
              <div className="space-y-4">
                <div className="text-sky-400 font-black text-xs uppercase tracking-normal">{tFeatures('tagline')}</div>
                <h2 className="text-4xl md:text-5xl font-bold text-white tracking-normal leading-snug md:leading-tight" dangerouslySetInnerHTML={{ __html: tFeatures.raw('title') }} />
              </div>
              <p className="text-slate-400 max-w-md text-lg leading-relaxed border-s-2 border-cta/30 ps-6">
                {tFeatures('desc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { title: tFeatures('f1_title'), desc: tFeatures('f1_desc'), icon: ShieldCheck, color: "cta" },
                { title: tFeatures('f2_title'), desc: tFeatures('f2_desc'), icon: Zap, color: "blue" },
                { title: tFeatures('f3_title'), desc: tFeatures('f3_desc'), icon: BarChart3, color: "purple" }
              ].map((f, i) => (
                <div key={i} className="p-10 rounded-[2.5rem] bg-white/[0.02] border border-white/5 hover:border-cta/30 transition-all group hover:-translate-y-2 duration-500 relative overflow-hidden">
                  <div className="absolute -top-10 -left-10 w-32 h-32 bg-cta/5 rounded-full blur-3xl group-hover:bg-cta/10 transition-all" />
                  <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-sky-400 mb-8 group-hover:bg-cta group-hover:text-white transition-all duration-500 shadow-xl">
                    <f.icon size={28} />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-4 group-hover:text-sky-400 transition-colors">{f.title}</h3>
                  <p className="text-slate-400 text-base leading-relaxed">{f.desc}</p>
                  <div className="mt-8 flex items-center gap-2 text-sky-400 text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all rtl:translate-x-2 ltr:-translate-x-2 group-hover:translate-x-0">
                    {tFeatures('learn_more')} <ArrowLeft size={14} className="rtl:rotate-0 ltr:rotate-180" />
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
                  <div className="text-[10px] font-black text-sky-400 uppercase tracking-widest">{tContractor('stat_label')}</div>
                </div>
                <div className="text-5xl font-black text-white leading-none">{tContractor('stat_val')}</div>
                <div className="text-slate-400 text-sm mt-3 font-medium" dangerouslySetInnerHTML={{ __html: tContractor.raw('stat_desc') }} />
              </div>
            </div>

            <div className="flex items-center px-10 lg:px-24 py-24 relative bg-[#0F172A]/50">
              <div className="space-y-10 max-w-xl">
                <div className="inline-flex items-center gap-3 text-sky-400 font-black text-xs uppercase tracking-normal">
                  <div className="w-10 h-0.5 bg-cta" /> {tContractor('tagline')}
                </div>
                <h2 className="text-4xl md:text-6xl font-bold text-white leading-[1.6] tracking-normal" dangerouslySetInnerHTML={{ __html: tContractor.raw('title') }} />
                <p className="text-slate-400 text-xl leading-relaxed">{tContractor('desc')}</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {[tContractor('network'), tContractor('comparison'), tContractor('savings'), tContractor('reports')].map((item, i) => (
                    <div key={i} className="flex items-center gap-4 text-slate-300 text-sm font-bold bg-white/5 p-5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all">
                      <CheckCircle2 size={20} className="text-sky-400 shrink-0" /> {item}
                    </div>
                  ))}
                </div>

                <div className="pt-6">
                  <Link href="/register?role=Contractor">
                    <Button className="h-16 px-12 text-lg font-black rounded-2xl bg-cta hover:bg-sky-600 text-white shadow-2xl shadow-cta/20 border-none transition-all hover:scale-105">
                      {tContractor('cta')}
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
                <div className="inline-flex items-center gap-3 text-sky-400 font-black text-xs uppercase tracking-normal">
                  <div className="w-10 h-0.5 bg-sky-400" /> {tSupplier('tagline')}
                </div>
                <h2 className="text-4xl md:text-6xl font-bold text-white leading-[1.6] tracking-normal" dangerouslySetInnerHTML={{ __html: tSupplier.raw('title') }} />
                <p className="text-slate-400 text-xl leading-relaxed">{tSupplier('desc')}</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {[tSupplier('access'), tSupplier('digital'), tSupplier('tracking'), tSupplier('rating')].map((item, i) => (
                    <div key={i} className="flex items-center gap-4 text-slate-300 text-sm font-bold bg-white/5 p-5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all">
                      <CheckCircle2 size={20} className="text-sky-400 shrink-0" /> {item}
                    </div>
                  ))}
                </div>

                <div className="pt-6">
                  <Link href="/register?role=Supplier">
                    <Button className="h-16 px-12 text-lg font-black rounded-2xl bg-sky-600 hover:bg-sky-500 text-white shadow-2xl shadow-sky-500/20 border-none transition-all hover:scale-105">
                      {tSupplier('cta')}
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
                  <div className="text-[10px] font-black text-sky-400 uppercase tracking-normal">{tSupplier('stat_label')}</div>
                </div>
                <div className="text-5xl font-black text-white leading-none">{tSupplier('stat_val')}</div>
                <div className="text-slate-400 text-sm mt-3 font-medium" dangerouslySetInnerHTML={{ __html: tSupplier.raw('stat_desc') }} />
              </div>
            </div>
          </div>
        </section>



        {/* HOW IT WORKS - Step Architecture */}
        <section id="how" className="py-32 relative bg-[#0F172A]">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-20 space-y-4">
              <div className="text-sky-400 font-black text-xs uppercase tracking-normal">{tHow('tagline')}</div>
              <h2 className="text-4xl md:text-5xl font-bold text-white tracking-normal">{tHow('title')}</h2>
              <p className="text-slate-400 max-w-xl mx-auto text-lg leading-relaxed">{tHow('desc')}</p>
            </div>

            <div className="flex justify-center mb-16">
              <div className="bg-white/5 p-1.5 rounded-2xl inline-flex border border-white/10 relative overflow-hidden group">
                <div className={`absolute inset-y-1.5 w-[calc(50%-6px)] bg-cta rounded-xl transition-all duration-500 ease-out z-0 ${activeFlow === 'contractor' ? 'rtl:translate-x-0 ltr:translate-x-0' : 'rtl:-translate-x-[100%] ltr:translate-x-[100%]'}`} />
                <button onClick={() => setActiveFlow('contractor')}
                  className={`relative z-10 px-10 py-3.5 text-sm font-black rounded-xl transition-all duration-300 ${activeFlow === 'contractor' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>
                  {tHow('contractors_tab')}
                </button>
                <button onClick={() => setActiveFlow('supplier')}
                  className={`relative z-10 px-10 py-3.5 text-sm font-black rounded-xl transition-all duration-300 ${activeFlow === 'supplier' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>
                  {tHow('suppliers_tab')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 lg:gap-12 relative" key={activeFlow}>
              {activeSteps.map((s, i) => (
                <div key={i} className="flex flex-col items-center text-center space-y-6 group relative">
                  {i < 3 && (
                    <div className="hidden md:block absolute top-10 rtl:-left-1/2 ltr:-right-1/2 w-full h-[2px] bg-gradient-to-r from-transparent via-white/5 to-transparent z-0" />
                  )}
                  <div className="w-20 h-20 rounded-[2.5rem] bg-white/[0.02] border border-white/5 flex items-center justify-center text-slate-300 relative group-hover:bg-cta group-hover:border-cta group-hover:text-white transition-all duration-500 z-10 shadow-xl group-hover:scale-110">
                    <s.icon size={36} />
                    <div className="absolute -top-3 rtl:-right-3 ltr:-left-3 w-8 h-8 rounded-full bg-cta text-white text-xs font-black flex items-center justify-center border-4 border-[#0F172A]">{s.step}</div>
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
            <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-cta/10 border border-cta/20 text-sky-400 text-xs font-black uppercase tracking-normal">
              {tPartnership('tagline')}
            </div>
            <h2 className="text-4xl md:text-6xl font-bold text-white tracking-normal leading-[1.6]" dangerouslySetInnerHTML={{ __html: tPartnership.raw('title') }} />
            <p className="text-slate-400 text-xl leading-relaxed font-medium">
              {tPartnership('desc')}
            </p>
            <div className="pt-4">
              <Button variant="outline" className="h-16 px-12 text-lg font-black rounded-2xl border-white/10 text-white hover:bg-white/5 transition-all">
                {tPartnership('cta')}
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

              <h2 className="text-4xl md:text-7xl font-bold text-white relative z-10 leading-[1.6]" dangerouslySetInnerHTML={{ __html: tCTA.raw('title') }} />
              <p className="text-slate-300 max-w-2xl mx-auto text-xl relative z-10 leading-relaxed font-medium">
                {tCTA('desc')}
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-6 relative z-10 pt-6">
                <Link href="/register" className="w-full sm:w-auto">
                  <Button className="w-full h-18 px-14 text-xl font-black rounded-[2rem] bg-white text-primary hover:bg-cta hover:text-white transition-all hover:scale-105 shadow-2xl shadow-white/5 border-none">
                    {tCTA('register')}
                  </Button>
                </Link>
                <Link href="/contact" className="w-full sm:w-auto">
                  <Button variant="outline" className="w-full h-18 px-14 text-xl font-black rounded-[2rem] border-white/10 text-white hover:bg-white/5 backdrop-blur-md transition-all">
                    {tCTA('contact')}
                  </Button>
                </Link>
              </div>

              <div className="pt-10 flex items-center justify-center gap-10 text-[10px] font-black text-slate-500 uppercase tracking-normal relative z-10">
                <span className="flex items-center gap-2"><CheckCircle size={14} className="text-sky-400" /> {tCTA('setup')}</span>
                <span className="flex items-center gap-2"><CheckCircle size={14} className="text-sky-400" /> {tCTA('no_fees')}</span>
                <span className="flex items-center gap-2"><CheckCircle size={14} className="text-sky-400" /> {tCTA('vision')}</span>
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
              {tFooter('desc')}
            </p>
            <div className="flex items-center gap-4">
              <Link href="/contact" className="px-6 py-3 rounded-xl bg-white/5 font-bold text-sm text-slate-300 hover:text-sky-400 hover:bg-white/10 transition-all border border-white/5">
                {tFooter('support')}
              </Link>
            </div>
          </div>

          <div className="space-y-8">
            <h4 className="text-white font-black text-xs uppercase tracking-normal">{tFooter('quick_links')}</h4>
            <ul className="space-y-5 text-base text-slate-500 font-bold">
              {[
                { label: tFooter('l_about'), href: "/about" },
                { label: tFooter('l_features'), href: "/#features" },
                { label: tFooter('l_pricing'), href: "/pricing" },
                { label: tFooter('l_suppliers'), href: "/register?role=Supplier" },
                { label: tFooter('l_contractors'), href: "/register?role=Contractor" }
              ].map(l => (
                <li key={l.label}><Link href={l.href} className="hover:text-sky-400 transition-colors flex items-center gap-2 group">
                  <div className="w-0 h-px bg-cta transition-all group-hover:w-4 rtl:group-hover:mr-2 ltr:group-hover:ml-2" /> {l.label}
                </Link></li>
              ))}
            </ul>
          </div>

          <div className="space-y-8">
            <h4 className="text-white font-black text-xs uppercase tracking-normal">{tFooter('legal')}</h4>
            <ul className="space-y-5 text-base text-slate-500 font-bold">
              {[
                { label: tFooter('l_privacy'), href: "/privacy" },
                { label: tFooter('l_terms'), href: "/terms" },
                { label: tFooter('l_contact'), href: "/contact" }
              ].map(l => (
                <li key={l.label}><Link href={l.href} className="hover:text-sky-400 transition-colors flex items-center gap-2 group">
                  <div className="w-0 h-px bg-cta transition-all group-hover:w-4 rtl:group-hover:mr-2 ltr:group-hover:ml-2" /> {l.label}
                </Link></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 pt-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-8 text-[10px] font-black text-slate-600 uppercase tracking-normal relative z-10">
          <p>{tFooter('copyright', { year: new Date().getFullYear() })}</p>
          <div className="flex items-center gap-10">
            <span className="flex items-center gap-2 text-slate-400"><Globe size={14} /> {locale === 'ar' ? 'العربية' : 'English'}</span>
            <span>{tFooter('made_in')}</span>
          </div>
        </div>

        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-cta/5 rounded-full blur-[100px] pointer-events-none" />
      </footer>

      <style jsx global>{`
        @keyframes scroll-x {
          0% { transform: translateX(0); }
          100% { transform: translateX(50%); }
        }
        @keyframes scroll-x-logos {
          0% { transform: translateX(0); }
          100% { transform: translateX(50%); }
        }
        .animate-scroll-x {
          animation: scroll-x 40s linear infinite;
          width: max-content;
        }
        .animate-scroll-x-logos {
          animation: scroll-x-logos 25s linear infinite;
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
