"use client";

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { Link } from "@/i18n/routing";
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle2, Clock, Zap, TrendingUp, Menu, X } from 'lucide-react';
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useTranslations, useLocale } from 'next-intl';
import BelowFoldSections from './BelowFoldSections';

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

export default function HomeContent() {
  const tNav = useTranslations('Landing.Navbar');
  const tHero = useTranslations('Landing.HeroSlides');
  const tAction = useTranslations('Landing.HeroAction');
  const tStats = useTranslations('Landing.Stats');
  const locale = useLocale();

  const heroSlides = [
    { img: '/images/warehouse-desk.jpg' },
    { img: '/images/construction-site.jpg' },
    { img: '/images/loading-dock.jpg' },
  ];

  const [slide, setSlide] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    const t = setInterval(() => setSlide(s => (s + 1) % heroSlides.length), 6000);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  return (
    <div className="min-h-svh bg-[#020617] flex flex-col font-body text-foreground overflow-x-hidden selection:bg-cta/30">

      {/* Navigation */}
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

      {/* Mobile Menu Overlay */}
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
                { label: tNav('features'), href: '#features' },
                { label: tNav('how_it_works'), href: '#how' },
                { label: tNav('suppliers_portal'), href: '/register?role=Supplier' },
                { label: tNav('contractors_portal'), href: '/register?role=Contractor' },
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

      {/* Hero */}
      <section className="relative h-svh min-h-[640px] md:min-h-[700px] flex flex-col">
        {heroSlides.map((s, i) => (
          <div key={i} className={`absolute inset-0 overflow-hidden transition-[opacity,transform] duration-1500 ease-in-out ${i === slide ? 'opacity-100 scale-100' : 'opacity-0 scale-110'}`} style={{ willChange: 'opacity, transform' }}>
            <Image fill src={s.img} alt="" className="w-full h-full object-cover object-center" sizes="100vw" priority={i === 0} loading={i === 0 ? undefined : "lazy"} quality={i === 0 ? 75 : 50} />
            <div className={`absolute inset-0 ${locale === 'ar' ? 'bg-gradient-to-l' : 'bg-gradient-to-r'} from-[#020617] via-[#020617]/70 to-transparent`} />
            <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent" />
            <div className="absolute inset-0 bg-[#020617]/30" />
          </div>
        ))}

        <div className="absolute inset-0 z-[5] opacity-20 pointer-events-none overflow-hidden"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />

        <div className="relative z-10 flex-1 flex items-center w-full max-w-7xl mx-auto px-6 pt-24 md:pt-16 pb-4 md:pb-0">
          <div className="max-w-2xl space-y-6">

            <h1 className={`text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight flex flex-col ${locale === 'ar' ? 'gap-0 md:gap-0 !leading-[1.4]' : 'gap-0 md:gap-1 !leading-[1.2]'}`}>
              <span>{tHero('slide1_title')}</span>
              <span className={`text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-200 ${locale === 'ar' ? '' : 'pb-2 md:pb-3'}`}>
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

        {/* Bottom Stats */}
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

      <BelowFoldSections />

    </div>
  );
}
