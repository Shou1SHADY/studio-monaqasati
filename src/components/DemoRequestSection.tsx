"use client";

import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations, useLocale } from 'next-intl';
import { CheckCircle2, Play, BarChart3, MessageCircle, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { addDays, demoRequestSchema, riyadhToday } from '@/lib/demo-request';
import { CompanyTypePicker } from '@/components/CompanyTypePicker';

type FormData = z.infer<typeof demoRequestSchema>;

const fieldBase = 'w-full h-11 rounded-xl border px-4 text-sm font-medium focus:outline-none transition-all';
const errorBorderCls = 'border-red-500/40 focus:border-red-500/50';

/** "dark" is the current landing's look (default); "auto" is light with `dark:` variants, for a themed page. */
const TONES = {
  dark: {
    section: 'bg-[#030712] border-white/5',
    glow: 'block',
    badge: 'border-[#20CBD5]/20 bg-[#20CBD5]/[0.06]',
    badgeDot: 'bg-[#20CBD5]',
    badgeText: 'text-[#20CBD5]',
    title: 'text-white',
    titleAccent: 'from-sky-400 to-cyan-300',
    desc: 'text-slate-400',
    includesTitle: 'text-slate-300',
    item: 'bg-white/[0.025] border-white/[0.06] hover:border-[#20CBD5]/20',
    itemIcon: 'bg-[#20CBD5]/[0.10]',
    itemIconColor: 'text-[#20CBD5]',
    itemText: 'text-slate-300',
    note: 'bg-sky-500/[0.06] border-sky-500/[0.14]',
    noteIcon: 'text-sky-400',
    noteText: 'text-slate-400',
    card: 'bg-[#0a1628]/90 backdrop-blur border-[#20CBD5]/[0.12] shadow-[0_32px_80px_rgba(0,0,0,.45)]',
    heading: 'text-white',
    muted: 'text-slate-400',
    label: 'text-slate-400',
    field: 'bg-white/[0.04] border-white/[0.1] text-white placeholder:text-slate-600 focus:border-[#20CBD5]/40 focus:bg-white/[0.06]',
    date: '[color-scheme:dark]',
  },
  auto: {
    section: 'bg-slate-50 border-slate-200 dark:bg-slate-950 dark:border-white/5',
    glow: 'hidden dark:block',
    badge: 'border-cta/15 bg-cta/[0.06] dark:border-accent/20 dark:bg-accent/[0.06]',
    badgeDot: 'bg-cta dark:bg-accent',
    badgeText: 'text-cta dark:text-accent',
    title: 'text-primary dark:text-white',
    titleAccent: 'from-cta to-cyan-600 dark:from-sky-400 dark:to-cyan-300',
    desc: 'text-slate-600 dark:text-slate-400',
    includesTitle: 'text-slate-700 dark:text-slate-300',
    item: 'bg-white border-slate-200 shadow-sm hover:border-cta/25 dark:bg-white/[0.025] dark:border-white/[0.06] dark:shadow-none dark:hover:border-accent/20',
    itemIcon: 'bg-cta/[0.08] dark:bg-accent/10',
    itemIconColor: 'text-cta dark:text-accent',
    itemText: 'text-slate-700 dark:text-slate-300',
    note: 'bg-cta/[0.05] border-cta/15 dark:bg-sky-500/[0.06] dark:border-sky-500/[0.14]',
    noteIcon: 'text-cta dark:text-sky-400',
    noteText: 'text-slate-600 dark:text-slate-400',
    card: 'bg-white border-slate-200 shadow-xl shadow-slate-900/[0.06] dark:bg-primary/90 dark:backdrop-blur dark:border-accent/[0.12] dark:shadow-black/40',
    heading: 'text-primary dark:text-white',
    muted: 'text-slate-600 dark:text-slate-400',
    label: 'text-slate-600 dark:text-slate-400',
    field: 'bg-white border-slate-200 text-primary placeholder:text-slate-400 focus:border-cta/50 dark:bg-white/[0.04] dark:border-white/[0.1] dark:text-white dark:placeholder:text-slate-600 dark:focus:border-accent/40 dark:focus:bg-white/[0.06]',
    date: 'dark:[color-scheme:dark]',
  },
} as const;
type Tone = keyof typeof TONES;

function Field({
  label,
  htmlFor,
  hint,
  error,
  tone,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={cn('block text-[12px] font-bold', TONES[tone].label)}>{label}</label>
      {children}
      {hint && !error && <p className="text-[11px] font-medium text-slate-500 mt-1">{hint}</p>}
      {error && <p role="alert" className="text-[11px] font-medium text-red-400 mt-1">{error}</p>}
    </div>
  );
}

export function DemoRequestSection({ tone = 'dark' }: { tone?: Tone } = {}) {
  const s = TONES[tone];
  const fieldCls = cn(fieldBase, s.field);
  const t = useTranslations('Landing.Demo');
  const locale = useLocale();
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const tType = useTranslations('Landing.CompanyType');

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(demoRequestSchema), defaultValues: { businessTypes: [], businessOther: '' } });
  const businessTypes = useWatch({ control, name: 'businessTypes' });
  const businessOther = useWatch({ control, name: 'businessOther' });
  const today = riyadhToday();
  const maxDay = addDays(today, 120);

  const onSubmit = async (data: FormData) => {
    setServerError(false);
    try {
      const res = await fetch('/api/demo/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, businessOther: otherOpen ? data.businessOther : '', locale }),
      });
      if (!res.ok) throw new Error('server');
      setSubmitted(true);
    } catch {
      setServerError(true);
    }
  };

  const includes = [
    { icon: Play, key: 'includes_1' },
    { icon: BarChart3, key: 'includes_2' },
    { icon: CheckCircle2, key: 'includes_3' },
    { icon: MessageCircle, key: 'includes_4' },
  ] as const;

  return (
    <section id="demo" className={cn("py-16 md:py-24 relative overflow-hidden border-t", s.section)}>
      <div
        className={cn("absolute start-1/4 top-0 w-[500px] h-[300px] rounded-full pointer-events-none", s.glow)}
        style={{ background: 'radial-gradient(ellipse, rgba(32,203,213,0.045) 0%, transparent 70%)' }}
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-12 md:mb-16">
          <div className={cn("inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border mb-4", s.badge)}>
            <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse shrink-0", s.badgeDot)} aria-hidden="true" />
            <span className={cn('text-[11px] font-bold', s.badgeText, locale !== 'ar' ? 'tracking-widest uppercase' : '')}>
              {t('badge')}
            </span>
          </div>
          <h2 className={cn("text-3xl md:text-4xl font-black mb-3", s.title)}>
            {t('title')}{' '}
            <span className={cn("text-transparent bg-clip-text bg-gradient-to-r", s.titleAccent)}>
              {t('title_accent')}
            </span>
          </h2>
          <p className={cn("max-w-xl mx-auto text-base leading-relaxed", s.desc)}>{t('desc')}</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">
          {/* Benefits */}
          <div className="space-y-3">
            <p className={cn("font-bold text-sm mb-5", s.includesTitle)}>{t('includes_title')}</p>
            {includes.map(({ icon: Icon, key }) => (
              <div
                key={key}
                className={cn("flex items-center gap-4 p-4 rounded-xl border transition-colors duration-200", s.item)}
              >
                <div className={cn("w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0", s.itemIcon)}>
                  <Icon size={15} className={s.itemIconColor} />
                </div>
                <span className={cn("text-sm font-medium", s.itemText)}>{t(key)}</span>
              </div>
            ))}
            <div className={cn("mt-4 p-4 rounded-xl border flex items-center gap-3", s.note)}>
              <Calendar size={15} className={cn("shrink-0", s.noteIcon)} />
              <span className={cn("text-[13px]", s.noteText)}>{t('availability_note')}</span>
            </div>
          </div>

          {/* Form */}
          <div className={cn("border rounded-2xl p-6 md:p-8", s.card)}>
            {submitted ? (
              <div className="text-center py-8 space-y-4">
                <div className="w-14 h-14 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mx-auto">
                  <CheckCircle2 size={28} className="text-emerald-400" />
                </div>
                <h3 className={cn("text-xl font-black", s.heading)}>{t('success_title')}</h3>
                <p className={cn("text-sm leading-relaxed max-w-xs mx-auto", s.muted)}>{t('success_desc')}</p>
              </div>
            ) : (
              <>
                <h3 className={cn("text-lg font-black mb-6", s.heading)}>{t('form_title')}</h3>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                  <Field tone={tone} label={t('form_name_label')} htmlFor="demo-name" error={errors.name ? t('err_name') : undefined}>
                    <input
                      id="demo-name"
                      aria-invalid={!!errors.name}
                      {...register('name')}
                      placeholder={t('form_name_ph')}
                      className={cn(fieldCls, errors.name && errorBorderCls)}
                      autoComplete="name"
                    />
                  </Field>

                  <Field tone={tone} label={t('form_company_label')} htmlFor="demo-company" error={errors.company ? t('err_company') : undefined}>
                    <input
                      id="demo-company"
                      aria-invalid={!!errors.company}
                      {...register('company')}
                      placeholder={t('form_company_ph')}
                      className={cn(fieldCls, errors.company && errorBorderCls)}
                      autoComplete="organization"
                    />
                  </Field>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field tone={tone} label={t('form_phone_label')} htmlFor="demo-phone" error={errors.phone ? t('err_phone') : undefined}>
                      <input
                        id="demo-phone"
                        aria-invalid={!!errors.phone}
                        {...register('phone')}
                        placeholder={t('form_phone_ph')}
                        type="tel"
                        dir="ltr"
                        className={cn(fieldCls, errors.phone && errorBorderCls)}
                        autoComplete="tel"
                      />
                    </Field>
                    <Field tone={tone} label={t('form_email_label')} htmlFor="demo-email" error={errors.email ? t('err_email') : undefined}>
                      <input
                        id="demo-email"
                        aria-invalid={!!errors.email}
                        {...register('email')}
                        placeholder={t('form_email_ph')}
                        type="email"
                        dir="ltr"
                        className={cn(fieldCls, errors.email && errorBorderCls)}
                        autoComplete="email"
                      />
                    </Field>
                  </div>

                  <CompanyTypePicker
                    tone={tone}
                    idPrefix="demo"
                    value={businessTypes ?? []}
                    other={businessOther ?? ''}
                    otherOpen={otherOpen}
                    error={errors.businessTypes ? tType('err') : undefined}
                    onChange={(types) => setValue('businessTypes', types, { shouldValidate: true })}
                    onOtherChange={(text) => setValue('businessOther', text, { shouldValidate: true })}
                    onOtherOpenChange={(open) => {
                      setOtherOpen(open);
                      if (!open) setValue('businessOther', '', { shouldValidate: true });
                    }}
                  />

                  <Field tone={tone} label={t('form_date_label')} htmlFor="demo-date" hint={t('form_date_hint')} error={errors.preferredDate ? t('err_date') : undefined}>
                    <input
                      id="demo-date"
                      aria-invalid={!!errors.preferredDate}
                      {...register('preferredDate')}
                      type="date"
                      min={today}
                      max={maxDay}
                      dir="ltr"
                      className={cn(fieldCls, s.date, 'text-start', errors.preferredDate && errorBorderCls)}
                    />
                  </Field>

                  {serverError && (
                    <p className="text-[12px] text-red-400 font-medium text-center">{t('server_error')}</p>
                  )}

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-12 bg-[#0369A1] hover:bg-sky-500 text-white font-black rounded-xl border-none shadow-lg shadow-cta/20 transition-all hover:scale-[1.01] disabled:opacity-60 disabled:scale-100 mt-2"
                  >
                    {isSubmitting ? t('form_submitting') : t('form_submit')}
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
