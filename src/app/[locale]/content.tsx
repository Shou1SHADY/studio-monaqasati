"use client";

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Link } from "@/i18n/routing";
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
import { cn } from "@/lib/utils";
import { motion, useScroll, useTransform, animate, useMotionValue } from 'framer-motion';

function AnimatedStat({ value }: { value: string }) {
  const match = value.match(/^.*?(\d+)(.*)$/);
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest));
  const [hasAnimated, setHasAnimated] = useState(false);

  if (!match) return <span>{value}</span>;

  const numValue = parseInt(match[1]);
  const suffix = match[2];
  const prefix = value.substring(0, match.index);

  const display = useTransform(rounded, (latest) => `${prefix}${latest}${suffix}`);

  return (
    <motion.span
      onViewportEnter={() => {
        if (!hasAnimated) {
          setHasAnimated(true);
          animate(count, numValue, { duration: 1.5, ease: "easeOut" });
        }
      }}
      viewport={{ once: true, margin: "-50px" }}
    >
      {hasAnimated ? display : `${prefix}0${suffix}`}
    </motion.span>
  );
}



export default function HomeContent() {
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
  const tFAQ = useTranslations('Landing.FAQ');
  const tLanding = useTranslations('Landing');
  const locale = useLocale();
  const { scrollY } = useScroll();
  const yHeroBg = useTransform(scrollY, [0, 1000], [0, 50]);

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
    window.addEventListener('scroll', handleScroll, { passive: true });
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
          <Link href="/" className="flex items-center cursor-pointer group">
            <Image
              src="/logo1.png"
              alt={locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech'}
              width={140}
              height={48}
              className="h-10 w-auto object-contain transition-transform group-hover:scale-105"
              priority
            />
          </Link>

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

          <div className="flex items-center gap-2 md:gap-4">
            <LanguageSwitcher className="text-slate-300 hover:text-white hover:bg-white/5 text-xs md:text-sm" />
            <Link href="/login">
              <Button variant="ghost" className="text-slate-300 hover:text-white font-bold text-xs md:text-sm px-3 md:px-5 h-9 md:h-11 hover:bg-white/5 transition-all">{tNav('login')}</Button>
            </Link>
            <Link href="/register">
              <Button className="font-bold bg-white text-primary hover:bg-cta hover:text-white px-4 md:px-8 rounded-xl h-9 md:h-11 text-xs md:text-sm transition-all shadow-xl shadow-white/5 border-none">{tNav('start_free')}</Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="relative">

        {/* HERO - Full bleed architectural design */}
        <section className="relative h-screen min-h-[800px] md:min-h-[700px] flex flex-col">
          {/* Slides */}
          {heroSlides.map((s, i) => (
            <motion.div key={i} style={{ y: i === slide ? yHeroBg : 0 }} className={`absolute inset-0 overflow-hidden transition-all duration-1500 ease-in-out ${i === slide ? 'opacity-100 scale-100' : 'opacity-0 scale-110'}`}>
              <Image fill src={s.img} alt={s.title} className="w-full h-full object-cover object-center" sizes="100vw" priority={i === 0} loading={i === 0 ? undefined : "lazy"} />
              <div className={`absolute inset-0 ${locale === 'ar' ? 'bg-gradient-to-l' : 'bg-gradient-to-r'} from-[#020617] via-[#020617]/70 to-transparent`} />
              <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-[#020617]/30" />
            </motion.div>
          ))}

          {/* Decorative Mesh */}
          <div className="absolute inset-0 z-[5] opacity-20 pointer-events-none overflow-hidden"
            style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>

          {/* Hero Text Content */}
          <div className="relative z-10 flex-1 flex items-center w-full max-w-7xl mx-auto px-6 pt-24 md:pt-16 pb-4 md:pb-0">
            <div className={`max-w-2xl space-y-6 animate-in fade-in duration-1000 ${locale === 'ar' ? 'slide-in-from-right-10' : 'slide-in-from-left-10'}`}>

              <h1 className={`text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight flex flex-col ${locale === 'ar' ? 'gap-0 md:gap-0 !leading-[1.6]' : 'gap-2 md:gap-3 !leading-[1.3]'}`}>
                <span className="whitespace-nowrap">{heroSlides[slide].title}</span>
                <span className={`text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-200 whitespace-nowrap ${locale === 'ar' ? '' : 'pb-2 md:pb-3'}`}>
                  {heroSlides[slide].titleAccent}
                </span>
              </h1>

              <p className={`text-slate-300 text-base md:text-lg font-medium max-w-xl ${locale === 'ar' ? '!leading-[1.6]' : '!leading-[1.6]'}`}>
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
              <div className="flex flex-wrap items-center gap-6 text-[10px] font-bold text-slate-500">
                <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-sky-400" /> {tAction('setup')}</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-sky-400" /> {tAction('no_fees')}</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-sky-400" /> {tAction('vision')}</span>
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
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 w-full">
                {[
                  { val: tStats('goal_500'), label: tStats('registered_company'), icon: Building2 },
                  { val: tStats('full_automation'), label: tStats('construction_tenders'), icon: FileCheck },
                  { val: tStats('saving_70'), label: tStats('time_saving'), icon: Zap },
                  { val: tStats('improvement_15'), label: tStats('cost_improvement'), icon: TrendingUp },
                ].map((s, i) => (
                  <div key={i} className="shrink-0 snap-center bg-white/[0.03] backdrop-blur-md border border-white/5 rounded-2xl p-3 md:p-6 flex items-center gap-2 md:gap-5 group hover:bg-white/[0.06] transition-all min-h-[100px] md:min-h-0">
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-cta/10 flex items-center justify-center text-sky-400 group-hover:scale-110 transition-transform shrink-0">
                      <s.icon size={20} className="md:size-6" />
                    </div>
                    <div className="flex flex-col justify-center min-w-0">
                      <div className="text-lg md:text-xl font-black text-white leading-tight"><AnimatedStat value={s.val} /></div>
                      <div className="text-slate-500 text-[9px] md:text-[11px] font-bold uppercase tracking-normal mt-1">{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* TRUSTED BY LOGOS - Enhanced B2B Social Proof */}
        <section className="py-16 md:py-20 border-b border-white/5 bg-[#020617] overflow-hidden relative flex flex-col items-center">
          <div className="text-slate-400 text-xs font-black uppercase tracking-normal mb-8 relative z-10 flex items-center gap-4">
            <div className="w-12 h-[1px] bg-white/10" />
            {tLanding('Partners')}
            <div className="w-12 h-[1px] bg-white/10" />
          </div>

          <div className="w-full overflow-hidden py-6 relative">
            <div className="absolute inset-y-0 left-0 w-16 md:w-40 bg-gradient-to-r from-[#020617] to-transparent z-10 pointer-events-none" />
            <div className="absolute inset-y-0 right-0 w-16 md:w-40 bg-gradient-to-l from-[#020617] to-transparent z-10 pointer-events-none" />
            <div className={cn(
              "flex items-center gap-16 md:gap-20 min-w-max px-8 md:px-16",
              locale === 'ar' ? "animate-scroll-x-logos-rtl" : "animate-scroll-x-logos-ltr"
            )}>
              {[
                { src: '/images/logo-qudra.png', alt: 'Qudra' },
                { src: '/images/logo-naya.jpeg', alt: 'Naya' },
                { src: '/images/logo-itc.png', alt: 'ITC' },
                { src: '/images/logo-qudra.png', alt: 'Qudra' },
                { src: '/images/logo-naya.jpeg', alt: 'Naya' },
                { src: '/images/logo-itc.png', alt: 'ITC' },
                { src: '/images/logo-qudra.png', alt: 'Qudra' },
                { src: '/images/logo-naya.jpeg', alt: 'Naya' },
                { src: '/images/logo-itc.png', alt: 'ITC' },
                { src: '/images/logo-qudra.png', alt: 'Qudra' },
                { src: '/images/logo-naya.jpeg', alt: 'Naya' },
                { src: '/images/logo-itc.png', alt: 'ITC' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="relative flex items-center justify-center w-32 md:w-44 h-16 md:h-20 p-2 md:p-3 shrink-0 bg-white/5 rounded-xl border border-white/10"
                >
                  <Image
                    fill
                    src={item.src}
                    alt={item.alt}
                    className="object-contain p-2 opacity-70 hover:opacity-100 transition-all duration-300"
                    sizes="176px"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURES - Dark depth architecture with Blue app colors */}
        <section id="features" className="py-16 md:py-24 lg:py-32 relative bg-[#0F172A]">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cta/30 to-transparent" />
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-20">
              <div className="space-y-4">
                <div className="text-sky-400 font-black text-xs uppercase tracking-normal">{tFeatures('tagline')}</div>
                <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-normal leading-snug md:leading-tight" dangerouslySetInnerHTML={{ __html: tFeatures.raw('title') }} />
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
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: i * 0.1, ease: "easeOut" }}
                  key={i}
                  className="p-8 md:p-10 rounded-[2rem] md:rounded-[2.5rem] bg-white/[0.02] border border-white/5 hover:border-sky-400/40 hover:bg-white/[0.04] transition-all group hover:-translate-y-2 duration-500 relative overflow-hidden hover:shadow-[0_0_40px_-10px_rgba(56,189,248,0.15)]"
                >
                  <div className="absolute -top-10 -left-10 w-32 h-32 bg-cta/5 rounded-full blur-3xl group-hover:bg-cta/10 transition-all" />
                  <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-sky-400 mb-8 group-hover:bg-cta group-hover:text-white transition-all duration-500 shadow-xl">
                    <f.icon size={28} />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-4 group-hover:text-sky-400 transition-colors">{f.title}</h3>
                  <p className="text-slate-400 text-base leading-relaxed">{f.desc}</p>
                  <div className="mt-8 flex items-center gap-2 text-sky-400 text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all rtl:translate-x-2 ltr:-translate-x-2 group-hover:translate-x-0">
                    {tFeatures('learn_more')} <ArrowLeft size={14} className="rtl:rotate-0 ltr:rotate-180" />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CONTRACTOR EXPERIENCE - Premium Visual Split */}
        <section className="relative overflow-hidden border-y border-white/5 bg-[#020617]">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-stretch min-h-[700px]">
            <motion.div
              initial={{ opacity: 0, x: locale === 'ar' ? 50 : -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="relative overflow-hidden group">
              <Image fill src="/images/warehouse-standing.jpg" alt="Contractor" className="w-full h-full object-cover transition-transform duration-3000 group-hover:scale-110" sizes="50vw" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#020617]" />
              <div className="absolute inset-0 bg-cta/10 mix-blend-overlay" />

              <div className="absolute bottom-6 right-6 md:bottom-12 md:right-12 p-5 md:p-8 bg-white/5 backdrop-blur-2xl rounded-2xl md:rounded-[2rem] border border-white/10 shadow-2xl animate-float">
                <div className="flex items-center gap-2 md:gap-4 mb-3 md:mb-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-sky-500 flex items-center justify-center text-white shrink-0 shadow-lg shadow-sky-500/20">
                    <TrendingUp size={20} className="md:size-6" />
                  </div>
                  <div className="text-[10px] md:text-xs font-black text-sky-400 uppercase tracking-widest">{tContractor('stat_label')}</div>
                </div>
                <div className="text-4xl md:text-5xl font-black text-white leading-none"><AnimatedStat value={tContractor('stat_val')} /></div>
                <div className="text-slate-400 text-xs md:text-sm mt-3 md:mt-4 font-medium" dangerouslySetInnerHTML={{ __html: tContractor.raw('stat_desc') }} />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: locale === 'ar' ? -50 : 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
              className="flex items-center px-6 md:px-10 lg:px-24 py-16 md:py-24 relative bg-[#0F172A]/50">
              <div className="space-y-10 max-w-xl">
                <div className="inline-flex items-center gap-3 text-sky-400 font-black text-xs uppercase tracking-normal">
                  <div className="w-10 h-0.5 bg-cta" /> {tContractor('tagline')}
                </div>
                <h2 className="text-3xl md:text-5xl lg:text-6xl font-bold text-white leading-[1.6] tracking-normal" dangerouslySetInnerHTML={{ __html: tContractor.raw('title') }} />
                <p className="text-slate-400 text-base md:text-xl leading-relaxed">{tContractor('desc')}</p>

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
            </motion.div>
          </div>
        </section>

        {/* SUPPLIER EXPERIENCE - Symmetric Reverse */}
        <section className="relative overflow-hidden bg-[#020617]">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-stretch min-h-[700px]">
            <motion.div
              initial={{ opacity: 0, x: locale === 'ar' ? 50 : -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
              className="flex items-center px-6 md:px-10 lg:px-24 py-16 md:py-24 relative order-2 lg:order-1 bg-[#0F172A]/30">
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
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: locale === 'ar' ? -50 : 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="relative overflow-hidden group order-1 lg:order-2">
              <Image fill src="/images/supplier-dashboard.jpg" alt="Supplier" className="w-full h-full object-cover transition-transform duration-3000 group-hover:scale-110" sizes="50vw" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-[#020617]" />
              <div className="absolute inset-0 bg-sky-500/10 mix-blend-overlay" />

              <div className="absolute top-6 left-6 md:top-12 md:left-12 p-5 md:p-8 bg-white/5 backdrop-blur-2xl rounded-2xl md:rounded-[2rem] border border-white/10 shadow-2xl animate-float">
                <div className="flex items-center gap-2 md:gap-4 mb-3 md:mb-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-sky-500 flex items-center justify-center text-white shrink-0 shadow-lg shadow-sky-500/20">
                    <LayoutDashboard size={20} className="md:size-6" />
                  </div>
                  <div className="text-[10px] md:text-xs font-black text-sky-400 uppercase tracking-normal">{tSupplier('stat_label')}</div>
                </div>
                <div className="text-4xl md:text-5xl font-black text-white leading-none"><AnimatedStat value={tSupplier('stat_val')} /></div>
                <div className="text-slate-400 text-xs md:text-sm mt-3 md:mt-4 font-medium" dangerouslySetInnerHTML={{ __html: tSupplier.raw('stat_desc') }} />
              </div>
            </motion.div>
          </div>
        </section>



        {/* HOW IT WORKS - Step Architecture */}
        <section id="how" className="py-16 md:py-24 lg:py-32 relative bg-[#0F172A] overflow-hidden">

          {/* Pencil drawing overlay — inverted + screen-blended for light watermark on dark bg */}
          <img
            src="/pencilbg.png"
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
            style={{ filter: 'invert(1) contrast(1.2)', opacity: 0.06, mixBlendMode: 'screen' }}
          />

          {/* Soft vignette so content stays readable */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_50%,transparent_30%,rgba(15,23,42,0.65)_100%)] pointer-events-none" />

          {/* ── Content ── */}
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <div className="text-center mb-20 space-y-4">
              <div className="text-sky-400 font-black text-xs uppercase tracking-normal">{tHow('tagline')}</div>
              <h2 className="text-3xl md:text-5xl font-bold text-white tracking-normal">{tHow('title')}</h2>
              <p className="text-slate-400 max-w-xl mx-auto text-base md:text-lg leading-relaxed">{tHow('desc')}</p>
            </div>

            <div className="flex justify-center mb-16">
              <div className="bg-white/5 p-1.5 rounded-2xl inline-flex border border-white/10 relative overflow-hidden group">
                <div className={`absolute inset-y-1.5 w-[calc(50%-6px)] bg-cta rounded-xl transition-all duration-500 ease-out z-0 ${activeFlow === 'contractor' ? 'rtl:translate-x-0 ltr:translate-x-0' : 'rtl:-translate-x-[100%] ltr:translate-x-[100%]'}`} />
                <button onClick={() => setActiveFlow('contractor')}
                  className={`relative z-10 px-6 md:px-10 py-3 md:py-3.5 text-sm font-black rounded-xl transition-all duration-300 ${activeFlow === 'contractor' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>
                  {tHow('contractors_tab')}
                </button>
                <button onClick={() => setActiveFlow('supplier')}
                  className={`relative z-10 px-6 md:px-10 py-3 md:py-3.5 text-sm font-black rounded-xl transition-all duration-300 ${activeFlow === 'supplier' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>
                  {tHow('suppliers_tab')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 lg:gap-12 relative" key={activeFlow}>

              {/* Dashed connectors — extend close to step icons */}
              <div className="hidden md:block absolute top-10 left-[17%] w-[16%] h-px pointer-events-none z-0" style={{ background: 'repeating-linear-gradient(90deg, rgba(56,189,248,0.5) 0px, rgba(56,189,248,0.5) 8px, transparent 8px, transparent 14px)' }} />
              <div className="hidden md:block absolute top-10 left-[42%] w-[16%] h-px pointer-events-none z-0" style={{ background: 'repeating-linear-gradient(90deg, rgba(56,189,248,0.5) 0px, rgba(56,189,248,0.5) 8px, transparent 8px, transparent 14px)' }} />
              <div className="hidden md:block absolute top-10 left-[67%] w-[16%] h-px pointer-events-none z-0" style={{ background: 'repeating-linear-gradient(90deg, rgba(56,189,248,0.5) 0px, rgba(56,189,248,0.5) 8px, transparent 8px, transparent 14px)' }} />

              {activeSteps.map((s, i) => (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: i * 0.12, ease: "easeOut" }}
                  key={i}
                  className="flex flex-col items-center text-center space-y-6 group relative"
                >
                  {/* Step icon */}
                  <div className="relative z-10">
                    <svg className="absolute inset-[-6px] w-[calc(100%+12px)] h-[calc(100%+12px)] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg">
                      <ellipse cx="44" cy="44" rx="40" ry="40" fill="none" stroke="rgba(56,189,248,0.5)" strokeWidth="1.5" strokeDasharray="6 5" strokeLinecap="round" />
                    </svg>
                    <div className="w-20 h-20 rounded-[2.5rem] bg-white/[0.03] border border-white/10 flex items-center justify-center text-slate-300 relative group-hover:bg-cta group-hover:border-cta group-hover:text-white transition-all duration-500 z-10 shadow-xl group-hover:scale-110">
                      <s.icon size={36} />
                      <div className="absolute -top-3 rtl:-right-3 ltr:-left-3 w-8 h-8 rounded-full bg-cta text-white text-xs font-black flex items-center justify-center border-4 border-[#0F172A]">{s.step}</div>
                    </div>
                  </div>

                  <div className="space-y-3 z-10">
                    <h4 className="text-xl font-bold text-white group-hover:text-sky-400 transition-colors">{s.title}</h4>
                    <p className="text-slate-400 text-sm leading-relaxed px-4">{s.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>




        {/* PARTNERSHIP HIGHLIGHT - Depth Image */}
        <section className="relative py-24 md:py-40 overflow-hidden border-t border-white/5">
          <Image fill src="/images/loading-dock.jpg" alt="Partnership" className="absolute inset-0 w-full h-full object-cover grayscale opacity-30" sizes="100vw" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#020617] via-transparent to-[#020617]" />

          <div className="relative z-10 max-w-4xl mx-auto px-6 text-center space-y-8">
            <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-cta/10 border border-cta/20 text-sky-400 text-xs font-black uppercase tracking-normal">
              {tPartnership('tagline')}
            </div>
            <h2 className="text-3xl md:text-5xl lg:text-6xl font-bold text-white tracking-normal leading-[1.6]" dangerouslySetInnerHTML={{ __html: tPartnership.raw('title') }} />
            <p className="text-slate-400 text-base md:text-xl leading-relaxed font-medium">
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
        <section className="py-16 md:py-24 lg:py-32 relative bg-[#020617]">
          <div className="max-w-6xl mx-auto px-6">
            <div className="rounded-[3rem] md:rounded-[4rem] relative overflow-hidden border border-white/[0.08] bg-gradient-to-b from-[#0F172A]/80 to-[#020617]/90 backdrop-blur-xl p-8 md:p-16 lg:p-24 text-center">

              {/* Animated grid overlay */}
              <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(rgba(99,179,237,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,179,237,0.5) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

              {/* Glow orbs */}
              <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-cta/10 rounded-full blur-[150px] animate-pulse" />
              <div className="absolute -bottom-32 -left-32 w-[400px] h-[400px] bg-sky-500/8 rounded-full blur-[120px]" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[200px]" />

              {/* Floating accent pills */}
              <div className="absolute top-12 rtl:right-8 ltr:left-8 px-4 py-2 rounded-full bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm text-sky-400/60 text-[10px] font-black uppercase tracking-widest hidden md:block animate-float">
                <CheckCircle2 size={12} className="inline rtl:ml-2 ltr:mr-2 -mt-px" />
                {tCTA('vision')}
              </div>
              <div className="absolute bottom-12 rtl:left-8 ltr:right-8 px-4 py-2 rounded-full bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm text-sky-400/60 text-[10px] font-black uppercase tracking-widest hidden md:block animate-float" style={{ animationDelay: '2s' }}>
                <CheckCircle2 size={12} className="inline rtl:ml-2 ltr:mr-2 -mt-px" />
                {tCTA('no_fees')}
              </div>

              {/* Main content */}
              <div className="relative z-10 space-y-8 md:space-y-10">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cta/10 border border-cta/20 text-sky-400 text-[10px] font-black uppercase tracking-widest">
                  <Zap size={12} />
                  {tCTA('setup')}
                </div>

                <h2 className="text-3xl md:text-5xl lg:text-7xl font-black text-white leading-[1.2] md:leading-[1.15] tracking-tight" dangerouslySetInnerHTML={{ __html: tCTA.raw('title') }} />

                <p className="text-slate-400 max-w-xl mx-auto text-base md:text-lg leading-relaxed font-medium">
                  {tCTA('desc')}
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                  <Link href="/register" className="w-full sm:w-auto">
                    <Button className="w-full sm:w-auto h-14 md:h-16 px-10 md:px-12 text-base md:text-lg font-black rounded-2xl bg-white text-[#020617] hover:bg-sky-400 hover:text-white transition-all duration-300 hover:scale-[1.03] shadow-2xl shadow-white/10 group border-none">
                      {tCTA('register')}
                      <ArrowRight size={18} className="rtl:rotate-180 rtl:mr-2 ltr:ml-2 transition-transform group-hover:rtl:-translate-x-1 group-hover:ltr:translate-x-1" />
                    </Button>
                  </Link>
                  <Link href="/contact" className="w-full sm:w-auto">
                    <Button variant="outline" className="w-full sm:w-auto h-14 md:h-16 px-10 md:px-12 text-base md:text-lg font-black rounded-2xl border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-white/[0.02] backdrop-blur-md transition-all duration-300 hover:scale-[1.03]">
                      {tCTA('contact')}
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-16 md:py-24 bg-[#0F172A] border-t border-white/5">
          <div className="max-w-4xl mx-auto px-6">
            <div className="text-center mb-14 space-y-3">
              <div className="text-sky-400 font-black text-xs uppercase tracking-normal">{tFAQ('heading')}</div>
              <h2 className="text-3xl md:text-4xl font-bold text-white tracking-normal">{tFAQ('heading')}</h2>
              <p className="text-slate-400 max-w-xl mx-auto text-base leading-relaxed">{tFAQ('subtitle')}</p>
            </div>
            <div className="space-y-4">
              {[
                { q: tFAQ('q1'), a: tFAQ('a1') },
                { q: tFAQ('q2'), a: tFAQ('a2') },
                { q: tFAQ('q3'), a: tFAQ('a3') },
                { q: tFAQ('q4'), a: tFAQ('a4') },
                { q: tFAQ('q5'), a: tFAQ('a5') },
                { q: tFAQ('q6'), a: tFAQ('a6') },
              ].map((faq, i) => (
                <details key={i} className="group bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
                  <summary className="flex items-center justify-between p-6 cursor-pointer hover:bg-white/[0.04] transition-colors list-none">
                    <span className="text-white font-bold text-base md:text-lg pr-4">{faq.q}</span>
                    <span className="shrink-0 text-sky-400 text-xl group-open:rotate-45 transition-transform duration-300">+</span>
                  </summary>
                  <div className="px-6 pb-6">
                    <p className="text-slate-400 text-sm md:text-base leading-relaxed">{faq.a}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: [
                { '@type': 'Question', name: tFAQ('q1'), acceptedAnswer: { '@type': 'Answer', text: tFAQ('a1') } },
                { '@type': 'Question', name: tFAQ('q2'), acceptedAnswer: { '@type': 'Answer', text: tFAQ('a2') } },
                { '@type': 'Question', name: tFAQ('q3'), acceptedAnswer: { '@type': 'Answer', text: tFAQ('a3') } },
                { '@type': 'Question', name: tFAQ('q4'), acceptedAnswer: { '@type': 'Answer', text: tFAQ('a4') } },
                { '@type': 'Question', name: tFAQ('q5'), acceptedAnswer: { '@type': 'Answer', text: tFAQ('a5') } },
                { '@type': 'Question', name: tFAQ('q6'), acceptedAnswer: { '@type': 'Answer', text: tFAQ('a6') } },
              ],
            }),
          }}
        />

      </main>

      {/* FOOTER - Refined Structure */}
      <footer className="bg-[#020617] border-t border-white/5 py-16 md:py-24 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-10 md:gap-20 mb-12 md:mb-20 relative z-10">
          <div className="col-span-1 md:col-span-2 space-y-10">
            <Link href="/" className="flex items-center">
              <Image
                src="/logo1.png"
                alt={locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech'}
                width={140}
                height={48}
                className="h-10 w-auto object-contain"
              />
            </Link>
            <p className="text-slate-500 text-lg leading-relaxed max-w-sm font-medium">
              {tFooter('desc')}
            </p>
            <div className="flex flex-col items-start gap-6">
              <Link href="/contact" className="px-6 py-3 rounded-xl bg-white/5 font-bold text-sm text-slate-300 hover:text-sky-400 hover:bg-white/10 transition-all border border-white/5">
                {tFooter('support')}
              </Link>

              <div className="space-y-3">
                <h4 className="text-white font-black text-xs uppercase tracking-normal">{tFooter('address_title')}</h4>
                <div className="flex items-start gap-3 text-slate-400">
                  <MapPin size={18} className="mt-0.5 shrink-0 text-sky-400" />
                  <p className="text-sm font-medium leading-relaxed" dangerouslySetInnerHTML={{ __html: tFooter.raw('address_value') }} />
                </div>
                <div className="flex items-center gap-3 text-slate-400 pt-2">
                  <Phone size={18} className="shrink-0 text-emerald-400" />
                  <a href="https://wa.me/966550013416" target="_blank" rel="noopener noreferrer" className="text-sm font-bold leading-relaxed hover:text-white transition-colors" dir="ltr">
                    {tFooter('support_phone')}
                  </a>
                </div>
              </div>
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
        @keyframes scroll-x-logos-ltr {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes scroll-x-logos-rtl {
          0% { transform: translateX(0); }
          100% { transform: translateX(50%); }
        }
        .animate-scroll-x-logos-ltr {
          animation: scroll-x-logos-ltr 60s linear infinite;
          width: max-content;
          will-change: transform;
          backface-visibility: hidden;
        }
        .animate-scroll-x-logos-rtl {
          animation: scroll-x-logos-rtl 60s linear infinite;
          width: max-content;
          will-change: transform;
          backface-visibility: hidden;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0) translateZ(0); }
          50% { transform: translateY(-20px) translateZ(0); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
          will-change: transform;
          backface-visibility: hidden;
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
