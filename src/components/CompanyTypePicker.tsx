"use client"

import { useTranslations } from "next-intl"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  COMPANY_TYPES,
  isAllCompanyTypes,
  toggleAllCompanyTypes,
  toggleCompanyType,
  type CompanyType,
} from "@/lib/company-types"

type Props = {
  idPrefix: string
  value: CompanyType[]
  other: string
  otherOpen: boolean
  error?: string
  onChange: (types: CompanyType[]) => void
  onOtherChange: (text: string) => void
  onOtherOpenChange: (open: boolean) => void
  /** "dark" — the dark landing form (default); "auto" — light, with `dark:` variants for a themed page. */
  tone?: "dark" | "auto"
}

const chipBase =
  "inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20CBD5]/60"
const TONES = {
  dark: {
    chipOn: "border-[#20CBD5]/60 bg-[#20CBD5]/10 text-white",
    chipOff: "border-white/[0.1] bg-white/[0.04] text-slate-400 hover:border-white/20 hover:text-slate-200",
    label: "text-slate-400",
    hint: "text-slate-500",
    input: "border-white/[0.1] bg-white/[0.04] text-white placeholder:text-slate-600 focus:border-[#20CBD5]/50 focus:bg-white/[0.06]",
  },
  auto: {
    chipOn: "border-cta/50 bg-cta/[0.08] text-cta dark:border-accent/60 dark:bg-accent/10 dark:text-white",
    chipOff: "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-primary dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-slate-200",
    label: "text-slate-600 dark:text-slate-400",
    hint: "text-slate-500",
    input: "border-slate-200 bg-white text-primary placeholder:text-slate-400 focus:border-cta/50 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-600 dark:focus:border-accent/50 dark:focus:bg-white/[0.06]",
  },
} as const

export function CompanyTypePicker({ idPrefix, value, other, otherOpen, error, onChange, onOtherChange, onOtherOpenChange, tone = "dark" }: Props) {
  const t = useTranslations("Landing.CompanyType")
  const s = TONES[tone]
  const all = isAllCompanyTypes(value)

  const chip = (key: string, label: string, on: boolean, onClick: () => void) => (
    <button key={key} type="button" role="checkbox" aria-checked={on} onClick={onClick} className={cn(chipBase, on ? s.chipOn : s.chipOff, error && !on && "border-red-500/40")}>
      {on && <Check size={14} aria-hidden="true" />}
      {label}
    </button>
  )

  return (
    <fieldset className="space-y-1.5">
      <legend className={cn("mb-1.5 block text-[12px] font-bold", s.label)}>{t("label")}</legend>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("label")}>
        {COMPANY_TYPES.map((type) => chip(type, t(type), value.includes(type), () => onChange(toggleCompanyType(value, type))))}
        {chip("all", t("all"), all, () => onChange(toggleAllCompanyTypes(value)))}
        {chip("other", t("other"), otherOpen, () => onOtherOpenChange(!otherOpen))}
      </div>
      <p className={cn("text-[11px] font-medium", s.hint)}>{t("hint")}</p>
      {otherOpen && (
        <div className="space-y-1.5 pt-1">
          <label htmlFor={`${idPrefix}-type-other`} className={cn("block text-[12px] font-bold", s.label)}>{t("other_label")}</label>
          <input
            id={`${idPrefix}-type-other`}
            value={other}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder={t("other_ph")}
            maxLength={120}
            dir="auto"
            className={cn("h-11 w-full rounded-xl border px-3 text-sm font-medium focus:outline-none", s.input)}
          />
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-[11px] font-medium text-red-400">{error}</p>}
    </fieldset>
  )
}
