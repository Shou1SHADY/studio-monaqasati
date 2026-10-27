"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { Menu, X } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { cn } from '@/lib/utils';

export const LN_SECTIONS = ['home', 'why', 'network', 'how', 'assistant', 'app', 'plans', 'contact'] as const;

/** Sticky navigation; the link of the section on screen is highlighted. */
export function LnNavbar({ onStart }: { onStart: () => void }) {
  const t = useTranslations('LandingNew.nav');
  const locale = useLocale();
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

  const links = LN_SECTIONS.map(id => ({ id, label: t(id) }));
  const logoAlt = locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech';

  return (
    <>
      <nav className={cn(
        'sticky top-0 z-40 transition-all duration-300',
        scrolled ? 'bg-primary/85 backdrop-blur-xl border-b border-white/5 py-2.5' : 'bg-transparent py-4',
      )}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-4">
          <Link href="/" className="shrink-0">
            <Image src="/logo1.png" alt={logoAlt} width={140} height={48} className="h-9 md:h-10 w-auto object-contain" priority />
          </Link>

          <ul className="hidden xl:flex items-center gap-1">
            {links.map(l => (
              <li key={l.id}>
                <a
                  href={`#${l.id}`}
                  aria-current={active === l.id ? 'true' : undefined}
                  className={cn(
                    'relative px-3 py-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    active === l.id ? 'text-white' : 'text-slate-400 hover:text-white',
                  )}
                >
                  {l.label}
                  {active === l.id && <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-accent" aria-hidden="true" />}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <LanguageSwitcher className="text-slate-300 hover:text-white hover:bg-white/5 text-xs md:text-sm" />
            <Button asChild variant="ghost" className="hidden sm:inline-flex h-10 px-4 font-bold text-slate-300 hover:text-white hover:bg-white/5"><Link href="/login">{t('login')}</Link></Button>
            <Button onClick={onStart} className="h-10 px-5 rounded-xl font-bold">{t('start')}</Button>
            <button
              type="button"
              className="xl:hidden flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => setMenuOpen(true)}
              aria-label={t('menu_open')}
              aria-expanded={menuOpen}
            >
              <Menu size={18} />
            </button>
          </div>
        </div>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-[60] xl:hidden">
          <button type="button" aria-label={t('menu_close')} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <div className="absolute top-0 inset-x-0 bg-primary border-b border-white/10 shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <Image src="/logo1.png" alt={logoAlt} width={120} height={40} className="h-9 w-auto object-contain" />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={t('menu_close')}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X size={18} />
              </button>
            </div>
            <ul className="flex flex-col px-4 py-3">
              {links.map(l => (
                <li key={l.id}>
                  <a
                    href={`#${l.id}`}
                    onClick={() => setMenuOpen(false)}
                    className={cn('block py-3 px-4 rounded-xl font-bold hover:bg-white/5', active === l.id ? 'text-accent' : 'text-slate-300')}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-3 px-6 pb-6 pt-3 border-t border-white/5">
              <Button asChild variant="ghost" className="w-full h-11 font-bold text-slate-300 hover:text-white hover:bg-white/5 border border-white/10">
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
