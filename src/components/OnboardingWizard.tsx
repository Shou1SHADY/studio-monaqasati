"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations, useLocale } from "next-intl"
import { cn } from "@/lib/utils"
import { X, CheckCircle2, Loader2 } from "lucide-react"

const inputCls =
  "w-full h-11 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-600 px-3 text-sm font-medium focus:outline-none focus:border-[#20CBD5]/50 focus:bg-white/[0.06] transition-all"
const errorBorderCls = "border-red-500/40 focus:border-red-500/50"

export function OnboardingWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Landing.Onboarding")
  const locale = useLocale()

  const [name, setName] = useState("")
  const [company, setCompany] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const reset = useCallback(() => {
    setName(""); setCompany(""); setPhone(""); setEmail("")
    setErrors({}); setSubmitting(false); setDone(false)
  }, [])

  const handleClose = useCallback(() => { reset(); onClose() }, [reset, onClose])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, handleClose])

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!name.trim() || name.trim().length < 2) e.name = t("err_name")
    if (!company.trim() || company.trim().length < 2) e.company = t("err_company")
    if (!phone.trim() || !/^[+\d\s().\-]{7,}$/.test(phone.trim())) e.phone = t("err_phone")
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = t("err_email")
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/onboarding/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, phone, email, locale }),
      })
      if (!res.ok) throw new Error()
      setDone(true)
    } catch {
      setErrors({ submit: t("server_error") })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#020617]/90 backdrop-blur-sm" onClick={handleClose} aria-hidden="true" />

      <div
        className="relative z-10 w-full max-w-md rounded-2xl bg-[#0a1628] border border-white/[0.08] shadow-[0_40px_100px_rgba(0,0,0,.7)] flex flex-col"
        onClick={e => e.stopPropagation()}
        dir={locale === "ar" ? "rtl" : "ltr"}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/[0.06]">
          <div>
            <h2 className="text-lg font-black text-white">
              {done ? t("success_title") : t("step1_title")}
            </h2>
            {!done && (
              <p className="text-slate-400 text-xs mt-0.5">{t("step1_desc")}</p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all shrink-0"
            aria-label={t("close")}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-4">
          {done ? (
            <div className="py-6 flex flex-col items-center text-center gap-5">
              <div className="w-16 h-16 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center">
                <CheckCircle2 size={30} className="text-emerald-400" />
              </div>
              <p className="text-slate-300 text-sm leading-relaxed max-w-xs mx-auto">
                {t("success_desc")}
              </p>
              <button
                onClick={handleClose}
                className="mt-2 px-8 py-2.5 rounded-xl bg-[#20CBD5] hover:bg-[#18b8c2] text-[#0a1628] font-black text-sm transition-all"
              >
                {t("success_close")}
              </button>
            </div>
          ) : (
            <>
              <Field label={t("name_label")} error={errors.name}>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t("name_ph")}
                  autoComplete="name"
                  className={cn(inputCls, errors.name && errorBorderCls)}
                />
              </Field>
              <Field label={t("company_label")} error={errors.company}>
                <input
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder={t("company_ph")}
                  autoComplete="organization"
                  className={cn(inputCls, errors.company && errorBorderCls)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("phone_label")} error={errors.phone}>
                  <input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder={t("phone_ph")}
                    type="tel"
                    dir="ltr"
                    autoComplete="tel"
                    className={cn(inputCls, errors.phone && errorBorderCls)}
                  />
                </Field>
                <Field label={t("email_label")} error={errors.email}>
                  <input
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={t("email_ph")}
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                    className={cn(inputCls, errors.email && errorBorderCls)}
                  />
                </Field>
              </div>
              {errors.submit && (
                <p className="text-xs font-medium text-red-400 text-center">{errors.submit}</p>
              )}
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full h-11 rounded-xl bg-[#20CBD5] hover:bg-[#18b8c2] text-[#0a1628] font-black text-sm transition-all disabled:opacity-60 shadow-lg shadow-[#20CBD5]/20 flex items-center justify-center gap-2 mt-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? t("submitting") : t("submit")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-bold text-slate-400">{label}</label>
      {children}
      {error && <p className="text-[11px] font-medium text-red-400">{error}</p>}
    </div>
  )
}
