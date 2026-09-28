"use client"

// The twelve contract terms as fields — the original before start, and the
// "to" values of an addendum after it. A changed field is marked so the reader
// sees what the addendum touches. Every field says what it means in riyals
// before it is saved (holders of money), and "nobody pays" hides the terms
// that only exist when someone pays: advance, retention, payment periods.

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { pmMoney, pmPct } from "@/lib/pm/format"
import { ADVANCE_RECOVERY, PAYERS, PRICING_BASES, RETENTION_RELEASE, type ContractTerms, type TermKey } from "@/lib/pm/terms"
import { cn } from "@/lib/utils"
import { FormHint } from "./ContractBits"

const toPct = (f: number) => String(Math.round(f * 10000) / 100)
const fromPct = (s: string) => (s.trim() === "" ? NaN : Number(s) / 100)

export function TermsFields({
  value,
  onChange,
  disabled,
  changed,
  idPrefix = "t",
  contractValue,
  payerChangedFrom,
  hint,
  financeAdvance,
}: {
  value: ContractTerms
  onChange: <K extends keyof ContractTerms>(k: K, v: ContractTerms[K]) => void
  disabled?: boolean
  /** Terms that differ from what is in force — marked beside their label. */
  changed?: ReadonlySet<TermKey>
  idPrefix?: string
  /** The contract value — given only to holders of money; the riyal hints follow it. */
  contractValue?: number
  /** The payer as stored: changing it warns that every money screen relabels. */
  payerChangedFrom?: ContractTerms["payer"]
  /** An addendum's per-term consequence (the prototype's amdHint). */
  hint?: (k: TermKey) => string | undefined
  /** The advance Finance already holds (prj:ADV was sent) — changing it warns
   * that the change does not reach Finance as that term. Null: not sent. */
  financeAdvance?: number | null
}) {
  const t = useTranslations("Portal.PM")
  const ct = contractValue
  const money = (f: number) => (ct !== undefined ? pmMoney(ct * f) : null)
  const mark = (k: TermKey) => (changed?.has(k) ? "rounded-lg bg-warning/5 p-2 ring-1 ring-warning/40" : "")
  const tag = (k: TermKey) => (changed?.has(k) ? <span className="ms-1.5 rounded bg-warning/15 px-1 text-[10px] font-bold text-warning">{t("amend.changed")}</span> : null)
  const paid = value.payer !== "none"
  const extra = (k: TermKey) => {
    const h = hint?.(k)
    return h ? <FormHint>{h}</FormHint> : null
  }

  const pctHint = (key: "advance" | "retention" | "retentionCap"): ReactNode => {
    const v = value[key]
    if (!Number.isFinite(v)) return null
    if (key === "advance") return <FormHint>{v > 0 ? (money(v) ? t("terms.hint.advance", { amount: money(v) as string }) : null) : t("terms.hint.no_advance")}</FormHint>
    if (key === "retention") return <FormHint>{v > 0 ? (money(v) ? t("terms.hint.retention", { amount: money(v) as string }) : null) : t("terms.hint.no_retention")}</FormHint>
    return <FormHint>{v < value.retention ? t("terms.hint.cap_stops", { rate: pmPct(value.retention), cap: pmPct(v) }) : t("terms.hint.cap_not_reached")}</FormHint>
  }

  const pctField = (key: "advance" | "retention" | "retentionCap") => (
    <div className={cn("space-y-1.5", mark(key))}>
      <Label htmlFor={`${idPrefix}-${key}`}>
        {t(`terms.${key}`)}
        {tag(key)}
      </Label>
      <Input id={`${idPrefix}-${key}`} type="number" min="0" max="100" step="any" inputMode="decimal" dir="ltr" value={Number.isNaN(value[key]) ? "" : toPct(value[key])} onChange={(e) => onChange(key, fromPct(e.target.value))} disabled={disabled} />
      {pctHint(key)}
      {key === "advance" && financeAdvance != null && Number.isFinite(value.advance) && Math.abs(value.advance - financeAdvance) > 1e-9 && <FormHint tone="warn">{t("terms.hint.adv_sent")}</FormHint>}
      {extra(key)}
    </div>
  )
  const dayHint: Record<"paymentDays" | "consultantDays" | "claimNoticeDays" | "defectsDays", () => string> = {
    paymentDays: () => t("terms.hint.payment"),
    consultantDays: () => t("terms.hint.cycle", { cycle: t("days", { count: (value.paymentDays || 0) + (value.consultantDays || 0) }) }),
    claimNoticeDays: () => t("terms.hint.notice"),
    defectsDays: () => t("terms.hint.defects"),
  }
  const dayField = (key: "paymentDays" | "consultantDays" | "claimNoticeDays" | "defectsDays") => (
    <div className={cn("space-y-1.5", mark(key))}>
      <Label htmlFor={`${idPrefix}-${key}`}>
        {t(`terms.${key}`)}
        {tag(key)}
      </Label>
      <Input id={`${idPrefix}-${key}`} type="number" min="0" step="1" inputMode="numeric" dir="ltr" value={Number.isNaN(value[key]) ? "" : String(value[key])} onChange={(e) => onChange(key, e.target.value === "" ? NaN : Number(e.target.value))} disabled={disabled} />
      <FormHint>{dayHint[key]()}</FormHint>
      {extra(key)}
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
      {(key === "payer" || key === "basis") && <FormHint>{t(`terms.mean.${key as "payer"}.${value[key] as "owner"}`)}</FormHint>}
      {key === "payer" && payerChangedFrom !== undefined && value.payer !== payerChangedFrom && (
        <Callout tone="warn" className="mt-1 py-2 text-xs">
          {t("terms.hint.payer_changed")}
        </Callout>
      )}
      {extra(key)}
    </div>
  )

  const gap = ct !== undefined && paid ? Math.max(0, ct * Math.min(value.retention || 0, value.retentionCap || 0) - ct * (value.advance || 0)) : null

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {choice("payer", PAYERS)}
      {choice("basis", PRICING_BASES)}
      {paid && pctField("advance")}
      {paid && choice("advanceRecovery", ADVANCE_RECOVERY)}
      {paid && pctField("retention")}
      {paid && pctField("retentionCap")}
      {paid && choice("retentionRelease", RETENTION_RELEASE)}
      {paid && dayField("paymentDays")}
      {paid && dayField("consultantDays")}
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
              {money(value.damages.cap) && value.damages.cap > 0 && <FormHint>{t("terms.hint.worst", { amount: money(value.damages.cap) as string })}</FormHint>}
            </div>
          </div>
        )}
        {extra("damages")}
      </div>
      {ct !== undefined && (
        <div className="rounded-xl border px-3 sm:col-span-2">
          <KeyValueRow label={t("terms.contract_value")} value={pmMoney(ct)} ltr />
          {gap !== null && <KeyValueRow label={t("terms.cash.gap")} value={<span className={gap > ct * 0.03 ? "text-warning" : undefined}>{pmMoney(gap)}</span>} ltr strong />}
          {gap !== null && <p className="pb-2 text-end text-[11px] text-muted-foreground">{t("terms.hint.gap")}</p>}
        </div>
      )}
    </div>
  )
}
