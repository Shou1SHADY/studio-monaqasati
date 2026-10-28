"use client";

import Image from 'next/image';
import { AlertTriangle, ArrowRight, CheckCircle, Clock, Phone, ShieldCheck, Users, X } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/** "Before & after Mdmak" — the WhatsApp-group chaos next to the platform. Shared by the landing pages. */
export function ComparisonSection() {
  const tCompare = useTranslations('Landing.Comparison');
  const locale = useLocale();

  return (
    <section className="py-16 md:py-28 bg-[#020617] border-b border-white/5 relative overflow-hidden">
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
        <div className="text-center mb-10 md:mb-14">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-slate-400 text-[11px] font-black uppercase tracking-widest mb-6"
          >
            {tCompare('tagline')}
          </div>

          <h2
            className="text-[clamp(24px,4.5vw,56px)] font-extrabold leading-[1.22] text-white mb-5"
          >
            {tCompare('title_prefix')}{' '}
            <span className="bg-gradient-to-r from-sky-300 to-sky-500 bg-clip-text text-transparent font-black">{tCompare('title_highlight')}</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[0.58fr_60px_1.42fr] items-start gap-8 lg:gap-0">

          {/* BEFORE */}
          <div
            className="flex flex-col relative lg:pe-10 max-w-[300px] sm:max-w-sm mx-auto lg:max-w-none lg:mx-0"
          >
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

            <div className="flex flex-col rounded-2xl overflow-hidden bg-gradient-to-b from-[#140d0d] to-[#0d0909] border border-red-500/[0.14] shadow-[0_0_56px_-16px_rgba(239,68,68,0.22),0_36px_80px_-42px_rgba(0,0,0,.9)]">
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

              <div className="flex items-center gap-[7px] px-[11px] py-[8px] border-t border-red-500/[0.06] bg-red-500/[0.02]">
                <span className="flex-1 h-[26px] rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center px-[11px] text-[10.5px] text-slate-600">
                  {tCompare('chat_placeholder')}
                </span>
                <span className="w-[26px] h-[26px] rounded-full bg-white/[0.05] flex items-center justify-center text-slate-500 shrink-0">
                  <ArrowRight size={13} className={cn(locale === 'ar' && "rtl-flip")} />
                </span>
              </div>
            </div>

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
          </div>

          {/* VS CONNECTOR (desktop only) */}
          <div className="hidden lg:flex flex-col items-center justify-center self-stretch gap-0 pt-[52px]">
            <div className="flex-1 w-px bg-gradient-to-b from-transparent via-white/[0.07] to-transparent" />
            <motion.div
              animate={{ y: 4 }}
              transition={{ duration: 1.6, repeat: Infinity, repeatType: 'mirror', ease: [0.37, 0, 0.63, 1] }}
              style={{ willChange: 'transform' }}
              className="my-3 w-8 h-8 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center"
            >
              <ArrowRight size={15} className={cn("text-sky-400", locale === 'ar' && "rtl-flip")} />
            </motion.div>
            <div className="flex-1 w-px bg-gradient-to-b from-transparent via-white/[0.07] to-transparent" />
          </div>

          {/* AFTER */}
          <div
            className="flex flex-col relative lg:ps-10 max-w-[300px] sm:max-w-sm mx-auto lg:max-w-none lg:mx-0"
          >
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

            <div className="relative flex flex-col rounded-2xl overflow-hidden bg-[#060d1c] border border-sky-500/[0.22] shadow-[0_0_80px_-18px_rgba(14,165,233,0.38),0_44px_100px_-42px_rgba(0,0,0,.92)]">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-sky-500/[0.08] bg-gradient-to-b from-[rgba(12,22,44,.98)] to-[rgba(6,13,28,.98)]">
                <div className="flex gap-[6px] shrink-0">
                  <span className="block w-[11px] h-[11px] rounded-full bg-red-400/55" />
                  <span className="block w-[11px] h-[11px] rounded-full bg-yellow-400/55" />
                  <span className="block w-[11px] h-[11px] rounded-full bg-green-400/55" />
                </div>
                <div className="flex-1 flex items-center justify-center gap-2 h-[28px] mx-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-slate-400 text-xs font-medium">
                  <ShieldCheck size={12} className="text-green-400 shrink-0" />
                  mdmak.sa
                </div>
                <div className="flex items-center gap-[6px] text-[10px] text-green-400 font-bold tracking-[.05em] shrink-0">
                  <span className="block w-[6px] h-[6px] rounded-full bg-green-400 shadow-[0_0_8px_#4ade80] animate-pulse" />
                  LIVE
                </div>
              </div>
              <div className="leading-[0]">
                <Image
                  src="/images/platform-comparison.png"
                  alt={tCompare('screenshot_alt')}
                  width={1706}
                  height={848}
                  className="block w-full h-auto"
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 58vw, 700px"
                  loading="lazy"
                />
              </div>
            </div>

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
          </div>

        </div>
      </div>
    </section>
  );
}
