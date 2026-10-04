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
}

const chipBase =
  "inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20CBD5]/60"
const chipOn = "border-[#20CBD5]/60 bg-[#20CBD5]/10 text-white"
const chipOff = "border-white/[0.1] bg-white/[0.04] text-slate-400 hover:border-white/20 hover:text-slate-200"

export function CompanyTypePicker({ idPrefix, value, other, otherOpen, error, onChange, onOtherChange, onOtherOpenChange }: Props) {
  const t = useTranslations("Landing.CompanyType")
  const all = isAllCompanyTypes(value)

  const chip = (key: string, label: string, on: boolean, onClick: () => void) => (
    <button key={key} type="button" role="checkbox" aria-checked={on} onClick={onClick} className={cn(chipBase, on ? chipOn : chipOff, error && !on && "border-red-500/40")}>
      {on && <Check size={14} aria-hidden="true" />}
      {label}
    </button>
  )

  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 block text-[12px] font-bold text-slate-400">{t("label")}</legend>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("label")}>
        {COMPANY_TYPES.map((type) => chip(type, t(type), value.includes(type), () => onChange(toggleCompanyType(value, type))))}
        {chip("all", t("all"), all, () => onChange(toggleAllCompanyTypes(value)))}
        {chip("other", t("other"), otherOpen, () => onOtherOpenChange(!otherOpen))}
      </div>
      <p className="text-[11px] font-medium text-slate-500">{t("hint")}</p>
      {otherOpen && (
        <div className="space-y-1.5 pt-1">
          <label htmlFor={`${idPrefix}-type-other`} className="block text-[12px] font-bold text-slate-400">{t("other_label")}</label>
          <input
            id={`${idPrefix}-type-other`}
            value={other}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder={t("other_ph")}
            maxLength={120}
            dir="auto"
            className="h-11 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 text-sm font-medium text-white placeholder:text-slate-600 focus:border-[#20CBD5]/50 focus:bg-white/[0.06] focus:outline-none"
          />
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-[11px] font-medium text-red-400">{error}</p>}
    </fieldset>
  )
}
