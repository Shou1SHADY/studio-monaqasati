"use client";

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { Link } from "@/i18n/routing";
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle2, Clock, Zap, TrendingUp, Menu, X, FileText, BarChart3, ShieldCheck } from 'lucide-react';
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import BelowFoldSections from './BelowFoldSections';

const HERO_SLIDES = [
  { wm: '٢٤'   },
  { wm: '٧٠٪'  },
  { wm: '+٥٠٠' },
] as const;

function AnimatedStat({ value }: { value: string }) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    const match = value.match(/^(.*?)(\d+)(.*)$/);
    if (!match) return;
    const numValue = parseInt(match[2]);
    const prefix = match[1];
    const suffix = match[3];
    let animated = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || animated) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        animated = true;
        const duration = 1500;
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = `${prefix}${Math.round(eased * numValue)}${suffix}`;
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { rootMargin: '-50px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  const match = value.match(/^(.*?)(\d+)(.*)$/);
  if (!match) return <span>{value}</span>;
  return <span ref={spanRef}>{value}</span>;
}

/* ── Hero floating UI cards (demo display data — Arabic, Saudi-focused) ── */

function RfqCard() {
  const [time, setTime] = useState('23:14');
  useEffect(() => {
    let s = 23 * 60 + 14;
    const id = setInterval(() => {
      s--;
      if (s < 0) s = 23 * 60 + 14;
      const m = Math.floor(s / 60);
      const sec = s % 60;
      setTime(`${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-[#0a1628]/95 backdrop-blur-xl border border-[#20CBD5]/[0.15] rounded-2xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,.55)]">
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/[0.05]">
        <div className="h-[34px] w-[34px] rounded-[10px] bg-[#20CBD5]/[0.12] flex items-center justify-center shrink-0">
          <FileText size={15} className="text-[#20CBD5]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-black text-white">طلب عروض #٢٠٢٦-١١٤٧</div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5">حديد تسليح 20mm · ٢٠٠ طن</div>
        </div>
        <div className="text-[11px] font-bold text-amber-400 shrink-0 tabular-nums">⏱ {time}</div>
      </div>
      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-2.5 p-2.5 rounded-[10px] bg-[#20CBD5]/[0.07] border border-[#20CBD5]/[0.16]">
          <div className="h-[30px] w-[30px] rounded-[8px] bg-[#0d4e5c] flex items-center justify-center text-white text-xs font-black shrink-0">ر</div>
          <div className="flex-1 min-w-0 text-[11px] font-bold text-slate-300 truncate">شركة الرياض للحديد والصلب</div>
          <div className="text-[12px] font-black text-white shrink-0 tabular-nums">٣٢٠,٠٠٠<span className="text-[9px] text-slate-500 ms-1">ر.س</span></div>
          <div className="text-[9px] font-black text-emerald-400 bg-emerald-400/[0.14] px-1.5 py-0.5 rounded-full shrink-0">✓ أفضل</div>
        </div>
        {[
          { av: 'ب', bg: '#1a3045', name: 'مؤسسة البناء القوي',   price: '٣٤٥,٠٠٠' },
          { av: 'خ', bg: '#1c2b3c', name: 'مجموعة الخليج للمواد', price: '٣٦٨,٠٠٠' },
        ].map(r => (
          <div key={r.av} className="flex items-center gap-2.5 px-2.5 py-2 rounded-[10px]">
            <div className="h-[30px] w-[30px] rounded-[8px] flex items-center justify-center text-white text-xs font-black shrink-0" style={{ background: r.bg }}>{r.av}</div>
            <div className="flex-1 min-w-0 text-[11px] font-bold text-slate-400 truncate">{r.name}</div>
            <div className="text-[12px] font-black text-white shrink-0 tabular-nums">{r.price}<span className="text-[9px] text-slate-500 ms-1">ر.س</span></div>
          </div>
        ))}
      </div>
      <div className="px-4 pb-4">
        <button className="w-full py-2.5 bg-[#0369A1] hover:bg-[#0EA5E9] text-white text-[12px] font-black rounded-[10px] transition-colors">
          قبول العرض الأفضل
        </button>
      </div>
    </div>
  );
}

function ProjectsCard() {
  const projects = [
    { name: 'برج الرياض الإداري',        pct: 80, color: '#20CBD5', status: '✓ آخر توريد مؤكد', ok: true  },
    { name: 'مشروع إسكان الشميسي',       pct: 60, color: '#0EA5E9', status: 'قيد التوريد',       ok: false },
    { name: 'مجمع المستشفيات الجنوبي',   pct: 45, color: '#F59E0B', status: 'بانتظار العروض',    ok: false },
  ];
  return (
    <div className="bg-[#0a1628]/95 backdrop-blur-xl border border-[#20CBD5]/[0.15] rounded-2xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,.55)]">
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/[0.05]">
        <div className="h-[34px] w-[34px] rounded-[10px] bg-[#20CBD5]/[0.12] flex items-center justify-center shrink-0">
          <BarChart3 size={15} className="text-[#20CBD5]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-black text-white">المشاريع الجارية</div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5">آخر تحديث: منذ ٥ دقائق</div>
        </div>
        <div className="text-[10px] font-black bg-[#20CBD5]/[0.12] text-[#20CBD5] px-2 py-1 rounded-full shrink-0">٣ نشطة</div>
      </div>
      <div className="p-4 space-y-3.5">
        {projects.map(p => (
          <div key={p.name}>
            <div className="text-[11px] font-bold text-slate-300 mb-1.5">{p.name}</div>
            <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden mb-1.5">
              <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: p.color }} />
            </div>
            <div className="flex justify-between text-[10px] font-bold">
              <span className={p.ok ? 'text-emerald-400' : 'text-slate-500'}>{p.status}</span>
              <span className="text-slate-400 tabular-nums">{p.pct}٪</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuppliersCard() {
  const suppliers = [
    { av: 'ر', name: 'شركة الرياض للحديد والصلب', rating: '★★★★★ ٤.٩', cat: 'حديد وصلب',       bg: 'linear-gradient(135deg,#0d5c6a,#07303c)' },
    { av: 'خ', name: 'مصنع الخليج للإسمنت',        rating: '★★★★☆ ٤.٧', cat: 'إسمنت ومواد',    bg: 'linear-gradient(135deg,#0d4a30,#072a1a)' },
    { av: 'ن', name: 'مجموعة النخبة التقنية',       rating: '★★★★★ ٤.٨', cat: 'كهرباء وميكانيكا', bg: 'linear-gradient(135deg,#0d3e5c,#07222f)' },
  ];
  return (
    <div className="bg-[#0a1628]/95 backdrop-blur-xl border border-[#20CBD5]/[0.15] rounded-2xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,.55)]">
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/[0.05]">
        <div className="h-[34px] w-[34px] rounded-[10px] bg-[#20CBD5]/[0.12] flex items-center justify-center shrink-0">
          <ShieldCheck size={15} className="text-[#20CBD5]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-black text-white">الموردون المعتمدون</div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5">موثقون رسمياً في المنصة</div>
        </div>
        <div className="text-[10px] font-black bg-[#20CBD5]/[0.12] text-[#20CBD5] px-2 py-1 rounded-full shrink-0">+٥٠٠</div>
      </div>
      <div className="divide-y divide-white/[0.04] px-4">
        {suppliers.map(s => (
          <div key={s.av} className="flex items-center gap-3 py-3">
            <div className="h-[34px] w-[34px] rounded-[10px] flex items-center justify-center text-white text-sm font-black shrink-0" style={{ background: s.bg }}>{s.av}</div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-white">
                {s.name} <span className="text-[#20CBD5] text-[10px]">✓</span>
              </div>
              <div className="text-[10px] text-slate-500 font-medium mt-0.5">{s.rating} · {s.cat}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main landing content ── */

export default function HomeContent() {
  const tNav    = useTranslations('Landing.Navbar');
  const tHero   = useTranslations('Landing.HeroSlides');
  const tAction = useTranslations('Landing.HeroAction');
  const tStats  = useTranslations('Landing.Stats');
  const locale  = useLocale();

  const slideContents = [
    { badge: tHero('slide1_badge'), title: tHero('slide1_title'), accent: tHero('slide1_accent'), sub: tHero('slide1_sub') },
    { badge: tHero('slide2_badge'), title: tHero('slide2_title'), accent: tHero('slide2_accent'), sub: tHero('slide2_sub') },
    { badge: tHero('slide3_badge'), title: tHero('slide3_title'), accent: tHero('slide3_accent'), sub: tHero('slide3_sub') },
  ];

  const [slide,          setSlide]         = useState(0);
  const [slideKey,       setSlideKey]      = useState(0);
  const [scrolled,       setScrolled]      = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const goToSlide = (i: number) => {
    setSlide(i);
    setSlideKey(k => k + 1);
  };

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    const t = setInterval(() => {
      setSlide(s => (s + 1) % HERO_SLIDES.length);
      setSlideKey(k => k + 1);
    }, 6000);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  const cur = slideContents[slide];

  return (
    <div className="min-h-svh bg-[#020617] flex flex-col font-body text-foreground overflow-x-hidden selection:bg-cta/30">

      {/* ── Navigation ── */}
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
            <Link href="/login" className="hidden sm:block">
              <Button variant="ghost" className="text-slate-300 hover:text-white font-bold text-xs md:text-sm px-3 md:px-5 h-9 md:h-11 hover:bg-white/5 transition-all">{tNav('login')}</Button>
            </Link>
            <Link href="/register">
              <Button className="font-bold bg-white text-primary hover:bg-cta hover:text-white px-4 md:px-8 rounded-xl h-9 md:h-11 text-xs md:text-sm transition-all shadow-xl shadow-white/5 border-none">{tNav('start_free')}</Button>
            </Link>
            <button
              className="lg:hidden flex items-center justify-center w-9 h-9 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white transition-colors"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={locale === 'ar' ? 'فتح القائمة' : 'Open menu'}
            >
              <Menu size={18} />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Mobile Menu Overlay ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            className="absolute inset-0 bg-[#020617]/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute top-0 inset-x-0 bg-[#0F172A] border-b border-white/10 shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                <Image
                  src="/logo1.png"
                  alt={locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech'}
                  width={120}
                  height={40}
                  className="h-9 w-auto object-contain"
                />
              </Link>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white transition-colors"
                aria-label={locale === 'ar' ? 'إغلاق القائمة' : 'Close menu'}
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex flex-col px-4 py-3">
              {[
                { label: tNav('features'),            href: '#features' },
                { label: tNav('how_it_works'),        href: '#how' },
                { label: tNav('suppliers_portal'),    href: '/register?role=Supplier' },
                { label: tNav('contractors_portal'),  href: '/register?role=Contractor' },
              ].map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-slate-300 hover:text-white font-bold text-base py-3.5 px-4 rounded-xl hover:bg-white/5 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="flex flex-col gap-3 px-6 pb-6 pt-3 border-t border-white/5">
              <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                <Button variant="ghost" className="w-full h-11 text-slate-300 hover:text-white font-bold hover:bg-white/5 border border-white/10">
                  {tNav('login')}
                </Button>
              </Link>
              <Link href="/register" onClick={() => setMobileMenuOpen(false)}>
                <Button className="w-full h-11 font-bold bg-white text-primary hover:bg-cta hover:text-white rounded-xl border-none">
                  {tNav('start_free')}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Hero ── */}
      <section className="relative h-svh min-h-[640px] md:min-h-[700px] flex flex-col">

        {/* Dot-grid overlay */}
        <div
          className="absolute inset-0 z-[5] opacity-20 pointer-events-none overflow-hidden"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}
          aria-hidden="true"
        />

        {/* Hero body — split layout */}
        <div className="relative z-10 flex-1 flex w-full pt-24 md:pt-20 pb-4 md:pb-0">

          {/* TEXT COLUMN */}
          <div className="w-full lg:w-[55%] flex items-center relative overflow-hidden px-6 lg:ps-[5%] lg:pe-[3%] py-10">

            {/* Separator line between cols (desktop only) */}
            <div
              className="absolute inset-y-0 end-0 w-px hidden lg:block"
              style={{ background: 'linear-gradient(180deg,transparent,rgba(32,203,213,.08) 25%,rgba(32,203,213,.08) 75%,transparent)' }}
              aria-hidden="true"
            />

            {/* Watermark stat — the bold typographic risk */}
            <span
              aria-hidden="true"
              className="absolute bottom-0 start-[-0.05em] font-black text-[#20CBD5] pointer-events-none select-none leading-none"
              style={{ fontSize: 'clamp(7rem,12vw,11rem)', opacity: 0.028 }}
            >
              {HERO_SLIDES[slide].wm}
            </span>

            {/* Main content — key remount triggers fade-in on slide change */}
            <div key={slideKey} className="max-w-xl w-full relative z-10 hero-text-in">

              {/* Eyebrow badge */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-sky-400/25 bg-sky-400/[0.07] mb-4">
                <span className={`text-sky-300 text-[11px] font-bold ${locale !== 'ar' ? 'tracking-widest uppercase' : ''}`}>
                  {cur.badge}
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse shrink-0" aria-hidden="true" />
              </div>

              {/* Heading */}
              <h1
                className={`font-black text-white flex flex-col mb-4 ${locale === 'ar' ? 'leading-[1.42] gap-0' : 'leading-[1.18] gap-1 tracking-tight'}`}
                style={{ fontSize: 'clamp(2rem, 4.5vw, 3.75rem)' }}
              >
                <span>{cur.title}</span>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-200">
                  {cur.accent}
                </span>
              </h1>

              {/* Subtitle */}
              <p className="text-slate-300/90 text-[13.5px] md:text-[15px] font-medium leading-[1.75] mb-5">
                {cur.sub}
              </p>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-5">
                <Link href="/register" className="w-full sm:w-auto">
                  <Button className="w-full h-12 px-7 text-sm font-black rounded-xl bg-cta hover:bg-sky-600 text-white gap-2.5 transition-all hover:scale-[1.02] shadow-xl shadow-cta/25 border-none">
                    {tAction('register_now')} <ArrowLeft size={16} className="rtl:rotate-0 ltr:rotate-180" />
                  </Button>
                </Link>
                <Link href="#demo" className="w-full sm:w-auto">
                  <Button
                    variant="ghost"
                    className="w-full h-12 px-6 text-sm font-bold rounded-xl text-slate-300 border border-white/10 hover:bg-white/[0.06] hover:text-white hover:border-white/20 transition-all"
                  >
                    {tAction('demo_cta')}
                  </Button>
                </Link>
              </div>

              {/* Trust indicators */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-semibold text-slate-400">
                <span className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-sky-400 shrink-0" /> {tAction('setup')}</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-sky-400 shrink-0" /> {tAction('no_fees')}</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-sky-400 shrink-0" /> {tAction('vision')}</span>
              </div>
            </div>
          </div>

          {/* VISUAL COLUMN — desktop only */}
          <div className="hidden lg:flex lg:w-[45%] relative items-center justify-center px-[5%] py-10">

            {/* Floating UI card — key remount triggers entrance animation */}
            <div key={slideKey} className="relative z-10 w-full max-w-[332px] hero-card-in">
              {slide === 0 && <RfqCard />}
              {slide === 1 && <ProjectsCard />}
              {slide === 2 && <SuppliersCard />}
            </div>
          </div>

        </div>

        {/* ── Slide navigation: bottom-center progress dots ── */}
        <div
          className="relative z-20 flex justify-center items-center gap-2 pb-3 md:pb-4"
          role="tablist"
          aria-label={locale === 'ar' ? 'شرائح العرض' : 'Hero slides'}
        >
          {HERO_SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => goToSlide(i)}
              role="tab"
              aria-selected={i === slide}
              aria-label={locale === 'ar' ? `الشريحة ${i + 1}` : `Slide ${i + 1}`}
              className={cn(
                'h-1 border-0 rounded-full overflow-hidden relative cursor-pointer p-0 transition-[width] duration-300 ease-out',
                i === slide ? 'w-[68px] bg-white/[0.14]' : 'w-11 bg-white/10 hover:bg-white/[0.18]'
              )}
            >
              {i === slide && (
                <span
                  key={slideKey}
                  className="absolute top-0 bottom-0 start-0 w-0 rounded-full bg-[#20CBD5] hero-dot-fill"
                />
              )}
            </button>
          ))}
        </div>

        {/* ── Bottom stats bar ── */}
        <div className="relative z-20 px-6 pb-4 md:pb-6">
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-3 gap-2 md:gap-6 w-full">
              {[
                { val: tStats('response_val'), label: tStats('response_label'), icon: Clock },
                { val: tStats('saving_70'),    label: tStats('time_saving'),     icon: Zap },
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

      <BelowFoldSections />

    </div>
  );
}
