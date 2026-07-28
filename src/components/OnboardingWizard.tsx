"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations, useLocale } from "next-intl"
import { CATEGORIES_DATA, SUBCATEGORY_UNIT_MAP } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { X, Plus, Trash2, ArrowLeft, CheckCircle2, Loader2, Package } from "lucide-react"

interface Item {
  id: string
  category: string
  subCategory: string
  quantity: string
  unit: string
}

const EMPTY_ITEM = (): Item => ({ id: Date.now().toString(), category: "", subCategory: "", quantity: "", unit: "" })

const inputCls =
  "w-full h-10 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-600 px-3 text-sm font-medium focus:outline-none focus:border-[#20CBD5]/50 focus:bg-white/[0.06] transition-all"
const errorBorderCls = "border-red-500/40 focus:border-red-500/50"
const selectCls =
  "w-full h-10 rounded-xl bg-[#0f1e33] border border-white/[0.1] text-sm font-medium px-3 focus:outline-none focus:border-[#20CBD5]/50 transition-all appearance-none cursor-pointer"

export function OnboardingWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Landing.Onboarding")
  const locale = useLocale()

  const [step, setStep] = useState(1)
  const [name, setName] = useState("")
  const [company, setCompany] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [items, setItems] = useState<Item[]>([EMPTY_ITEM()])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const reset = useCallback(() => {
    setStep(1); setName(""); setCompany(""); setPhone(""); setEmail("")
    setItems([EMPTY_ITEM()]); setErrors({}); setSubmitting(false); setDone(false)
  }, [])

  const handleClose = useCallback(() => { reset(); onClose() }, [reset, onClose])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, handleClose])

  useEffect(() => { if (open) { document.body.style.overflow = "hidden" } else { document.body.style.overflow = "" } }, [open])

  const validateStep1 = () => {
    const e: Record<string, string> = {}
    if (!name.trim() || name.trim().length < 2) e.name = t("err_name")
    if (!company.trim() || company.trim().length < 2) e.company = t("err_company")
    if (!phone.trim() || !/^[+\d\s().\-]{7,}$/.test(phone.trim())) e.phone = t("err_phone")
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = t("err_email")
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateStep2 = () => {
    const hasValid = items.some(i => i.category && i.quantity)
    if (!hasValid) { setErrors({ items: t("err_items") }); return false }
    setErrors({})
    return true
  }

  const updateItem = (id: string, field: keyof Item, value: string) => {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i
      const updated = { ...i, [field]: value }
      if (field === "category") { updated.subCategory = ""; updated.unit = "" }
      if (field === "subCategory") { updated.unit = SUBCATEGORY_UNIT_MAP[value] || "" }
      return updated
    }))
  }

  const handleSubmit = async () => {
    if (!validateStep2()) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/onboarding/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, company, phone, email,
          items: items.filter(i => i.category && i.quantity),
          locale,
        }),
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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-[#020617]/90 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      <div
        className="relative z-10 w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0a1628] border border-white/[0.08] shadow-[0_40px_100px_rgba(0,0,0,.7)] flex flex-col"
        onClick={e => e.stopPropagation()}
        dir={locale === "ar" ? "rtl" : "ltr"}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/[0.06] shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-bold text-[#20CBD5] uppercase tracking-widest">
                {t("step_of", { current: done ? 2 : step, total: 2 })}
              </span>
            </div>
            <h2 className="text-lg font-black text-white">
              {done ? t("success_title") : step === 1 ? t("step1_title") : t("step2_title")}
            </h2>
            {!done && (
              <p className="text-slate-400 text-xs mt-0.5">
                {step === 1 ? t("step1_desc") : t("step2_desc")}
              </p>
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

        {/* Progress bar */}
        {!done && (
          <div className="h-0.5 w-full bg-white/[0.06] shrink-0">
            <div
              className="h-full bg-[#20CBD5] transition-all duration-500"
              style={{ width: step === 1 ? "50%" : "100%" }}
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 px-6 py-6 space-y-4 min-h-0">

          {/* ── Success ── */}
          {done && (
            <div className="py-8 flex flex-col items-center text-center gap-5">
              <div className="w-16 h-16 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center">
                <CheckCircle2 size={30} className="text-emerald-400" />
              </div>
              <div className="space-y-2">
                <p className="text-slate-300 text-sm leading-relaxed max-w-xs mx-auto">
                  {t("success_desc")}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="mt-2 px-8 py-2.5 rounded-xl bg-[#20CBD5] hover:bg-[#18b8c2] text-[#0a1628] font-black text-sm transition-all"
              >
                {t("success_close")}
              </button>
            </div>
          )}

          {/* ── Step 1: Contact ── */}
          {!done && step === 1 && (
            <div className="space-y-4">
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
            </div>
          )}

          {/* ── Step 2: Items ── */}
          {!done && step === 2 && (
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={item.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
                      <Package size={11} />
                      {t("item_no", { n: idx + 1 })}
                    </span>
                    {items.length > 1 && (
                      <button
                        onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                        className="text-slate-600 hover:text-red-400 transition-colors"
                        aria-label={t("remove_item")}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={item.category}
                      onChange={e => updateItem(item.id, "category", e.target.value)}
                      className={cn(selectCls, !item.category ? "text-slate-600" : "text-white")}
                    >
                      <option value="" disabled>{t("category_ph")}</option>
                      {Object.keys(CATEGORIES_DATA).map(cat => (
                        <option key={cat} value={cat} className="bg-[#0f1e33] text-white">{cat}</option>
                      ))}
                    </select>

                    <select
                      value={item.subCategory}
                      onChange={e => updateItem(item.id, "subCategory", e.target.value)}
                      disabled={!item.category}
                      className={cn(selectCls, !item.subCategory ? "text-slate-600" : "text-white", !item.category && "opacity-40 cursor-not-allowed")}
                    >
                      <option value="" disabled>{t("subcategory_ph")}</option>
                      {item.category && CATEGORIES_DATA[item.category]?.map(sub => (
                        <option key={sub} value={sub} className="bg-[#0f1e33] text-white">{sub}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min={0}
                      value={item.quantity}
                      onChange={e => updateItem(item.id, "quantity", e.target.value)}
                      placeholder={t("quantity_ph")}
                      className={inputCls}
                      dir="ltr"
                    />
                    <input
                      value={item.unit}
                      onChange={e => updateItem(item.id, "unit", e.target.value)}
                      placeholder={t("unit_ph")}
                      className={inputCls}
                    />
                  </div>
                </div>
              ))}

              {errors.items && (
                <p className="text-xs font-medium text-red-400">{errors.items}</p>
              )}

              {items.length < 10 && (
                <button
                  onClick={() => setItems(prev => [...prev, EMPTY_ITEM()])}
                  className="w-full h-9 rounded-xl border border-dashed border-white/[0.12] text-slate-500 hover:text-[#20CBD5] hover:border-[#20CBD5]/30 transition-all flex items-center justify-center gap-1.5 text-xs font-bold"
                >
                  <Plus size={13} />
                  {t("add_item")}
                </button>
              )}

              {errors.submit && (
                <p className="text-xs font-medium text-red-400 text-center">{errors.submit}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div className="px-6 pb-6 pt-3 border-t border-white/[0.06] shrink-0 flex items-center gap-3">
            {step === 2 && (
              <button
                onClick={() => { setErrors({}); setStep(1) }}
                className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm font-bold transition-colors"
              >
                <ArrowLeft size={14} className={locale === "ar" ? "rotate-180" : ""} />
                {t("back")}
              </button>
            )}
            <button
              onClick={step === 1 ? () => { if (validateStep1()) setStep(2) } : handleSubmit}
              disabled={submitting}
              className="ms-auto flex items-center gap-2 h-11 px-7 rounded-xl bg-[#20CBD5] hover:bg-[#18b8c2] text-[#0a1628] font-black text-sm transition-all disabled:opacity-60 shadow-lg shadow-[#20CBD5]/20"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {step === 1 ? t("next") : submitting ? t("submitting") : t("submit")}
              {step === 1 && !submitting && (
                <ArrowLeft size={14} className={locale === "ar" ? "rotate-0" : "rotate-180"} />
              )}
            </button>
          </div>
        )}
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
