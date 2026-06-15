"use client";

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Link } from "@/i18n/routing";
import { LandingChatWidget } from '@/components/rag/LandingChatWidget';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Building2, ShoppingCart, ArrowLeft, CheckCircle2, FileCheck,
  MapPin, Phone, Mail, Zap, ShieldCheck, Users, BarChart3,
  ChevronRight, Globe, ArrowRight, Truck, TrendingUp, X,
  Search, FileText, CheckCircle, AlertTriangle, Clock
} from 'lucide-react';
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useTranslations, useLocale } from 'next-intl';
import { cn } from "@/lib/utils";
import { motion, useTransform, animate, useMotionValue } from 'framer-motion';

function AnimatedStat({ value }: { value: string }) {
  const match = value.match(/^.*?(\d+)(.*)$/);
  if (!match) return <span>{value}</span>;
  const numValue = parseInt(match[1]);
  const suffix = match[2];
  const prefix = value.substring(0, match.index ?? 0);
  const count = useMotionValue(numValue);
  const rounded = useTransform(count, (latest) => Math.round(latest));
  const [hasAnimated, setHasAnimated] = useState(false);
  const display = useTransform(rounded, (latest) => `${prefix}${latest}${suffix}`);

  return (
    <motion.span
      onViewportEnter={() => {
        if (hasAnimated) return;
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduced) return;
        setHasAnimated(true);
        count.set(0);
        animate(count, numValue, { duration: 1.5, ease: "easeOut" });
      }}
      viewport={{ once: true, margin: "-50px" }}
    >
      {display}
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
  const tCompare = useTranslations('Landing.Comparison');
  const tLanding = useTranslations('Landing');
  const locale = useLocale();
  const heroSlides = [
    { img: '/images/warehouse-desk.jpg' },
    { img: '/images/construction-site.jpg' },
    { img: '/images/loading-dock.jpg' },
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
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? 'bg-[#0F172A]/80 backdrop-blur-xl border-b border-white/5 py-3' : 'bg-transparent py-5'}`}>
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
        <section className="relative h-screen min-h-[640px] md:min-h-[700px] flex flex-col">
          {/* Slides */}
          {heroSlides.map((s, i) => (
            <div key={i} className={`absolute inset-0 overflow-hidden transition-all duration-1500 ease-in-out ${i === slide ? 'opacity-100 scale-100' : 'opacity-0 scale-110'}`}>
              <Image fill src={s.img} alt="" className="w-full h-full object-cover object-center" sizes="100vw" priority={i === 0} loading={i === 0 ? undefined : "lazy"} />
              <div className={`absolute inset-0 ${locale === 'ar' ? 'bg-gradient-to-l' : 'bg-gradient-to-r'} from-[#020617] via-[#020617]/70 to-transparent`} />
              <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-[#020617]/30" />
            </div>
          ))}

          {/* Decorative Mesh */}
          <div className="absolute inset-0 z-[5] opacity-20 pointer-events-none overflow-hidden"
            style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>

          {/* Hero Text Content */}
          <div className="relative z-10 flex-1 flex items-center w-full max-w-7xl mx-auto px-6 pt-24 md:pt-16 pb-4 md:pb-0">
            <div className={`max-w-2xl space-y-6 animate-in fade-in duration-1000 ${locale === 'ar' ? 'slide-in-from-right-10' : 'slide-in-from-left-10'}`}>

              <h1 className={`text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight flex flex-col ${locale === 'ar' ? 'gap-0 md:gap-0 !leading-[1.4]' : 'gap-0 md:gap-1 !leading-[1.2]'}`}>
                <span className="whitespace-normal sm:whitespace-nowrap">{tHero('slide1_title')}</span>
                <span className={`text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-200 whitespace-normal sm:whitespace-nowrap ${locale === 'ar' ? '' : 'pb-2 md:pb-3'}`}>
                  {tHero('slide1_accent')}
                </span>
              </h1>

              <p className="text-slate-300 text-base md:text-lg font-medium max-w-xl !leading-[1.6]">
                {tHero('slide1_sub')}
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
                <Link href="/register" className="w-full sm:w-auto">
                  <Button className="w-full h-14 px-8 text-base font-black rounded-2xl bg-cta hover:bg-sky-600 text-white gap-3 transition-all hover:scale-105 shadow-2xl shadow-cta/30 border-none">
                    {tAction('register_now')} <ArrowLeft size={18} className="rtl:rotate-0 ltr:rotate-180" />
                  </Button>
                </Link>
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
            <div className="max-w-4xl mx-auto">
              <div className="grid grid-cols-3 gap-2 md:gap-6 w-full">
                {[
                  { val: tStats('response_val'), label: tStats('response_label'), icon: Clock },
                  { val: tStats('saving_70'), label: tStats('time_saving'), icon: Zap },
                  { val: tStats('improvement_15'), label: tStats('cost_improvement'), icon: TrendingUp },
                ].map((s, i) => (
                  <div key={i} className="shrink-0 bg-white/[0.03] backdrop-blur-md border border-white/5 rounded-xl md:rounded-2xl p-2.5 md:p-6 flex flex-col sm:flex-row items-center sm:items-start gap-1.5 md:gap-5 group hover:bg-white/[0.06] transition-all">
                    <div className="w-8 h-8 md:w-12 md:h-12 rounded-lg md:rounded-xl bg-cta/10 flex items-center justify-center text-sky-400 group-hover:scale-110 transition-transform shrink-0">
                      <s.icon size={16} className="md:size-6" />
                    </div>
                    <div className="flex flex-col justify-center min-w-0 items-center sm:items-start text-center sm:text-start">
                      <div className="text-sm md:text-xl font-black text-white leading-tight tracking-latin"><AnimatedStat value={s.val} /></div>
                      <div className="text-slate-500 text-[8px] md:text-[11px] font-bold uppercase tracking-normal mt-0.5 leading-tight">{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* EARLY PARTNERS LOGOS */}
        <section className="py-12 md:py-16 border-b border-white/5 bg-[#020617]">
          <div className="max-w-3xl mx-auto px-6 flex flex-col items-center gap-8">
            <div className="text-slate-400 text-xs font-black uppercase tracking-normal flex items-center gap-4">
              <div className="w-12 h-[1px] bg-white/10" />
              {tLanding('Partners')}
              <div className="w-12 h-[1px] bg-white/10" />
            </div>
            <div className="flex items-center justify-center gap-6 md:gap-10 flex-wrap">
              {[
                { src: '/images/logo-qudra.png', alt: 'Qudra' },
                { src: '/images/logo-naya.jpeg', alt: 'Naya' },
                { src: '/images/logo-itc.png', alt: 'ITC' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="relative flex items-center justify-center w-32 md:w-40 h-16 md:h-20 p-2 md:p-3 bg-white/5 rounded-xl border border-white/10"
                >
                  <Image
                    fill
                    src={item.src}
                    alt={item.alt}
                    className="object-contain p-2 opacity-60 hover:opacity-90 transition-opacity duration-300"
                    sizes="160px"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURES - Premium dark architecture */}
        <section id="features" className="relative bg-[#030712] overflow-hidden md:flex md:flex-col md:justify-center md:min-h-screen py-12 md:py-0">
          {/* Grid background */}
          <div
            className="absolute inset-0 pointer-events-none animate-grid-drift"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(56,189,248,0.08) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(56,189,248,0.08) 1px, transparent 1px)
              `,
              backgroundSize: '80px 80px',
            }}
          />
          {/* Subtle ambient glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-sky-500/[0.03] rounded-full blur-[120px] pointer-events-none" />
          {/* Top border line */}
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-sky-500/20 to-transparent" />
          {/* Bottom border line */}
          <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />

          <div className="max-w-7xl mx-auto px-6 relative z-10 w-full">
            {/* Centered Header */}
            <div className="text-center mb-8 md:mb-12 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-normal leading-[1.5] md:leading-[1.5]" dangerouslySetInnerHTML={{ __html: tFeatures.raw('title') }} />
              {/* Decorative line */}
              <div className="mt-8 flex items-center justify-center gap-3">
                <div className="h-px w-10 bg-gradient-to-r from-transparent to-sky-500/40" />
                <div className="w-1.5 h-1.5 rounded-full bg-sky-500/60" />
                <div className="h-px w-10 bg-gradient-to-l from-transparent to-sky-500/40" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
              {[
                { title: tFeatures('f1_title'), desc: tFeatures('f1_desc'), icon: ShieldCheck, gradient: "from-sky-500/20 to-blue-600/10", iconBg: "bg-sky-500/10 text-sky-400" },
                { title: tFeatures('f2_title'), desc: tFeatures('f2_desc'), icon: Zap, gradient: "from-amber-500/10 to-orange-600/5", iconBg: "bg-amber-500/10 text-amber-400" },
                { title: tFeatures('f3_title'), desc: tFeatures('f3_desc'), icon: BarChart3, gradient: "from-violet-500/10 to-purple-600/5", iconBg: "bg-violet-500/10 text-violet-400" }
              ].map((f, i) => (
                <motion.div
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.6, delay: i * 0.15, ease: "easeOut" }}
                  key={i}
                  className="group relative p-5 sm:p-7 md:p-10 rounded-3xl bg-[#080c18] border border-white/[0.04] hover:border-white/[0.08] transition-all duration-500 hover:-translate-y-1"
                >
                  {/* Gradient glow on hover */}
                  <div className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${f.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />
                  {/* Subtle top highlight */}
                  <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                  <div className="relative z-10">
                    {/* Icon with enhanced styling */}
                    <div className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl ${f.iconBg} flex items-center justify-center mb-5 md:mb-8 group-hover:scale-110 transition-transform duration-500 border border-white/5`}>
                      <f.icon size={26} strokeWidth={1.5} />
                    </div>

                    {/* Title */}
                    <h3 className="text-xl md:text-2xl font-bold text-white mb-4 group-hover:text-sky-300 transition-colors duration-300">
                      {f.title}
                    </h3>

                    {/* Description */}
                    <p className="text-slate-400 text-sm md:text-base leading-relaxed mb-8">
                      {f.desc}
                    </p>

                    {/* Learn more link */}
                    <div className="flex items-center gap-2 text-sky-400/80 text-xs font-bold uppercase tracking-wider group-hover:text-sky-400 transition-colors">
                      <span className="relative">
                        {tFeatures('learn_more')}
                        <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-sky-400 group-hover:w-full transition-all duration-300" />
                      </span>
                      <ArrowLeft size={14} className="rtl:rotate-0 ltr:rotate-180 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* WHY DIGITAL - Before & After Mdmak */}
        <section className="py-16 md:py-28 bg-[#020617] border-b border-white/5 relative overflow-hidden">

          {/* Split atmospheric gradients */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_70%_at_10%_55%,rgba(239,68,68,0.09),transparent_65%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_70%_at_90%_55%,rgba(14,165,233,0.11),transparent_65%)]" />
            <div className="absolute inset-0" style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px)',
              backgroundSize: '56px 56px',
              maskImage: 'radial-gradient(ellipse 80% 65% at 50% 50%,#000 20%,transparent 80%)',
            }} />
          </div>

          <div className="relative z-10 max-w-[1200px] mx-auto px-4 md:px-8">

            {/* ── Section header (centered) ── */}
            <div className="text-center mb-10 md:mb-14">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-slate-400 text-[11px] font-black uppercase tracking-widest mb-6"
              >
                {tCompare('tagline')}
              </motion.div>

              <motion.h2
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.08 }}
                className="text-[clamp(24px,4.5vw,56px)] font-extrabold leading-[1.22] text-white mb-5"
              >
                {tCompare('title_prefix')}{' '}
                <span className="bg-gradient-to-r from-sky-300 to-sky-500 bg-clip-text text-transparent font-black">{tCompare('title_highlight')}</span>
              </motion.h2>

            </div>

            {/* ── Cards grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[0.58fr_60px_1.42fr] items-start gap-8 lg:gap-0">

              {/* ── BEFORE ── */}
              <motion.div
                initial={{ opacity: 0, x: locale === 'ar' ? 24 : -24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.65, ease: "easeOut" }}
                className="flex flex-col relative lg:pe-10 max-w-[300px] sm:max-w-sm mx-auto lg:max-w-none lg:mx-0"
              >
                {/* Label row */}
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex items-center gap-[6px] h-8 px-4 rounded-full font-bold text-xs bg-red-500/10 border border-red-500/25 text-red-300 shrink-0">
                    <X size={11} strokeWidth={3.2} />
                    {tCompare('before_label')}
                  </span>
                  <div className="leading-tight">
                    <p className="text-sm font-bold text-slate-200">{tCompare('before_title')}</p>
                    <p className="text-[11px] text-red-400/60 mt-0.5">{tCompare('before_subtitle')}</p>
                  </div>
                </div>

                {/* Chat window — red tinted */}
                <div className="flex flex-col rounded-2xl overflow-hidden bg-gradient-to-b from-[#140d0d] to-[#0d0909] border border-red-500/[0.14] shadow-[0_0_56px_-16px_rgba(239,68,68,0.22),0_36px_80px_-42px_rgba(0,0,0,.9)]">
                  {/* Title bar */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-red-500/[0.08] bg-red-500/[0.03]">
                    <div className="flex gap-[5px]">
                      <span className="block w-[9px] h-[9px] rounded-full bg-red-400/55" />
                      <span className="block w-[9px] h-[9px] rounded-full bg-yellow-400/55" />
                      <span className="block w-[9px] h-[9px] rounded-full bg-green-400/55" />
                    </div>
                    <div className="ms-auto flex items-center gap-[8px]">
                      <div className="text-end leading-[1.25]">
                        <b className="block text-[11px] font-bold text-slate-400">{tCompare('chat_group')}</b>
                        <small className="block text-[8.5px] text-slate-600">{tCompare('chat_members')} · {tCompare('chat_typing')}</small>
                      </div>
                      <span className="w-[22px] h-[22px] rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400/80 shrink-0">
                        <Users size={12} />
                      </span>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex flex-col gap-[7px] p-[12px_11px] bg-[radial-gradient(circle_at_20%_0%,rgba(248,113,113,.06),transparent_60%)]">
                    <div className="self-start max-w-[78%] py-[6px] px-[10px] rounded-[11px] rounded-tr-[3px] bg-white/[0.04] border border-white/[0.06] text-slate-400 text-[11px] leading-[1.5]">
                      <span className="block text-[9px] font-bold mb-[2px] text-[#f0a3a3]">{tCompare('chat_msg1_sender')}</span>
                      {tCompare('chat_msg1_text')}
                      <span className="flex gap-[5px] mt-[4px] text-[8.5px] text-slate-600">{tCompare('chat_msg1_time')}</span>
                    </div>
                    <div className="self-end max-w-[78%] py-[6px] px-[10px] rounded-[11px] rounded-tl-[3px] bg-green-500/[0.05] border border-green-500/10 text-slate-400 text-[11px] leading-[1.5]">
                      {tCompare('chat_msg2_text')}
                      <span className="flex gap-[5px] mt-[4px] text-[8.5px] text-slate-600">{tCompare('chat_msg2_time')}</span>
                    </div>
                    <div className="self-start max-w-[78%] py-[6px] px-[10px] rounded-[11px] rounded-tr-[3px] bg-white/[0.04] border border-white/[0.06] text-slate-400 text-[11px] leading-[1.5]">
                      <span className="block text-[9px] font-bold mb-[2px] text-[#e9c46a]">{tCompare('chat_msg3_sender')}</span>
                      {tCompare('chat_msg3_text')}
                      <span className="flex gap-[5px] mt-[4px] text-[8.5px] text-slate-600">{tCompare('chat_msg3_time')}</span>
                    </div>
                    <div className="self-start inline-flex items-center gap-2 text-[10px] text-red-400/80 font-semibold bg-red-500/[0.07] border border-red-500/[0.16] px-[9px] py-[5px] rounded-[8px]">
                      <Phone size={11} />
                      {tCompare('chat_missed')}
                    </div>
                    <div className="self-end max-w-[78%] py-[6px] px-[10px] rounded-[11px] rounded-tl-[3px] bg-green-500/[0.05] border border-green-500/10 text-slate-400 text-[11px] leading-[1.5]">
                      {tCompare('chat_msg4_text')}
                      <span className="flex gap-[5px] mt-[4px] text-[8.5px] text-slate-600">{tCompare('chat_msg4_time')}</span>
                    </div>
                  </div>

                  {/* Chat footer */}
                  <div className="flex items-center gap-[7px] px-[11px] py-[8px] border-t border-red-500/[0.06] bg-red-500/[0.02]">
                    <span className="flex-1 h-[26px] rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center px-[11px] text-[10.5px] text-slate-600">
                      {tCompare('chat_placeholder')}
                    </span>
                    <span className="w-[26px] h-[26px] rounded-full bg-white/[0.05] flex items-center justify-center text-slate-500 shrink-0">
                      <ArrowRight size={13} className={cn(locale === 'ar' && "rtl-flip")} />
                    </span>
                  </div>
                </div>

                {/* Problem chips — inline on mobile */}
                <div className="flex flex-wrap gap-2 mt-4 lg:hidden">
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-red-500/[0.08] border border-red-500/20 text-red-300 text-xs font-bold">
                    <AlertTriangle size={12} className="text-red-400 shrink-0" />
                    {tCompare('problem_chip1')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-red-500/[0.08] border border-red-500/20 text-red-300 text-xs font-bold">
                    <X size={12} className="text-red-400 shrink-0" />
                    {tCompare('problem_chip2')}
                  </span>
                </div>

                {/* Floating chips (desktop only) */}
                <motion.span
                  animate={{ y: 7 }}
                  transition={{ duration: 3.4, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: 0 }}
                  style={{ willChange: "transform" }}
                  className="absolute top-[34px] [inset-inline-end:6px] lg:[inset-inline-end:-14px] z-[4] hidden lg:inline-flex items-center gap-[7px] text-[11.5px] font-bold text-[#fde2e2] bg-[rgba(40,16,20,.88)] border border-red-500/30 backdrop-blur-[8px] px-3 py-[7px] rounded-[11px] shadow-[0_14px_30px_-14px_rgba(0,0,0,.8)]"
                >
                  <AlertTriangle size={13} className="text-red-400 shrink-0" />
                  {tCompare('problem_chip1')}
                </motion.span>
                <motion.span
                  animate={{ y: -8 }}
                  transition={{ duration: 3.8, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: 1.4 }}
                  style={{ willChange: "transform" }}
                  className="absolute bottom-[62px] [inset-inline-start:6px] lg:[inset-inline-start:-16px] z-[4] hidden lg:inline-flex items-center gap-[7px] text-[11.5px] font-bold text-[#fde2e2] bg-[rgba(40,16,20,.88)] border border-red-500/30 backdrop-blur-[8px] px-3 py-[7px] rounded-[11px] shadow-[0_14px_30px_-14px_rgba(0,0,0,.8)]"
                >
                  <X size={13} className="text-red-400 shrink-0" />
                  {tCompare('problem_chip2')}
                </motion.span>
              </motion.div>

              {/* ── VS CONNECTOR (desktop only) ── */}
              <div className="hidden lg:flex flex-col items-center justify-center self-stretch gap-0 pt-[52px]">
                <div className="flex-1 w-px bg-gradient-to-b from-transparent via-white/[0.07] to-transparent" />
                <motion.div
                  animate={{ y: [0, 4, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  className="my-3 w-8 h-8 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center"
                >
                  <ArrowRight size={15} className={cn("text-sky-400", locale === 'ar' && "rtl-flip")} />
                </motion.div>
                <div className="flex-1 w-px bg-gradient-to-b from-transparent via-white/[0.07] to-transparent" />
              </div>

              {/* ── AFTER ── */}
              <motion.div
                initial={{ opacity: 0, x: locale === 'ar' ? -24 : 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.65, delay: 0.1, ease: "easeOut" }}
                className="flex flex-col relative lg:ps-10 max-w-[300px] sm:max-w-sm mx-auto lg:max-w-none lg:mx-0"
              >
                {/* Label row */}
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex items-center gap-[6px] h-8 px-4 rounded-full font-bold text-xs bg-sky-500/10 border border-sky-500/30 text-sky-300 shadow-[0_0_18px_-7px_rgba(56,189,248,0.55)] shrink-0">
                    <CheckCircle size={12} strokeWidth={3.2} />
                    {tCompare('after_label')}
                  </span>
                  <div className="leading-tight">
                    <p className="text-sm font-bold text-white">{tCompare('after_title')}</p>
                    <p className="text-[11px] text-sky-400/70 mt-0.5">{tCompare('after_subtitle')}</p>
                  </div>
                </div>

                {/* Browser window — teal themed */}
                <div className="relative flex flex-col rounded-2xl overflow-hidden bg-[#060d1c] border border-sky-500/[0.22] shadow-[0_0_80px_-18px_rgba(14,165,233,0.38),0_44px_100px_-42px_rgba(0,0,0,.92)]">
                  {/* Browser bar */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-sky-500/[0.08] bg-gradient-to-b from-[rgba(12,22,44,.98)] to-[rgba(6,13,28,.98)]">
                    <div className="flex gap-[6px] shrink-0">
                      <span className="block w-[11px] h-[11px] rounded-full bg-red-400/55" />
                      <span className="block w-[11px] h-[11px] rounded-full bg-yellow-400/55" />
                      <span className="block w-[11px] h-[11px] rounded-full bg-green-400/55" />
                    </div>
                    <div className="flex-1 flex items-center justify-center gap-2 h-[28px] mx-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-slate-400 text-xs font-medium">
                      <ShieldCheck size={12} className="text-green-400 shrink-0" />
                      mdmaktech.sa
                    </div>
                    <div className="flex items-center gap-[6px] text-[10px] text-green-400 font-bold tracking-[.05em] shrink-0">
                      <span className="block w-[6px] h-[6px] rounded-full bg-green-400 shadow-[0_0_8px_#4ade80] animate-pulse" />
                      LIVE
                    </div>
                  </div>
                  {/* Platform screenshot */}
                  <div className="leading-[0]">
                    <Image
                      src="/images/platform-comparison.png"
                      alt={tCompare('screenshot_alt')}
                      width={1706}
                      height={848}
                      className="block w-full h-auto"
                    />
                  </div>
                </div>

                {/* Value chips — inline on mobile */}
                <div className="flex flex-wrap gap-2 mt-4 lg:hidden">
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-green-500/[0.08] border border-green-500/20 text-green-300 text-xs font-bold">
                    <CheckCircle size={12} className="text-green-400 shrink-0" />
                    {tCompare('value_chip1_title')} · {tCompare('value_chip1_sub')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-sky-500/[0.08] border border-sky-500/20 text-sky-300 text-xs font-bold">
                    <Clock size={12} className="text-sky-400 shrink-0" />
                    {tCompare('value_chip2_title')} · {tCompare('value_chip2_sub')}
                  </span>
                </div>

                {/* Floating chips (desktop only) */}
                <motion.span
                  animate={{ y: -8 }}
                  transition={{ duration: 3.2, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: 0.8 }}
                  style={{ willChange: "transform" }}
                  className="absolute top-[66px] [inset-inline-end:6px] lg:[inset-inline-end:-22px] z-[4] hidden lg:inline-flex items-center gap-2 px-[14px] py-[9px] rounded-[12px] text-[13px] font-bold text-white bg-[rgba(5,12,26,.9)] border border-sky-500/30 backdrop-blur-[10px] shadow-[0_16px_36px_-16px_rgba(0,0,0,.85)]"
                >
                  <span className="w-6 h-6 rounded-[7px] flex items-center justify-center shrink-0 bg-green-500/[0.14] border border-green-500/30 text-green-400">
                    <CheckCircle size={13} strokeWidth={2.4} />
                  </span>
                  <span>
                    {tCompare('value_chip1_title')}
                    <small className="block text-[10.5px] font-semibold text-slate-400 mt-[1px]">{tCompare('value_chip1_sub')}</small>
                  </span>
                </motion.span>
                <motion.span
                  animate={{ y: 7 }}
                  transition={{ duration: 3.6, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: 2.2 }}
                  style={{ willChange: "transform" }}
                  className="absolute bottom-[30px] [inset-inline-end:6px] lg:[inset-inline-end:-18px] z-[4] hidden lg:inline-flex items-center gap-2 px-[14px] py-[9px] rounded-[12px] text-[13px] font-bold text-white bg-[rgba(5,12,26,.9)] border border-sky-500/30 backdrop-blur-[10px] shadow-[0_16px_36px_-16px_rgba(0,0,0,.85)]"
                >
                  <span className="w-6 h-6 rounded-[7px] flex items-center justify-center shrink-0 bg-sky-500/[0.14] border border-sky-500/30 text-sky-300">
                    <Clock size={13} strokeWidth={2.2} />
                  </span>
                  <span>
                    {tCompare('value_chip2_title')}
                    <small className="block text-[10.5px] font-semibold text-slate-400 mt-[1px]">{tCompare('value_chip2_sub')}</small>
                  </span>
                </motion.span>
              </motion.div>

            </div>

          </div>
        </section>

        {/* CONTRACTOR EXPERIENCE — device-mockup redesign */}
        <section className="relative bg-[#020617] border-y border-white/5 py-14 sm:py-20 lg:py-[110px] overflow-hidden">

          {/* Ambient glows */}
          <div aria-hidden className="absolute -top-40 -start-28 w-[620px] h-[620px] rounded-full bg-[#0369A1]/20 blur-[140px] pointer-events-none" />
          <div aria-hidden className="absolute -bottom-48 -end-20 w-[520px] h-[520px] rounded-full bg-sky-400/10 blur-[140px] pointer-events-none" />

          {/* Dot grid */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-50"
            style={{
              backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(148,163,184,.16) 1px, transparent 0)',
              backgroundSize: '42px 42px',
              WebkitMaskImage: 'radial-gradient(ellipse 90% 80% at 50% 45%, #000 30%, transparent 85%)',
              maskImage: 'radial-gradient(ellipse 90% 80% at 50% 45%, #000 30%, transparent 85%)',
            }}
          />

          {/* Corner geometry — desktop only */}
          <div aria-hidden className="absolute -top-10 end-0 opacity-40 pointer-events-none hidden lg:block">
            {[
              'w-[150px] h-[120px] top-0 left-0',
              'w-[150px] h-[120px] top-[90px] left-[120px] opacity-70',
              'w-[110px] h-[90px] top-[18px] left-[200px] opacity-50',
            ].map((cls, i) => (
              <span
                key={i}
                className={cn('absolute block rounded-[18px] border border-white/[0.04]', cls)}
                style={{ transform: 'skewX(-22deg)', background: 'linear-gradient(135deg, rgba(56,189,248,.07), rgba(56,189,248,0))' }}
              />
            ))}
          </div>

          <div className="relative z-10 max-w-[1240px] mx-auto px-5 sm:px-8 md:px-10">
            <div className="grid grid-cols-1 lg:grid-cols-[0.84fr_1.16fr] items-center gap-10 sm:gap-14 lg:gap-14" dir="ltr">

              {/* TEXT COLUMN */}
              <motion.div
                initial={{ opacity: 0, x: -24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="text-right"
                dir="rtl"
              >
                {/* Tagline */}
                <div className="inline-flex items-center gap-3 mb-5 sm:mb-7">
                  <span className="w-[34px] h-px bg-sky-400/60" />
                  <span className="text-[11px] sm:text-[11.5px] font-extrabold text-sky-400 uppercase tracking-[.18em]">
                    {tContractor('tagline')}
                  </span>
                </div>

                {/* Title */}
                <h2
                  className="text-[26px] sm:text-[32px] lg:text-[clamp(32px,3.4vw,46px)] font-extrabold text-white leading-[1.45] tracking-tight mb-4 sm:mb-6 [&>span]:bg-gradient-to-r [&>span]:from-sky-400 [&>span]:to-sky-200 [&>span]:bg-clip-text [&>span]:text-transparent"
                  dangerouslySetInnerHTML={{ __html: tContractor.raw('title') }}
                />

                {/* Description */}
                <p className="text-[15px] sm:text-[16.5px] leading-[1.8] sm:leading-[1.85] text-slate-400 mb-6 sm:mb-8 max-w-[480px] ms-auto lg:ms-0">
                  {tContractor('desc')}
                </p>

                {/* Feature pills */}
                <div className="flex flex-wrap gap-2 sm:gap-2.5 mb-7 sm:mb-9 justify-end lg:justify-start">
                  {[tContractor('network'), tContractor('comparison'), tContractor('savings'), tContractor('reports')].map((item, i) => (
                    <div key={i} className="inline-flex items-center gap-1.5 sm:gap-2 text-slate-300 text-[12px] sm:text-[13px] font-semibold bg-white/[0.03] border border-white/[0.07] px-3 sm:px-4 py-2 sm:py-[9px] rounded-full">
                      <CheckCircle2 size={13} className="text-sky-400 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <div className="flex items-center gap-4 flex-wrap justify-end lg:justify-start">
                  <Link href="/register?role=Contractor">
                    <Button className="group h-12 sm:h-[54px] px-6 sm:px-8 text-[14.5px] sm:text-[15.5px] font-extrabold rounded-[13px] sm:rounded-[15px] bg-cta hover:bg-sky-500 text-white transition-all shadow-[0_18px_40px_-16px_rgba(3,105,161,.7)] hover:shadow-[0_22px_48px_-16px_rgba(14,165,233,.7)] hover:-translate-y-0.5">
                      {tContractor('cta')}
                      <ArrowLeft size={15} className="rtl:mr-2 ltr:ml-2 rtl:rotate-0 ltr:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
                    </Button>
                  </Link>
                </div>
              </motion.div>

              {/* DEVICE COLUMN */}
              <motion.div
                initial={{ opacity: 0, x: 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.65, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="relative flex justify-center items-center"
              >
                {/* Stage — height scales per breakpoint, chips need room at bottom */}
                <div className="relative w-full max-w-[500px] sm:max-w-[580px] lg:max-w-[660px] flex justify-center items-center h-[240px] sm:h-[360px] lg:h-[520px]">

                  {/* Floating stat chip — top: hidden on mobile, inside bounds on sm+ */}
                  <motion.div
                    animate={{ y: -10 }}
                    transition={{ duration: 2, repeat: Infinity, repeatType: 'mirror', ease: [0.37, 0, 0.63, 1] }}
                    className="hidden sm:flex absolute top-2 start-0 lg:start-[-12px] z-10 items-center gap-2.5 sm:gap-3 px-3 sm:px-[15px] py-2 sm:py-[11px] rounded-xl sm:rounded-[14px] border border-sky-400/[0.28] backdrop-blur-md"
                    style={{ background: 'rgba(5,12,26,.82)', boxShadow: '0 18px 40px -18px rgba(0,0,0,.85)', willChange: 'transform' }}
                    dir="rtl"
                  >
                    <span className="w-7 h-7 sm:w-[34px] sm:h-[34px] rounded-[8px] sm:rounded-[10px] flex items-center justify-center shrink-0 border border-emerald-500/30 bg-emerald-500/[0.16]">
                      <TrendingUp size={14} className="text-emerald-400" />
                    </span>
                    <span>
                      <b className="block text-sm sm:text-base font-black text-white leading-none tracking-wide">90%</b>
                      <small className="block text-[10px] sm:text-[11px] font-semibold text-slate-400 mt-0.5">{tContractor('stat_compliance')}</small>
                    </span>
                  </motion.div>

                  {/* Floating stat chip — bottom: hidden on mobile */}
                  <motion.div
                    animate={{ y: 10 }}
                    transition={{ duration: 2.4, repeat: Infinity, repeatType: 'mirror', ease: [0.37, 0, 0.63, 1] }}
                    className="hidden sm:flex absolute bottom-4 lg:bottom-6 start-0 lg:start-[-26px] z-10 items-center gap-2.5 sm:gap-3 px-3 sm:px-[15px] py-2 sm:py-[11px] rounded-xl sm:rounded-[14px] border border-sky-400/[0.28] backdrop-blur-md"
                    style={{ background: 'rgba(5,12,26,.82)', boxShadow: '0 18px 40px -18px rgba(0,0,0,.85)', willChange: 'transform' }}
                    dir="rtl"
                  >
                    <span className="w-7 h-7 sm:w-[34px] sm:h-[34px] rounded-[8px] sm:rounded-[10px] flex items-center justify-center shrink-0 border border-sky-400/30 bg-sky-400/[0.14]">
                      <BarChart3 size={14} className="text-sky-400" />
                    </span>
                    <span>
                      <b className="block text-sm sm:text-base font-black text-white leading-none tracking-wide">15%</b>
                      <small className="block text-[10px] sm:text-[11px] font-semibold text-slate-400 mt-0.5">{tContractor('stat_performance')}</small>
                    </span>
                  </motion.div>

                  {/* Laptop — scales at each breakpoint */}
                  <div className="relative z-[2] w-[82%] sm:w-[420px] lg:w-[560px]">
                    {/* Lid */}
                    <div
                      className="relative rounded-[14px] sm:rounded-[18px] lg:rounded-[20px] p-[7px] sm:p-[9px] lg:p-[11px]"
                      style={{
                        background: 'linear-gradient(160deg,#26334a,#0f1726)',
                        boxShadow: '0 2px 0 rgba(255,255,255,.06) inset, 0 40px 90px -34px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.05)',
                      }}
                    >
                      <div className="relative rounded-[8px] sm:rounded-[10px] lg:rounded-[11px] overflow-hidden bg-[#020617] leading-none" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,.6) inset' }}>
                        <Image
                          src="/images/contractor-desktop.png"
                          alt={tContractor('screen_alt_desktop')}
                          width={1280}
                          height={800}
                          className="block w-full h-auto"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(115deg, rgba(255,255,255,.05), rgba(255,255,255,0) 26%)' }} />
                      </div>
                    </div>
                    {/* Base / deck */}
                    <div
                      className="relative mt-[-2px] rounded-b-[10px] lg:rounded-b-[14px]"
                      style={{
                        width: '118%', left: '-9%',
                        height: '10px',
                        background: 'linear-gradient(180deg,#aeb8c6 0%,#7e8a9b 55%,#5d6678 100%)',
                        boxShadow: '0 18px 30px -14px rgba(0,0,0,.8)',
                      }}
                    >
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80px] sm:w-[100px] lg:w-[120px] h-[6px] sm:h-[7px] lg:h-2 rounded-b-[7px] lg:rounded-b-[9px]" style={{ background: 'linear-gradient(180deg,#4a5160,#3a414e)' }} />
                      <div className="absolute top-[2px] left-[6%] right-[6%] h-px" style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent)' }} />
                    </div>
                  </div>

                  {/* Phone — scales at each breakpoint, always absolute-overlapping */}
                  <motion.div
                    animate={{ y: 8 }}
                    transition={{ duration: 2.8, repeat: Infinity, repeatType: 'mirror', ease: [0.37, 0, 0.63, 1] }}
                    className="absolute z-[4]
                      end-[2%] bottom-[-14px] w-[72px] h-[148px] rounded-[18px] p-[4px]
                      sm:end-[1%] sm:bottom-[-28px] sm:w-[116px] sm:h-[242px] sm:rounded-[26px] sm:p-[5px]
                      lg:end-[-6px] lg:bottom-[-46px] lg:w-[188px] lg:h-[392px] lg:rounded-[34px] lg:p-2"
                    style={{
                      background: 'linear-gradient(160deg,#2a3346,#0d1422)',
                      boxShadow: '0 0 0 1px rgba(255,255,255,.06), 0 36px 70px -26px rgba(0,0,0,.92)',
                    }}
                  >
                    {/* notch */}
                    <div className="absolute top-[5px] sm:top-[7px] lg:top-[9px] left-1/2 -translate-x-1/2 w-[32px] sm:w-[44px] lg:w-[54px] h-[8px] sm:h-[11px] lg:h-[15px] rounded-full bg-[#05080f] z-[3]" />
                    <div className="relative w-full h-full rounded-[15px] sm:rounded-[22px] lg:rounded-[27px] overflow-hidden bg-[#0a1530] leading-none">
                      <Image
                        src="/images/contractor-mobile.png"
                        alt={tContractor('screen_alt_mobile')}
                        width={390}
                        height={844}
                        className="block w-full h-full object-cover object-top"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(120deg,rgba(255,255,255,.12),rgba(255,255,255,0) 30%)' }} />
                    </div>
                  </motion.div>

                </div>
              </motion.div>

            </div>
          </div>
        </section>

        {/* SUPPLIER EXPERIENCE */}
        <section className="relative bg-[#020617] py-16 lg:py-[72px]">

          {/* Mesh atmosphere — clipped inside section */}
          <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-[22%] -start-[8%]  w-[58%] h-[78%] rounded-full blur-[150px] bg-teal-500/[0.12]" />
            <div className="absolute top-[18%]  -end-[14%]   w-[52%] h-[66%] rounded-full blur-[130px] bg-sky-400/[0.10]" />
            <div className="absolute -bottom-[18%] start-[28%] w-[46%] h-[56%] rounded-full blur-[120px] bg-indigo-600/[0.06]" />
          </div>

          {/* Dot grid */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-[0.22]"
            style={{ backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.25) 1px, transparent 1px)', backgroundSize: '34px 34px' }}
          />

          {/* Edge fades */}
          <div aria-hidden className="absolute inset-x-0 top-0    h-[140px] bg-gradient-to-b from-[#020617] to-transparent pointer-events-none" />
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-[140px] bg-gradient-to-t from-[#020617] to-transparent pointer-events-none" />

          <div className="max-w-7xl mx-auto px-5 md:px-16 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)] items-center gap-12 lg:gap-10">

              {/* LEFT — copy */}
              <motion.div
                initial={{ opacity: 0, x: locale === 'ar' ? 30 : -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* Tagline chip */}
                <div className="inline-flex items-center gap-2 mb-6 px-[15px] py-[7px] rounded-full bg-teal-500/[0.08] border border-teal-500/[0.22]">
                  <ShoppingCart size={13} className="text-teal-400 shrink-0" />
                  <span className="text-[11.5px] font-extrabold text-teal-300 uppercase tracking-[.22em] whitespace-nowrap">{tSupplier('tagline')}</span>
                </div>

                {/* h2 — gradient applied to inner <span> via arbitrary variant */}
                <h2
                  className="m-0 mb-5 text-[28px] md:text-[36px] lg:text-[47px] font-extrabold leading-[1.13] tracking-tight text-white [&>span]:bg-gradient-to-r [&>span]:from-sky-400 [&>span]:to-teal-300 [&>span]:bg-clip-text [&>span]:text-transparent"
                  dangerouslySetInnerHTML={{ __html: tSupplier.raw('title') }}
                />

                {/* desc */}
                <p className="mt-0 mb-8 text-base lg:text-[16.5px] leading-relaxed text-slate-400 max-w-[430px]">
                  {tSupplier('desc')}
                </p>

                {/* 2×2 compact feature grid — icon + label only */}
                <div className="grid grid-cols-2 gap-x-[22px] gap-y-[18px] mb-9">
                  {([
                    { icon: Globe,       label: tSupplier('access'),   accent: 'teal' },
                    { icon: FileCheck,   label: tSupplier('digital'),  accent: 'sky'  },
                    { icon: Truck,       label: tSupplier('tracking'), accent: 'teal' },
                    { icon: ShieldCheck, label: tSupplier('rating'),   accent: 'sky'  },
                  ] as const).map((f, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className={cn(
                        'shrink-0 grid place-items-center w-[38px] h-[38px] rounded-[11px]',
                        f.accent === 'teal'
                          ? 'text-teal-400 bg-teal-500/[0.10] shadow-[inset_0_0_0_1px_rgba(20,184,166,0.22)]'
                          : 'text-sky-400 bg-sky-500/[0.10] shadow-[inset_0_0_0_1px_rgba(56,189,248,0.22)]'
                      )}>
                        <f.icon size={19} />
                      </span>
                      <span className="text-[14.5px] font-bold text-white leading-tight">{f.label}</span>
                    </div>
                  ))}
                </div>

                {/* CTAs */}
                <div className="flex items-center gap-4 flex-wrap">
                  <Link href="/register?role=Supplier">
                    <Button className="group h-12 px-8 text-sm font-bold rounded-xl bg-cta hover:bg-sky-500 text-white border-none transition-all hover:shadow-lg hover:shadow-cta/20">
                      {tSupplier('cta')}
                      <ArrowLeft size={13} className="rtl:me-2 ltr:ms-2 rtl:rotate-0 ltr:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
                    </Button>
                  </Link>
                  <Link
                    href="#how"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors duration-200"
                  >
                    {tSupplier('ghost_cta')}
                    <ChevronRight size={14} className="rtl:rotate-180 opacity-60 shrink-0" />
                  </Link>
                </div>
              </motion.div>

              {/* RIGHT — product proof */}
              <motion.div
                initial={{ opacity: 0, x: locale === 'ar' ? -30 : 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                className="relative flex items-center justify-center min-h-[220px] sm:min-h-[380px] lg:min-h-[560px]"
              >
                {/* Browser frame wrapper — status pill anchors to this */}
                <div className="relative w-full max-w-[580px]">

                  {/* macOS-style browser chrome */}
                  <div
                    className="rounded-[14px] overflow-hidden"
                    style={{ background: '#0b1220', boxShadow: '0 50px 100px -34px rgba(3,8,22,0.92), inset 0 0 0 1px rgba(255,255,255,0.09)' }}
                  >
                    {/* Title bar */}
                    <div
                      className="flex items-center gap-[7px] px-[13px] py-[9px]"
                      style={{ background: '#111c2e', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <span className="w-[10px] h-[10px] rounded-full bg-[#ff5f57] shrink-0" />
                      <span className="w-[10px] h-[10px] rounded-full bg-[#febc2e] shrink-0" />
                      <span className="w-[10px] h-[10px] rounded-full bg-[#28c840] shrink-0" />
                      <div className="flex-1 flex justify-center">
                        <span
                          className="text-[11px] font-semibold text-slate-500 px-4 py-1 rounded-full"
                          style={{ background: 'rgba(255,255,255,0.05)', letterSpacing: '.01em' }}
                        >
                          app.mdmaktech.sa/suppliers
                        </span>
                      </div>
                    </div>

                    {/* Dashboard screenshot */}
                    <Image
                      src="/images/supplier-desktop-clean.png"
                      alt={tSupplier('dashboard_alt')}
                      width={580}
                      height={380}
                      className="block w-full h-auto"
                      priority={false}
                    />
                  </div>

                  {/* Status pill — top-end of browser frame */}
                  <div
                    className="absolute top-[54px] end-4 inline-flex items-center gap-2 px-3 py-[7px] rounded-full z-[5]"
                    style={{ background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(8px)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)' }}
                  >
                    <span className="w-[7px] h-[7px] rounded-full bg-emerald-400 shrink-0" />
                    <span className="text-[12px] font-bold text-white">{tSupplier('dashboard_caption')}</span>
                  </div>
                </div>

                {/* Phone frame — floating bottom-start */}
                <div className="absolute -bottom-[2%] -start-[3%] z-[6]">
                  <div
                    className="p-[5px] rounded-[24px]"
                    style={{
                      width: 150,
                      background: 'linear-gradient(160deg, #1e293b, #0b1220)',
                      boxShadow: '0 34px 70px -22px rgba(3,8,22,0.85), inset 0 0 0 1px rgba(255,255,255,0.08)',
                    }}
                  >
                    <div className="rounded-[19px] overflow-hidden bg-white">
                      <Image
                        src="/images/supplier-mobile-clean.png"
                        alt="Mdmak supplier mobile app"
                        width={140}
                        height={280}
                        className="block w-full h-auto"
                        priority={false}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>



        {/* HOW IT WORKS - Step Architecture */}
        <section id="how" className="py-16 md:py-24 lg:py-32 relative bg-[#0F172A] overflow-hidden">

          {/* Pencil drawing overlay */}
          <div
            aria-hidden="true"
            className="absolute inset-0 w-full h-full pointer-events-none select-none"
            style={{
              backgroundImage: 'url(/pencilbg.png)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'invert(1) contrast(1.2)',
              opacity: 0.06,
              mixBlendMode: 'screen',
            }}
          />

          {/* Soft vignette so content stays readable */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_50%,transparent_30%,rgba(15,23,42,0.65)_100%)] pointer-events-none" />

          {/* ── Content ── */}
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <div className="text-center mb-10 md:mb-20 space-y-4">
              <div className="text-sky-400 font-black text-xs uppercase tracking-normal">{tHow('tagline')}</div>
              <h2 className="text-3xl md:text-5xl font-bold text-white tracking-normal">{tHow('title')}</h2>
              <p className="text-slate-400 max-w-xl mx-auto text-base md:text-lg leading-relaxed">{tHow('desc')}</p>
            </div>

            <div className="flex justify-center mb-16">
              <div className="bg-white/5 p-1.5 rounded-2xl inline-flex border border-white/10 relative overflow-hidden group">
                <div className={`absolute left-1.5 inset-y-1.5 w-[calc(50%-6px)] bg-cta rounded-xl transition-all duration-500 ease-out z-0 ${locale === 'ar' ? (activeFlow === 'supplier' ? 'translate-x-0' : 'translate-x-full') : (activeFlow === 'contractor' ? 'translate-x-0' : 'translate-x-full')}`} />
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

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 md:gap-8 lg:gap-12 relative" key={activeFlow}>

              {/* Dashed connectors — extend close to step icons */}
              <div className="hidden md:block absolute top-10 start-[17%] w-[16%] h-px pointer-events-none z-0" style={{ background: 'repeating-linear-gradient(90deg, rgba(56,189,248,0.5) 0px, rgba(56,189,248,0.5) 8px, transparent 8px, transparent 14px)' }} />
              <div className="hidden md:block absolute top-10 start-[42%] w-[16%] h-px pointer-events-none z-0" style={{ background: 'repeating-linear-gradient(90deg, rgba(56,189,248,0.5) 0px, rgba(56,189,248,0.5) 8px, transparent 8px, transparent 14px)' }} />
              <div className="hidden md:block absolute top-10 start-[67%] w-[16%] h-px pointer-events-none z-0" style={{ background: 'repeating-linear-gradient(90deg, rgba(56,189,248,0.5) 0px, rgba(56,189,248,0.5) 8px, transparent 8px, transparent 14px)' }} />

              {activeSteps.map((s, i) => (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: i * 0.12, ease: "easeOut" }}
                  key={i}
                  className="flex flex-row sm:flex-col items-start sm:items-center text-start sm:text-center gap-5 sm:gap-0 sm:space-y-6 group relative"
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

                  <div className="space-y-2 z-10 flex-1 sm:flex-none">
                    <h4 className="text-base sm:text-xl font-bold text-white group-hover:text-sky-400 transition-colors">{s.title}</h4>
                    <p className="text-slate-400 text-sm leading-relaxed sm:px-4">{s.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>




        {/* TESTIMONIALS — commented out for now
        <section className="py-16 md:py-24 bg-[#020617] border-t border-white/5">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-12 space-y-3">
              <div className="text-sky-400 font-black text-xs uppercase tracking-normal">{tLanding('Testimonials')}</div>
              <h2 className="text-3xl md:text-4xl font-bold text-white tracking-normal">{tLanding('TestimonialsTitle')}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {[
                { text: tLanding('Testimonial1Text'), initial: tLanding('Testimonial1Initial'), name: tLanding('Testimonial1Name'), role: tLanding('Testimonial1Role') },
                { text: tLanding('Testimonial2Text'), initial: tLanding('Testimonial2Initial'), name: tLanding('Testimonial2Name'), role: tLanding('Testimonial2Role') },
              ].map((t, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.12 }}
                  className="bg-white/[0.03] border border-white/[0.07] rounded-3xl p-8 flex flex-col gap-6 hover:bg-white/[0.05] transition-colors"
                >
                  <div className="flex gap-1 text-amber-400 text-sm">{'★★★★★'}</div>
                  <p className="text-slate-300 text-base leading-relaxed flex-1">{t.text}</p>
                  <div className="flex items-center gap-4 pt-2 border-t border-white/[0.05]">
                    <div className="w-10 h-10 rounded-full bg-cta/20 border border-cta/30 flex items-center justify-center text-sky-400 font-bold text-base shrink-0" aria-hidden="true">
                      {t.initial}
                    </div>
                    <div>
                      <div className="text-white font-bold text-sm">{t.name}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{t.role}</div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
        */}

        {/* PARTNERSHIP HIGHLIGHT - Depth Image */}
        <section className="relative py-14 md:py-40 overflow-hidden border-t border-white/5">
          <Image fill src="/images/loading-dock.jpg" alt="Partnership" className="absolute inset-0 w-full h-full object-cover grayscale opacity-30" sizes="100vw" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#020617] via-transparent to-[#020617]" />

          <div className="relative z-10 max-w-4xl mx-auto px-6 text-center space-y-8">
            <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-cta/10 border border-cta/20 text-sky-400 text-xs font-black uppercase tracking-normal">
              {tPartnership('tagline')}
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-5xl lg:text-6xl font-bold text-white tracking-normal leading-[1.6]" dangerouslySetInnerHTML={{ __html: tPartnership.raw('title') }} />
            <p className="text-slate-400 text-base md:text-xl leading-relaxed font-medium">
              {tPartnership('desc')}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link href="/register">
                <Button className="h-12 md:h-16 px-8 md:px-12 text-base font-black rounded-2xl bg-cta hover:bg-sky-500 text-white border-none transition-all hover:scale-[1.02] shadow-xl shadow-cta/20">
                  {tPartnership('cta')}
                </Button>
              </Link>
              <Link href="/about">
                <Button variant="outline" className="h-12 md:h-16 px-8 md:px-12 text-base font-black rounded-2xl border-white/10 text-white hover:bg-white/5 transition-all">
                  {tFooter('l_about')}
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* CTA - Final Impact */}
        <section className="py-20 md:py-32 relative bg-[#020617] overflow-hidden">
          {/* Atmospheric background */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_0%,rgba(14,165,233,0.14),transparent_68%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_100%,rgba(15,23,42,0.9),transparent)]" />
          {/* Grid texture */}
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(rgba(148,210,240,1) 1px,transparent 1px),linear-gradient(90deg,rgba(148,210,240,1) 1px,transparent 1px)', backgroundSize: '52px 52px' }} />
          {/* Top glow line */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-sky-400/50 to-transparent" />

          <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">

            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/25 text-sky-400 text-[11px] font-black uppercase tracking-widest mb-7"
            >
              <Zap size={12} />
              {tCTA('setup')}
            </motion.div>

            {/* Title */}
            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: 0.08 }}
              className={cn("text-[clamp(32px,6vw,72px)] font-black text-white mb-6", locale === 'ar' ? 'tracking-normal leading-[1.6]' : 'tracking-tight leading-[1.18]')}
              dangerouslySetInnerHTML={{ __html: tCTA.raw('title') }}
            />

            {/* Desc */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.14 }}
              className="text-slate-400 max-w-2xl mx-auto text-base md:text-lg leading-relaxed mb-12"
            >
              {tCTA('desc')}
            </motion.p>

            {/* Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.26 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10"
            >
              <Link href="/register" className="w-full sm:w-auto">
                <Button className="w-full sm:w-auto h-14 md:h-16 px-10 md:px-14 text-base md:text-lg font-black rounded-2xl bg-sky-500 hover:bg-sky-400 text-white transition-all duration-300 hover:scale-[1.03] shadow-2xl shadow-sky-500/25 group border-none">
                  {tCTA('register')}
                  <ArrowRight size={18} className="rtl:rotate-180 rtl:mr-2 ltr:ml-2 transition-transform group-hover:rtl:-translate-x-1 group-hover:ltr:translate-x-1" />
                </Button>
              </Link>
              <Link href="/contact" className="w-full sm:w-auto">
                <Button variant="outline" className="w-full sm:w-auto h-14 md:h-16 px-10 md:px-14 text-base md:text-lg font-black rounded-2xl border-white/10 text-slate-300 hover:text-white hover:border-sky-500/40 hover:bg-sky-500/[0.06] transition-all duration-300">
                  {tCTA('contact')}
                </Button>
              </Link>
            </motion.div>

            {/* Trust badges */}
            <div className="flex flex-wrap items-center justify-center gap-5 text-[11px] font-bold text-slate-500">
              <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-sky-400/70" />{tCTA('vision')}</span>
              <span className="w-px h-3 bg-white/10" />
              <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-sky-400/70" />{tCTA('no_fees')}</span>
              <span className="w-px h-3 bg-white/10" />
              <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-sky-400/70" />{tCTA('setup')}</span>
            </div>

          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-16 md:py-24 bg-[#0F172A] border-t border-white/5">
          <div className="max-w-4xl mx-auto px-6">
            <div className="text-center mb-14 space-y-3">
              <h2 className="text-3xl md:text-4xl font-bold text-white tracking-normal">{tFAQ('heading')}</h2>
              <p className="text-slate-400 max-w-xl mx-auto text-base leading-relaxed">{tFAQ('subtitle')}</p>
            </div>
            <Accordion type="single" collapsible className="space-y-3">
              {[
                { q: tFAQ('q1'), a: tFAQ('a1') },
                { q: tFAQ('q2'), a: tFAQ('a2') },
                { q: tFAQ('q3'), a: tFAQ('a3') },
                { q: tFAQ('q4'), a: tFAQ('a4') },
                { q: tFAQ('q5'), a: tFAQ('a5') },
                { q: tFAQ('q6'), a: tFAQ('a6') },
              ].map((faq, i) => (
                <AccordionItem
                  key={i}
                  value={`faq-${i}`}
                  className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden px-4 md:px-6 data-[state=open]:border-white/10"
                >
                  <AccordionTrigger className="text-white font-bold text-sm md:text-base lg:text-lg py-4 md:py-6 hover:no-underline hover:text-sky-300 transition-colors text-start">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-400 text-sm md:text-base leading-relaxed pb-6">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
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

      {/* FOOTER */}
      <footer className="bg-[#020617] relative overflow-hidden">
        {/* Top separator with gradient highlight */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

        {/* Background glows */}
        <div className="absolute -bottom-48 -end-48 w-[600px] h-[600px] bg-sky-500/[0.04] rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute -bottom-24 start-1/3 w-80 h-80 bg-sky-500/[0.025] rounded-full blur-[100px] pointer-events-none" />

        {/* Main content */}
        <div className="relative z-10 max-w-7xl mx-auto px-6 pt-16 md:pt-20 pb-14">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-12 lg:gap-10">

            {/* ── Brand ── */}
            <div className="space-y-6">
              <Link href="/" className="inline-block">
                <Image
                  src="/logo1.png"
                  alt={locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech'}
                  width={140}
                  height={48}
                  className="h-10 w-auto object-contain"
                />
              </Link>
              <p className="text-slate-400 text-[13.5px] leading-[1.85] max-w-[32ch]">
                {tFooter('desc')}
              </p>
              {/* Social icons */}
              <div className="flex items-center gap-2.5">
                {[
                  {
                    href: 'https://x.com/mdmaktech',
                    label: 'X (Twitter)',
                    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z',
                  },
                  {
                    href: 'https://linkedin.com/company/mdmaktech',
                    label: 'LinkedIn',
                    path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
                  },
                  {
                    href: 'https://wa.me/966550013416',
                    label: 'WhatsApp',
                    path: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.528 5.862L0 24l6.293-1.508A11.933 11.933 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.807 9.807 0 0 1-5.196-1.487l-.372-.221-3.86.924.976-3.754-.243-.387A9.815 9.815 0 0 1 2.182 12C2.182 6.572 6.572 2.182 12 2.182S21.818 6.572 21.818 12 17.428 21.818 12 21.818z',
                  },
                ].map(s => (
                  <a
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-slate-500 hover:text-sky-400 hover:border-sky-500/30 hover:bg-sky-500/[0.06] transition-all duration-200"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[14px] h-[14px]">
                      <path d={s.path} />
                    </svg>
                  </a>
                ))}
              </div>
            </div>

            {/* ── Platform links ── */}
            <div className="space-y-5">
              <h5 className="text-slate-200 text-[11px] font-bold uppercase tracking-[0.12em]">
                {tFooter('quick_links')}
              </h5>
              <ul className="space-y-3">
                {[
                  { label: tFooter('l_about'), href: '/about' },
                  { label: tFooter('l_features'), href: '/#features' },
                  { label: tFooter('l_pricing'), href: '/pricing' },
                  { label: tFooter('l_suppliers'), href: '/register?role=Supplier' },
                  { label: tFooter('l_contractors'), href: '/register?role=Contractor' },
                ].map(l => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13.5px] text-slate-500 hover:text-slate-200 transition-colors duration-200">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* ── Legal ── */}
            <div className="space-y-5">
              <h5 className="text-slate-200 text-[11px] font-bold uppercase tracking-[0.12em]">
                {tFooter('legal')}
              </h5>
              <ul className="space-y-3">
                {[
                  { label: tFooter('l_privacy'), href: '/privacy' },
                  { label: tFooter('l_terms'), href: '/terms' },
                  { label: tFooter('l_contact'), href: '/contact' },
                ].map(l => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13.5px] text-slate-500 hover:text-slate-200 transition-colors duration-200">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* ── Contact ── */}
            <div className="space-y-5">
              <h5 className="text-slate-200 text-[11px] font-bold uppercase tracking-[0.12em]">
                {tFooter('address_title')}
              </h5>
              <div className="space-y-4">
                <div className="flex items-start gap-2.5">
                  <MapPin size={13} className="text-slate-600 mt-[3px] shrink-0" />
                  <p
                    className="text-[13px] text-slate-500 leading-[1.75]"
                    dangerouslySetInnerHTML={{ __html: tFooter.raw('address_value') }}
                  />
                </div>
                <div className="flex items-center gap-2.5">
                  <Phone size={13} className="text-slate-600 shrink-0" />
                  <a
                    href="https://wa.me/966550013416"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-slate-500 hover:text-slate-200 transition-colors"
                    dir="ltr"
                  >
                    {tFooter('support_phone')}
                  </a>
                </div>
                <div className="flex items-center gap-2.5">
                  <Mail size={13} className="text-slate-600 shrink-0" />
                  <a
                    href="mailto:info@mdmaktech.sa"
                    className="text-[13px] text-slate-500 hover:text-slate-200 transition-colors"
                  >
                    info@mdmaktech.sa
                  </a>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Bottom bar */}
        <div className="relative z-10 border-t border-white/[0.05]">
          <div className="max-w-7xl mx-auto px-6 h-14 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[11.5px] text-slate-600">
              {tFooter('copyright', { year: new Date().getFullYear() })}
            </p>
            <div className="flex items-center gap-5 text-[11.5px] text-slate-600">
              <span className="flex items-center gap-1.5">
                <Globe size={11} />
                {locale === 'ar' ? 'العربية' : 'English'}
              </span>
              <span className="w-px h-3 bg-white/[0.08]" />
              <span>{tFooter('made_in')}</span>
            </div>
          </div>
        </div>
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
      <LandingChatWidget />
    </div>
  );
}
