"use client";

import Image from 'next/image';
import { cn } from '@/lib/utils';

/** A phone bezel around an app screenshot (the screenshots are 870×1807). */
export function PhoneFrame({ src, alt, priority, className }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <div className={cn('relative rounded-[2.5rem] border border-white/10 bg-slate-900 p-2.5 shadow-2xl shadow-black/60', className)}>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 h-1.5 w-16 rounded-full bg-slate-800" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-[2rem] bg-white aspect-[870/1807]">
        <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 300px, 70vw" className="object-cover object-top" priority={priority} />
      </div>
    </div>
  );
}
