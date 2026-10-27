"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import type { LandingTheme } from '@/hooks/useLandingTheme';
import { cn } from '@/lib/utils';
import { ln } from './tone';

export const LN_SECTIONS = ['home', 'why', 'tour', 'network', 'how', 'assistant', 'app', 'plans', 'contact'] as const;

/** The colour logo on light, the white one on dark. */
export function LnLogo({ className, priority }: { className?: string; priority?: boolean }) {
  const alt = useLocale() === 'ar' ? 'مدماك تيك' : 'Mdmak Tech';
  return (
    <>
      <Image src="/logo.png" alt={alt} width={140} height={48} className={cn('w-auto object-contain dark:hidden', className)} priority={priority} />
      <Image src="/logo1.png" alt={alt} width={140} height={48} className={cn('w-auto object-contain hidden dark:block', className)} priority={priority} />
    </>
  );
}

/** Sticky navigation; the link of the section on screen is highlighted. */
export function LnNavbar({ onStart, theme, onToggleTheme }: { onStart: () => void; theme: LandingTheme; onToggleTheme: () => void }) {
  const t = useTranslations('LandingNew.nav');
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string>('home');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const els = LN_SECTIONS.map(id => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      entries => {
        const hit = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  // The logo is the way home; the rest of the sections are links.
  const links = LN_SECTIONS.filter(id => id !== 'home').map(id => ({ id, label: t(id) }));
  const themeLabel = theme === 'dark' ? t('theme_light') : t('theme_dark');

  const iconBtn = cn(
    'flex items-center justify-center w-10 h-10 rounded-xl border transition-colors',
    'border-slate-200 bg-white text-slate-600 hover:text-primary hover:border-slate-300',
    'dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-white',
    ln.focus,
  );

  return (
    <>
      <nav className={cn(
        'sticky top-0 z-40 transition-all duration-300 border-b',
        scrolled
          ? 'bg-white/85 backdrop-blur-xl border-slate-200/80 shadow-sm shadow-slate-900/[0.03] py-2.5 dark:bg-slate-950/80 dark:border-white/5 dark:shadow-none'
          : 'bg-transparent border-transparent py-4',
      )}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-4">
          <Link href="/" className={cn('shrink-0 rounded-lg', ln.focus)}><LnLogo className="h-9 md:h-10" priority /></Link>

          <ul className="hidden xl:flex items-center gap-0.5">
            {links.map(l => (
              <li key={l.id}>
                <a
                  href={`#${l.id}`}
                  aria-current={active === l.id ? 'true' : undefined}
                  className={cn(
                    'relative px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
                    ln.focus,
                    active === l.id ? 'text-cta dark:text-white' : 'text-slate-600 hover:text-primary dark:text-slate-400 dark:hover:text-white',
                  )}
                >
                  {l.label}
                  {active === l.id && <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-cta dark:bg-accent" aria-hidden="true" />}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <LanguageSwitcher className="text-slate-600 hover:text-primary hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/5 text-xs md:text-sm" />
            <button type="button" onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel} className={iconBtn}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <Button asChild variant="ghost" className="hidden sm:inline-flex h-10 px-4 font-bold text-slate-700 hover:text-primary hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/5">
              <Link href="/login">{t('login')}</Link>
            </Button>
            <Button onClick={onStart} className="hidden sm:inline-flex h-10 px-5 rounded-xl font-bold shadow-md shadow-cta/20">{t('start')}</Button>
            <button type="button" className={cn(iconBtn, 'xl:hidden')} onClick={() => setMenuOpen(true)} aria-label={t('menu_open')} aria-expanded={menuOpen}>
              <Menu size={18} />
            </button>
          </div>
        </div>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-[60] xl:hidden" role="dialog" aria-modal="true" aria-label={t('menu_open')}>
          <button type="button" aria-label={t('menu_close')} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-slate-950/70" onClick={() => setMenuOpen(false)} />
          <div className="absolute top-0 inset-x-0 bg-white border-b border-slate-200 shadow-2xl dark:bg-primary dark:border-white/10">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/5">
              <LnLogo className="h-9" />
              <button type="button" onClick={() => setMenuOpen(false)} aria-label={t('menu_close')} className={iconBtn}>
                <X size={18} />
              </button>
            </div>
            <ul className="flex flex-col px-4 py-3 max-h-[60svh] overflow-y-auto">
              {links.map(l => (
                <li key={l.id}>
                  <a
                    href={`#${l.id}`}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      'block py-3 px-4 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-white/5',
                      active === l.id ? 'text-cta dark:text-accent' : 'text-slate-700 dark:text-slate-300',
                    )}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-3 px-6 pb-6 pt-3 border-t border-slate-100 dark:border-white/5">
              <Button asChild variant="outline" className="w-full h-11 font-bold border-slate-200 text-slate-700 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white">
                <Link href="/login" onClick={() => setMenuOpen(false)}>{t('login')}</Link>
              </Button>
              <Button className="w-full h-11 font-bold rounded-xl" onClick={() => { setMenuOpen(false); onStart(); }}>{t('start')}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
