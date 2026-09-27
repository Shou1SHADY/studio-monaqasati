"use client"

// The twelve contract terms as fields — the original before start, and the
// "to" values of an addendum after it. A changed field is marked so the reader
// sees what the addendum touches.

import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ADVANCE_RECOVERY, PAYERS, PRICING_BASES, RETENTION_RELEASE, type ContractTerms, type TermKey } from "@/lib/pm/terms"
import { cn } from "@/lib/utils"

const toPct = (f: number) => String(Math.round(f * 10000) / 100)
const fromPct = (s: string) => (s.trim() === "" ? NaN : Number(s) / 100)

export function TermsFields({
  value,
  onChange,
  disabled,
  changed,
  idPrefix = "t",
}: {
  value: ContractTerms
  onChange: <K extends keyof ContractTerms>(k: K, v: ContractTerms[K]) => void
  disabled?: boolean
  /** Terms that differ from what is in force — marked beside their label. */
  changed?: ReadonlySet<TermKey>
  idPrefix?: string
}) {
  const t = useTranslations("Portal.PM")
  const mark = (k: TermKey) => (changed?.has(k) ? "rounded-lg bg-warning/5 p-2 ring-1 ring-warning/40" : "")
  const tag = (k: TermKey) => (changed?.has(k) ? <span className="ms-1.5 rounded bg-warning/15 px-1 text-[10px] font-bold text-warning">{t("amend.changed")}</span> : null)

  const pctField = (key: "advance" | "retention" | "retentionCap") => (
    <div className={cn("space-y-1.5", mark(key))}>
      <Label htmlFor={`${idPrefix}-${key}`}>
        {t(`terms.${key}`)}
        {tag(key)}
      </Label>
      <Input id={`${idPrefix}-${key}`} type="number" min="0" max="100" step="any" inputMode="decimal" dir="ltr" value={Number.isNaN(value[key]) ? "" : toPct(value[key])} onChange={(e) => onChange(key, fromPct(e.target.value))} disabled={disabled} />
    </div>
  )
  const dayField = (key: "paymentDays" | "consultantDays" | "claimNoticeDays" | "defectsDays") => (
    <div className={cn("space-y-1.5", mark(key))}>
      <Label htmlFor={`${idPrefix}-${key}`}>
        {t(`terms.${key}`)}
        {tag(key)}
      </Label>
      <Input id={`${idPrefix}-${key}`} type="number" min="0" step="1" inputMode="numeric" dir="ltr" value={Number.isNaN(value[key]) ? "" : String(value[key])} onChange={(e) => onChange(key, e.target.value === "" ? NaN : Number(e.target.value))} disabled={disabled} />
    </div>
  )
  const choice = <K extends "payer" | "basis" | "advanceRecovery" | "retentionRelease">(key: K, options: readonly ContractTerms[K][]) => (
    <div className={cn("space-y-1.5", mark(key))}>
      <Label htmlFor={`${idPrefix}-${key}`}>
        {t(`terms.${key as string}` as "terms.save")}
        {tag(key)}
      </Label>
      <Select value={value[key] as string} onValueChange={(v) => onChange(key, v as ContractTerms[K])} disabled={disabled}>
        <SelectTrigger id={`${idPrefix}-${key}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o as string} value={o as string}>
              {t(`terms.opt.${key as string}.${o as string}` as "terms.save")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {choice("payer", PAYERS)}
      {choice("basis", PRICING_BASES)}
      {pctField("advance")}
      {choice("advanceRecovery", ADVANCE_RECOVERY)}
      {pctField("retention")}
      {pctField("retentionCap")}
      {choice("retentionRelease", RETENTION_RELEASE)}
      {dayField("paymentDays")}
      {dayField("consultantDays")}
      {dayField("claimNoticeDays")}
      {dayField("defectsDays")}
      <div className={cn("space-y-2 rounded-xl border p-3 sm:col-span-2", changed?.has("damages") && "border-warning/40 bg-warning/5")}>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Label htmlFor={`${idPrefix}-dmg`}>
            {t("terms.damages")}
            {tag("damages")}
          </Label>
          <Switch id={`${idPrefix}-dmg`} checked={value.damages.on} onCheckedChange={(v) => onChange("damages", { ...value.damages, on: v })} disabled={disabled} />
        </div>
        {value.damages.on && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-dmg-rate`}>{t("terms.damages_rate")}</Label>
              <Input id={`${idPrefix}-dmg-rate`} type="number" min="0" step="any" dir="ltr" value={toPct(value.damages.weeklyRate)} onChange={(e) => onChange("damages", { ...value.damages, weeklyRate: fromPct(e.target.value) })} disabled={disabled} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-dmg-cap`}>{t("terms.damages_cap")}</Label>
              <Input id={`${idPrefix}-dmg-cap`} type="number" min="0" step="any" dir="ltr" value={toPct(value.damages.cap)} onChange={(e) => onChange("damages", { ...value.damages, cap: fromPct(e.target.value) })} disabled={disabled} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
