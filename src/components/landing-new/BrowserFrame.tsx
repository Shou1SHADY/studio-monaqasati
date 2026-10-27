"use client";

import Image from 'next/image';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A browser window around a web-app screenshot. */
export function BrowserFrame({ src, alt, url, className }: { src: string; alt: string; url: string; className?: string }) {
  return (
    <div className={cn(
      'overflow-hidden rounded-2xl border shadow-2xl',
      'border-slate-200 bg-white shadow-slate-900/10 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/50',
      className,
    )}>
      <div className="flex items-center gap-3 px-4 h-10 border-b border-slate-200 bg-slate-50 dark:border-white/5 dark:bg-white/[0.03]" dir="ltr">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-success/70" />
        </span>
        <span className="mx-auto flex items-center gap-1.5 rounded-md bg-white px-3 py-1 text-[11px] text-slate-500 ring-1 ring-slate-200 dark:bg-white/5 dark:text-slate-400 dark:ring-white/10">
          <Lock size={10} aria-hidden="true" /> {url}
        </span>
        <span className="w-[42px]" aria-hidden="true" />
      </div>
      <div className="relative aspect-[16/9] bg-white">
        <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 900px, 100vw" className="object-cover object-top" />
      </div>
    </div>
  );
}
