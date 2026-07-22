"use client";

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations, useLocale } from 'next-intl';
import { CheckCircle2, Play, BarChart3, MessageCircle, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const schema = z.object({
  name: z.string().trim().min(2),
  company: z.string().trim().min(2),
  phone: z.string().trim().min(7).regex(/^[+\d\s().\-]+$/),
  email: z.string().trim().email(),
});
type FormData = z.infer<typeof schema>;

const fieldCls =
  'w-full h-11 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-600 px-4 text-sm font-medium focus:outline-none focus:border-[#20CBD5]/40 focus:bg-white/[0.06] transition-all';
const errorBorderCls = 'border-red-500/40 focus:border-red-500/50';

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[12px] font-bold text-slate-400">{label}</label>
      {children}
      {error && <p className="text-[11px] font-medium text-red-400 mt-1">{error}</p>}
    </div>
  );
}

export function DemoRequestSection() {
  const t = useTranslations('Landing.Demo');
  const locale = useLocale();
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setServerError(false);
    try {
      const res = await fetch('/api/demo/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, locale }),
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
    <section id="demo" className="py-16 md:py-24 bg-[#030712] relative overflow-hidden border-t border-white/5">
      <div
        className="absolute start-1/4 top-0 w-[500px] h-[300px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(ellipse, rgba(32,203,213,0.045) 0%, transparent 70%)' }}
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-12 md:mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#20CBD5]/20 bg-[#20CBD5]/[0.06] mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-[#20CBD5] animate-pulse shrink-0" aria-hidden="true" />
            <span className={cn('text-[#20CBD5] text-[11px] font-bold', locale !== 'ar' ? 'tracking-widest uppercase' : '')}>
              {t('badge')}
            </span>
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-white mb-3">
            {t('title')}{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300">
              {t('title_accent')}
            </span>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto text-base leading-relaxed">{t('desc')}</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">
          {/* Benefits */}
          <div className="space-y-3">
            <p className="text-slate-300 font-bold text-sm mb-5">{t('includes_title')}</p>
            {includes.map(({ icon: Icon, key }) => (
              <div
                key={key}
                className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.025] border border-white/[0.06] hover:border-[#20CBD5]/20 transition-colors duration-200"
              >
                <div className="w-9 h-9 rounded-[10px] bg-[#20CBD5]/[0.10] flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-[#20CBD5]" />
                </div>
                <span className="text-slate-300 text-sm font-medium">{t(key)}</span>
              </div>
            ))}
            <div className="mt-4 p-4 rounded-xl bg-sky-500/[0.06] border border-sky-500/[0.14] flex items-center gap-3">
              <Calendar size={15} className="text-sky-400 shrink-0" />
              <span className="text-slate-400 text-[13px]">{t('availability_note')}</span>
            </div>
          </div>

          {/* Form */}
          <div className="bg-[#0a1628]/90 backdrop-blur border border-[#20CBD5]/[0.12] rounded-2xl p-6 md:p-8 shadow-[0_32px_80px_rgba(0,0,0,.45)]">
            {submitted ? (
              <div className="text-center py-8 space-y-4">
                <div className="w-14 h-14 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mx-auto">
                  <CheckCircle2 size={28} className="text-emerald-400" />
                </div>
                <h3 className="text-xl font-black text-white">{t('success_title')}</h3>
                <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">{t('success_desc')}</p>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-black text-white mb-6">{t('form_title')}</h3>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                  <Field label={t('form_name_label')} error={errors.name ? t('err_name') : undefined}>
                    <input
                      {...register('name')}
                      placeholder={t('form_name_ph')}
                      className={cn(fieldCls, errors.name && errorBorderCls)}
                      autoComplete="name"
                    />
                  </Field>

                  <Field label={t('form_company_label')} error={errors.company ? t('err_company') : undefined}>
                    <input
                      {...register('company')}
                      placeholder={t('form_company_ph')}
                      className={cn(fieldCls, errors.company && errorBorderCls)}
                      autoComplete="organization"
                    />
                  </Field>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label={t('form_phone_label')} error={errors.phone ? t('err_phone') : undefined}>
                      <input
                        {...register('phone')}
                        placeholder={t('form_phone_ph')}
                        type="tel"
                        dir="ltr"
                        className={cn(fieldCls, errors.phone && errorBorderCls)}
                        autoComplete="tel"
                      />
                    </Field>
                    <Field label={t('form_email_label')} error={errors.email ? t('err_email') : undefined}>
                      <input
                        {...register('email')}
                        placeholder={t('form_email_ph')}
                        type="email"
                        dir="ltr"
                        className={cn(fieldCls, errors.email && errorBorderCls)}
                        autoComplete="email"
                      />
                    </Field>
                  </div>

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
