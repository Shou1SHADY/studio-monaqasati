"use client"

// Tax & zakat screens beside VAT: withholding tax and the zakat base (finance
// review, 23 Sep 2026). Both read the ledger through src/lib/accounting; the
// only writes are the accountant's decisions — a remittance, a zakat provision
// or payment, the zakat working paper, WHT rate overrides.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowDownToLine, Calculator, CheckCircle2, Coins, Info, Landmark, Loader2, Percent, Plus, Save, Trash2 } from "lucide-react"
import { doc } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useAccounting, type AccountingData } from "@/hooks/useAccounting"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import { ACC, accountName } from "@/lib/accounting/accounts"
import { ClosedPeriodError, isPeriodClosed, periodOf, round2 } from "@/lib/accounting/journal"
import { saveManualEntry } from "@/lib/accounting/manual-entry"
import { CASH_ACCOUNTS } from "@/lib/accounting/settlements"
import { saveAccountingSettings } from "@/lib/accounting/settings"
import { fiscalYearLabel, fiscalYearRange, isoToday } from "@/lib/accounting/periods"
import { WHT_TYPES, whtRate, whtRegister, whtTypeName } from "@/lib/accounting/withholding"
import {
  ACCOUNTING_ZAKAT,
  ZAKAT_RATES,
  saveZakatSchedule,
  zakatComputation,
  zakatDocId,
  zakatProvisionLines,
  type ZakatAdjustment,
  type ZakatComponentKey,
  type ZakatOverride,
  type ZakatRateBasis,
  type ZakatScheduleDoc,
} from "@/lib/accounting/zakat"
import { scheduleExportDoc } from "@/lib/accounting/export-docs"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingSection, AccountingShell, Money, useMoneyFormat } from "./AccountingShell"
import { AccountingToolbar, ScaleCaption, periodLabel, periodRangeText } from "./AccountingToolbar"
import { Kpi, LoadingBooks } from "./AccountingParts"
import { JournalEntrySheet } from "./JournalEntrySheet"
import { ExportMenu } from "./ExportMenu"

/** Digits, one dot and a leading minus — an override or adjustment may reduce the base. */
const signedDecimal = (v: string) => {
  const neg = v.trim().startsWith("-")
  const body = v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1")
  return (neg ? "-" : "") + body
}

const pctText = (rate: number) => `${Math.round(rate * 10000) / 100}%`

// ─────────────────────────────────────────────────────────────────────────────
// A cash posting — WHT remitted, zakat paid: Dr a liability, Cr a bank account
// ─────────────────────────────────────────────────────────────────────────────

function CashPostingDialog({
  open,
  onOpenChange,
  title,
  description,
  defaultAmount,
  defaultDate,
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  defaultAmount: number
  defaultDate?: string
  submitLabel: string
  onSubmit: (input: { date: string; amount: number; account: string; reference: string }) => Promise<void>
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const [date, setDate] = useState(isoToday())
  const [amount, setAmount] = useState("")
  const [account, setAccount] = useState<string>(ACC.bankMain)
  const [reference, setReference] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setDate(defaultDate ?? isoToday())
      setAmount(defaultAmount > 0 ? String(round2(defaultAmount)) : "")
      setReference("")
    }
  }, [open, defaultAmount, defaultDate])
  const value = Number(amount) || 0
  const submit = async () => {
    if (value <= 0 || busy) return
    setBusy(true)
    try {
      await onSubmit({ date, amount: value, account, reference })
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tax-post-amount">{t("acc_amount")} *</Label>
            <Input id="tax-post-amount" dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))} className="text-end tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax-post-date">{t("acc_date")} *</Label>
            <Input id="tax-post-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tax-post-bank">{t("acc_settle_cash_account")}</Label>
            <SearchableSelect
              id="tax-post-bank"
              size="md"
              value={account}
              onChange={setAccount}
              options={CASH_ACCOUNTS.map((c) => ({ value: c, label: `${c} — ${accountName(c, locale)}` }))}
              placeholder={t("acc_settle_cash_account")}
              searchPlaceholder={t("acc_search_options")}
              noResultsText={t("acc_no_options")}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tax-post-ref">{t("acc_entry_reference")}</Label>
            <Input id="tax-post-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("acc_tax_reference_placeholder")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("acc_cancel")}</Button>
          <Button onClick={submit} disabled={value <= 0 || busy} className="gap-1.5">
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Posting failures in words: a closed month says which. */
function usePostingFailure() {
  const t = useTranslations("Portal.Shared")
  const { toast } = useToast()
  return (err: unknown) => {
    console.error(err)
    toast({
      title: err instanceof ClosedPeriodError ? t("acc_entry_closed_period", { period: err.period }) : t("acc_save_error"),
      variant: "destructive",
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Withholding tax
// ─────────────────────────────────────────────────────────────────────────────

export function WhtView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  const firestore = useFirestore()
  const { toast } = useToast()
  const fail = usePostingFailure()
  const { can } = usePermissions()
  const canPost = can("accounting.post")
  const canEditRates = can("accounting.close")
  const { compact } = useMoneyFormat()
  const [entryId, setEntryId] = useState<string | null>(null)
  const [remit, setRemit] = useState<{ month: string; amount: number } | null>(null)

  const register = useMemo(() => whtRegister(data.entries, data.period.to), [data.entries, data.period.to])
  const inPeriod = register.rows.filter((r) => r.date >= data.period.from && r.date <= data.period.to)
  const withheldInPeriod = round2(inPeriod.reduce((s, r) => s + r.amount, 0))
  const nextDue = register.byMonth.filter((m) => m.outstanding > 0).map((m) => m.dueDate).sort()[0] ?? null
  const today = isoToday()

  const [rates, setRates] = useState<Record<string, string>>({})
  useEffect(() => {
    setRates(Object.fromEntries(WHT_TYPES.map((w) => [w.id, String(Math.round(whtRate(w.id, data.settings.whtRates) * 10000) / 100)])))
  }, [data.settings.whtRates])
  const ratesDirty = WHT_TYPES.some((w) => Math.abs((Number(rates[w.id]) || 0) / 100 - whtRate(w.id, data.settings.whtRates)) > 1e-9)
  const [savingRates, setSavingRates] = useState(false)
  const saveRates = async () => {
    if (!firestore || !canEditRates) return
    setSavingRates(true)
    try {
      const overrides: Record<string, number> = {}
      for (const w of WHT_TYPES) {
        const r = round2(Number(rates[w.id]) || 0) / 100
        if (Math.abs(r - w.rate) > 1e-9) overrides[w.id] = r
      }
      await saveAccountingSettings(firestore, {
        existingDocId: data.settingsDoc?.id ?? null,
        organizationId: data.organizationId,
        settings: { ...data.settings, whtRates: overrides },
        actor: { id: data.userId, name: data.userName },
      })
      toast({ title: t("acc_settings_saved") })
    } catch (err) {
      fail(err)
    } finally {
      setSavingRates(false)
    }
  }

  const postRemittance = async (input: { date: string; amount: number; account: string; reference: string }) => {
    if (!firestore || !remit) return
    try {
      const res = await saveManualEntry(firestore, {
        organizationId: data.organizationId,
        userId: data.userId,
        userName: data.userName,
        date: input.date,
        description: t("acc_wht_remit_desc", { month: remit.month }),
        reference: input.reference,
        sourceType: "wht_remittance",
        status: "posted",
        lines: [
          { account: ACC.withholdingTaxPayable, debit: input.amount, credit: 0, partyName: t("acc_tax_authority") },
          { account: input.account, debit: 0, credit: input.amount },
        ],
      })
      toast({ title: t("acc_je_saved_posted", { number: res.entryNumber }) })
    } catch (err) {
      fail(err)
      throw err
    }
  }

  const statusBadge = (status: string) =>
    status === "remitted" ? (
      <Badge className="border-none bg-success/10 text-success">{t("acc_wht_status_remitted")}</Badge>
    ) : status === "partial" ? (
      <Badge className="border-none bg-warning/10 text-warning">{t("acc_wht_status_partial")}</Badge>
    ) : (
      <Badge className="border-none bg-muted text-muted-foreground">{t("acc_wht_status_outstanding")}</Badge>
    )

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_wht")}
      description={t("acc_wht_desc")}
      icon={ArrowDownToLine}
      toolbar={<AccountingToolbar data={data} showProject={false} />}
      exportDoc={() => {
        if (data.isLoading) return null
        const base = {
          title: t("acc_nav_wht"),
          subtitle: `${periodLabel(data.period, locale)} · ${periodRangeText(data.period)}`,
          locale,
          organizationId: data.organizationId,
          period: { from: data.period.from, to: data.period.to },
          fileName: `${t("acc_nav_wht")}_${data.period.from}_${data.period.to}`,
        }
        const docOut = scheduleExportDoc(
          base,
          [
            {
              title: t("acc_wht_summary"),
              rows: [
                { label: t("acc_wht_kpi_withheld"), value: withheldInPeriod },
                { label: t("acc_wht_kpi_remitted"), value: register.remitted },
                { label: t("acc_wht_kpi_outstanding"), value: register.outstanding, emphasis: "total" },
              ],
            },
          ],
          t,
          [
            { concept: "mdmak:WithholdingTaxWithheld", value: withheldInPeriod, context: "duration" },
            { concept: "mdmak:WithholdingTaxPayable", value: register.outstanding, context: "instant" },
          ]
        )
        docOut.sections.push({
          title: t("acc_wht_register"),
          columns: [
            { header: t("acc_date"), kind: "date" },
            { header: t("acc_export_col_entry_no"), kind: "number" },
            { header: t("acc_wht_supplier"), kind: "text" },
            { header: t("acc_wht_type"), kind: "text" },
            { header: t("acc_wht_base"), kind: "money" },
            { header: t("acc_wht_rate_pct"), kind: "percent" },
            { header: t("acc_wht_amount"), kind: "money" },
            { header: t("acc_wht_outstanding"), kind: "money" },
            { header: t("acc_wht_due"), kind: "date" },
          ],
          rows: inPeriod.map((r) => ({
            cells: [r.date, r.entryNumber, r.partyName, r.type ? whtTypeName(r.type, locale) : t("acc_wht_unclassified"), r.base, r.rate, r.amount, r.outstanding, r.dueDate],
          })),
        })
        return docOut
      }}
    >
      {data.isLoading ? (
        <LoadingBooks />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t("acc_wht_kpi_withheld")} value={compact(withheldInPeriod)} hint={t("acc_wht_kpi_withheld_hint", { count: inPeriod.length })} />
            <Kpi label={t("acc_wht_kpi_remitted")} value={compact(register.remitted)} hint={t("acc_wht_kpi_to_date")} />
            <Kpi label={t("acc_wht_kpi_outstanding")} value={compact(register.outstanding)} tone={register.outstanding > 0 ? "warn" : "good"} hint={t("acc_wht_kpi_outstanding_hint", { account: ACC.withholdingTaxPayable })} />
            <Kpi
              label={t("acc_wht_kpi_next_due")}
              value={nextDue ?? "—"}
              tone={nextDue && nextDue < today ? "bad" : "default"}
              hint={nextDue && nextDue < today ? t("acc_wht_overdue") : t("acc_wht_due_rule")}
            />
          </div>

          <AccountingSection title={t("acc_wht_by_month")} icon={Landmark} action={<ScaleCaption scale={data.scale} />}>
            {register.byMonth.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">{t("acc_wht_empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-start">{t("acc_wht_month")}</th>
                      <th className="px-4 py-2.5 text-end">{t("acc_wht_amount")}</th>
                      <th className="px-4 py-2.5 text-end">{t("acc_wht_outstanding")}</th>
                      <th className="px-4 py-2.5 text-start">{t("acc_wht_due")}</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {register.byMonth.map((m) => (
                      <tr key={m.month} className="border-t">
                        <td className="px-4 py-2.5 tabular-nums" dir="ltr">{m.month}</td>
                        <td className="px-4 py-2.5 text-end"><Money value={m.withheld} /></td>
                        <td className="px-4 py-2.5 text-end font-bold"><Money value={m.outstanding} /></td>
                        <td className={cn("px-4 py-2.5 tabular-nums", m.outstanding > 0 && m.dueDate < today && "font-bold text-destructive")} dir="ltr">{m.dueDate}</td>
                        <td className="px-4 py-2.5 text-end">
                          {m.outstanding > 0 ? (
                            canPost && (
                              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setRemit({ month: m.month, amount: m.outstanding })}>
                                {t("acc_wht_remit")}
                              </Button>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 size={13} aria-hidden="true" />{t("acc_wht_status_remitted")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AccountingSection>

          <AccountingSection title={t("acc_wht_register")} icon={ArrowDownToLine} action={<ScaleCaption scale={data.scale} />}>
            {inPeriod.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">{t("acc_wht_empty_period")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-start">{t("acc_date")}</th>
                      <th className="px-4 py-2.5 text-start">{t("acc_wht_supplier")}</th>
                      <th className="px-4 py-2.5 text-start">{t("acc_wht_type")}</th>
                      <th className="px-4 py-2.5 text-end">{t("acc_wht_base")}</th>
                      <th className="px-4 py-2.5 text-end">{t("acc_wht_rate_pct")}</th>
                      <th className="px-4 py-2.5 text-end">{t("acc_wht_amount")}</th>
                      <th className="px-4 py-2.5 text-start">{t("acc_status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inPeriod.map((r, i) => (
                      <tr key={`${r.entryId}-${i}`} className="border-t">
                        <td className="px-4 py-2.5 tabular-nums" dir="ltr">
                          <button type="button" onClick={() => setEntryId(r.entryId)} className="rounded hover:text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {r.date} · #{r.entryNumber}
                          </button>
                        </td>
                        <td className="px-4 py-2.5">{r.partyName || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-2.5 text-xs">{r.type ? whtTypeName(r.type, locale) : <span className="text-muted-foreground">{t("acc_wht_unclassified")}</span>}</td>
                        <td className="px-4 py-2.5 text-end"><Money value={r.base} /></td>
                        <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">{r.rate === null ? "—" : pctText(r.rate)}</td>
                        <td className="px-4 py-2.5 text-end font-bold"><Money value={r.amount} /></td>
                        <td className="px-4 py-2.5">{statusBadge(r.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AccountingSection>

          <AccountingSection
            title={t("acc_wht_rates")}
            icon={Percent}
            action={
              canEditRates && (
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={saveRates} disabled={!ratesDirty || savingRates}>
                  {savingRates ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {t("acc_wht_save_rates")}
                </Button>
              )
            }
          >
            <p className="border-b px-5 py-3 text-xs text-muted-foreground">{t("acc_wht_rates_hint")}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start">{t("acc_wht_type")}</th>
                    <th className="px-4 py-2.5 text-end">{t("acc_wht_reference_rate")}</th>
                    <th className="px-4 py-2.5 text-end w-36">{t("acc_wht_org_rate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {WHT_TYPES.map((w) => (
                    <tr key={w.id} className="border-t">
                      <td className="px-4 py-2">{whtTypeName(w.id, locale)}</td>
                      <td className="px-4 py-2 text-end tabular-nums text-muted-foreground" dir="ltr">{pctText(w.rate)}</td>
                      <td className="px-4 py-2">
                        <Input
                          dir="ltr"
                          inputMode="decimal"
                          aria-label={`${t("acc_wht_org_rate")} — ${whtTypeName(w.id, locale)}`}
                          value={rates[w.id] ?? ""}
                          disabled={!canEditRates}
                          onChange={(e) => setRates((prev) => ({ ...prev, [w.id]: sanitizeDecimalInput(e.target.value) }))}
                          className="h-8 text-end text-xs tabular-nums"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AccountingSection>

          <AccountingSection title={t("acc_wht_flow_title")} icon={Info}>
            <ul className="list-disc space-y-1 p-5 ps-9 text-xs text-muted-foreground">
              <li>{t("acc_wht_flow_1")}</li>
              <li>{t("acc_wht_flow_2")}</li>
              <li>{t("acc_wht_flow_3")}</li>
            </ul>
          </AccountingSection>
        </div>
      )}

      <CashPostingDialog
        open={!!remit}
        onOpenChange={(o) => !o && setRemit(null)}
        title={t("acc_wht_remit_title", { month: remit?.month ?? "" })}
        description={t("acc_wht_remit_hint")}
        defaultAmount={remit?.amount ?? 0}
        submitLabel={t("acc_wht_remit")}
        onSubmit={postRemittance}
      />
      <JournalEntrySheet
        entry={entryId ? data.entries.find((e) => e.id === entryId) ?? null : null}
        entries={data.entries}
        portal={portal}
        onClose={() => setEntryId(null)}
        onOpenEntry={setEntryId}
      />
    </AccountingShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Zakat base
// ─────────────────────────────────────────────────────────────────────────────

type OverrideDraft = { value: string; note: string }

export function ZakatView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_zakat")}
      description={t("acc_zakat_desc")}
      icon={Coins}
      toolbar={<AccountingToolbar data={data} showPeriod={false} showProject={false} />}
    >
      {data.isLoading || !data.organizationId ? <LoadingBooks /> : <ZakatBody key={`${data.organizationId}-${data.fiscalYear}`} data={data} locale={locale} />}
    </AccountingShell>
  )
}

function ZakatBody({ data, locale }: { data: AccountingData; locale: string }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  const fail = usePostingFailure()
  const { can } = usePermissions()
  const canPost = can("accounting.post")
  const { compact } = useMoneyFormat()
  const fy = data.fiscalYear
  const startMonth = data.settings.fiscalYearStartMonth
  const range = fiscalYearRange(fy, startMonth)

  const ref = useMemoFirebase(() => (firestore ? doc(firestore, ACCOUNTING_ZAKAT, zakatDocId(data.organizationId, fy)) : null), [firestore, data.organizationId, fy])
  const { data: saved, isLoading } = useDoc<ZakatScheduleDoc>(ref)

  const [rateBasis, setRateBasis] = useState<ZakatRateBasis>("hijri")
  const [overrides, setOverrides] = useState<Partial<Record<ZakatComponentKey, OverrideDraft>>>({})
  const [adjustments, setAdjustments] = useState<Array<ZakatAdjustment & { amountText: string }>>([])
  const savedKey = JSON.stringify(saved ?? null)
  useEffect(() => {
    setRateBasis(saved?.rateBasis === "gregorian" ? "gregorian" : "hijri")
    const o: Partial<Record<ZakatComponentKey, OverrideDraft>> = {}
    for (const [k, v] of Object.entries(saved?.overrides ?? {})) if (v) o[k as ZakatComponentKey] = { value: String(v.value), note: v.note ?? "" }
    setOverrides(o)
    setAdjustments((saved?.adjustments ?? []).map((a) => ({ ...a, amountText: String(a.amount) })))
    // Reset only when the stored paper changes (a new object arrives on every snapshot).
  }, [savedKey])

  const draftOverrides = useMemo(() => {
    const out: Partial<Record<ZakatComponentKey, ZakatOverride>> = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (v && v.value.trim() !== "" && Number.isFinite(Number(v.value))) out[k as ZakatComponentKey] = { value: Number(v.value), note: v.note }
    }
    return out
  }, [overrides])
  const draftAdjustments = useMemo(
    () => adjustments.map((a) => ({ id: a.id, label: a.label, amount: Number(a.amountText) || 0, note: a.note })).filter((a) => a.amount !== 0),
    [adjustments]
  )
  const z = useMemo(
    () => zakatComputation(data.entries, range, { overrides: draftOverrides, adjustments: draftAdjustments, rateBasis }),
    [data.entries, range.from, range.to, draftOverrides, draftAdjustments, rateBasis]
  )
  const dirty =
    JSON.stringify({ rateBasis, o: draftOverrides, a: draftAdjustments.map((a) => [a.label, a.amount, a.note || ""]) }) !==
    JSON.stringify({
      rateBasis: saved?.rateBasis === "gregorian" ? "gregorian" : "hijri",
      o: Object.fromEntries(Object.entries(saved?.overrides ?? {}).map(([k, v]) => [k, { value: v!.value, note: v!.note ?? "" }])),
      a: (saved?.adjustments ?? []).map((a) => [a.label, a.amount, a.note || ""]),
    })

  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!firestore || !canPost) return
    setSaving(true)
    try {
      await saveZakatSchedule(firestore, {
        organizationId: data.organizationId,
        fiscalYear: fy,
        rateBasis,
        overrides: draftOverrides,
        adjustments: adjustments.map((a) => ({ id: a.id, label: a.label, amount: Number(a.amountText) || 0, note: a.note })),
        actor: { id: data.userId, name: data.userName },
      })
      toast({ title: t("acc_zakat_saved") })
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
    }
  }

  const today = isoToday()
  const provisionDate = today < range.to ? (today < range.from ? range.from : today) : range.to
  const [provisionOpen, setProvisionOpen] = useState(false)
  const [provisionDateText, setProvisionDateText] = useState(provisionDate)
  const [booking, setBooking] = useState(false)
  const provisionDateValid = provisionDateText >= range.from && provisionDateText <= range.to
  const bookProvision = async () => {
    if (!firestore || !canPost || Math.abs(z.toBook) < 0.005 || !provisionDateValid) return
    setBooking(true)
    try {
      const note = t("acc_zakat_provision_note", { year: fiscalYearLabel(fy, startMonth) })
      const res = await saveManualEntry(firestore, {
        organizationId: data.organizationId,
        userId: data.userId,
        userName: data.userName,
        date: provisionDateText,
        description: z.toBook >= 0 ? t("acc_zakat_provision_desc", { year: fiscalYearLabel(fy, startMonth) }) : t("acc_zakat_release_desc", { year: fiscalYearLabel(fy, startMonth) }),
        sourceType: "zakat_provision",
        status: "posted",
        lines: zakatProvisionLines(z.toBook, note),
      })
      toast({ title: t("acc_je_saved_posted", { number: res.entryNumber }) })
      setProvisionOpen(false)
    } catch (err) {
      fail(err)
    } finally {
      setBooking(false)
    }
  }

  const [payOpen, setPayOpen] = useState(false)
  const payZakat = async (input: { date: string; amount: number; account: string; reference: string }) => {
    if (!firestore) return
    try {
      const res = await saveManualEntry(firestore, {
        organizationId: data.organizationId,
        userId: data.userId,
        userName: data.userName,
        date: input.date,
        description: t("acc_zakat_payment_desc", { year: fiscalYearLabel(fy, startMonth) }),
        reference: input.reference,
        sourceType: "zakat_payment",
        status: "posted",
        lines: [
          { account: ACC.zakatPayable, debit: input.amount, credit: 0, partyName: t("acc_tax_authority") },
          { account: input.account, debit: 0, credit: input.amount },
        ],
      })
      toast({ title: t("acc_je_saved_posted", { number: res.entryNumber }) })
    } catch (err) {
      fail(err)
      throw err
    }
  }

  const exportDoc = () => {
    const title = `${t("acc_nav_zakat")} — ${fiscalYearLabel(fy, startMonth)}`
    return scheduleExportDoc(
      { title, subtitle: `${range.from} → ${range.to}`, locale, organizationId: data.organizationId, period: range, fileName: `${t("acc_nav_zakat")}_${fiscalYearLabel(fy, startMonth)}` },
      [
        {
          title: t("acc_zakat_components"),
          rows: [
            ...z.components.map((c) => ({ label: `${c.sign < 0 ? "− " : "+ "}${t(c.labelKey)}${c.override ? ` (${t("acc_zakat_overridden")})` : ""}`, value: c.sign * c.value })),
            ...z.adjustments.map((a) => ({ label: `${t("acc_zakat_adjustment")}: ${a.label}`, value: Number(a.amount), level: 1 })),
            { label: t("acc_zakat_base"), value: z.base, emphasis: "total" as const },
            { label: `${t("acc_zakat_due")} (${pctText(z.rate)})`, value: z.zakat, emphasis: "total" as const },
            { label: t("acc_zakat_booked"), value: z.booked },
            { label: t("acc_zakat_to_book"), value: z.toBook },
            { label: t("acc_zakat_payable"), value: z.payable },
          ],
        },
      ],
      t,
      [
        { concept: "mdmak:ZakatBaseEquity", value: z.components[0].value, context: "instant" },
        { concept: "mdmak:ZakatBaseAdjustedProfit", value: z.components[1].value, context: "duration" },
        { concept: "mdmak:ZakatBaseLongTermLoans", value: z.components[2].value, context: "instant" },
        { concept: "mdmak:ZakatBaseProvisions", value: z.components[3].value, context: "instant" },
        { concept: "mdmak:ZakatBaseNonCurrentAssetsDeducted", value: z.components[4].value, context: "instant" },
        { concept: "mdmak:ZakatBaseOtherAdjustments", value: z.adjustmentsTotal, context: "duration" },
        { concept: "mdmak:ZakatBase", value: z.base, context: "instant" },
        { concept: "mdmak:ZakatDue", value: z.zakat, context: "duration" },
        { concept: "mdmak:ZakatPayable", value: z.payable, context: "instant" },
      ]
    )
  }

  if (isLoading) return <LoadingBooks />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold">
          {t("acc_zakat_for_year", { year: fiscalYearLabel(fy, startMonth) })} <span className="font-normal text-muted-foreground" dir="ltr">· {range.from} → {range.to}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {canPost && (
            <Button className="gap-1.5" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {t("acc_zakat_save")}
            </Button>
          )}
          {/* The shell's menu is built for period screens; the zakat paper is annual. */}
          <ExportMenu build={exportDoc} hasXbrl />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("acc_zakat_base")} value={compact(z.base)} hint={z.floorApplied ? t("acc_zakat_floor_applied") : t("acc_zakat_base_hint")} />
        <Kpi label={t("acc_zakat_due")} value={compact(z.zakat)} hint={t("acc_zakat_rate_hint", { rate: pctText(z.rate) })} />
        <Kpi label={t("acc_zakat_booked")} value={compact(z.booked)} hint={t("acc_zakat_booked_hint", { account: ACC.zakatExpense })} tone={Math.abs(z.toBook) < 0.005 ? "good" : "warn"} />
        <Kpi label={t("acc_zakat_payable")} value={compact(z.payable)} hint={t("acc_zakat_payable_hint", { account: ACC.zakatPayable })} />
      </div>

      <AccountingSection title={t("acc_zakat_components")} icon={Calculator} action={<ScaleCaption scale={data.scale} />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-start">{t("acc_export_col_item")}</th>
                <th className="px-4 py-2.5 text-end w-40">{t("acc_zakat_system")}</th>
                <th className="px-4 py-2.5 text-end w-40">{t("acc_zakat_override")}</th>
                <th className="px-4 py-2.5 text-start">{t("acc_zakat_override_note")}</th>
                <th className="px-4 py-2.5 text-end w-40">{t("acc_zakat_used")}</th>
              </tr>
            </thead>
            <tbody>
              {z.components.map((c) => {
                const o = overrides[c.key]
                return (
                  <tr key={c.key} className="border-t align-top">
                    <td className="px-4 py-2.5">
                      <span className={cn("me-1 font-bold", c.sign < 0 ? "text-destructive" : "text-success")}>{c.sign < 0 ? "−" : "+"}</span>
                      {t(c.labelKey)}
                      <span className="ms-2 font-mono text-[11px] text-muted-foreground" dir="ltr">{c.codes.join(" · ")}</span>
                    </td>
                    <td className="px-4 py-2.5 text-end"><Money value={c.system} /></td>
                    <td className="px-4 py-2">
                      <Input
                        dir="ltr"
                        inputMode="decimal"
                        aria-label={`${t("acc_zakat_override")} — ${t(c.labelKey)}`}
                        placeholder={t("acc_zakat_override_placeholder")}
                        value={o?.value ?? ""}
                        disabled={!canPost}
                        onChange={(e) => setOverrides((prev) => ({ ...prev, [c.key]: { value: signedDecimal(e.target.value), note: prev[c.key]?.note ?? "" } }))}
                        className="h-8 text-end text-xs tabular-nums"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        aria-label={`${t("acc_zakat_override_note")} — ${t(c.labelKey)}`}
                        value={o?.note ?? ""}
                        disabled={!canPost || !o?.value}
                        onChange={(e) => setOverrides((prev) => ({ ...prev, [c.key]: { value: prev[c.key]?.value ?? "", note: e.target.value } }))}
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className={cn("px-4 py-2.5 text-end font-bold", c.override && "text-cta")}>
                      <Money value={c.sign * c.value} />
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t bg-muted/20">
                <td className="px-4 py-2.5 font-bold" colSpan={4}>
                  <div className="flex items-center justify-between gap-2">
                    {t("acc_zakat_adjustments")}
                    {canPost && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1 text-xs"
                        onClick={() => setAdjustments((prev) => [...prev, { id: Math.random().toString(36).slice(2, 10), label: "", amount: 0, amountText: "", note: "" }])}
                      >
                        <Plus size={13} />
                        {t("acc_zakat_add_adjustment")}
                      </Button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-end font-bold"><Money value={z.adjustmentsTotal} /></td>
              </tr>
              {adjustments.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-4 py-2" colSpan={2}>
                    <Input
                      aria-label={t("acc_zakat_adjustment_label")}
                      placeholder={t("acc_zakat_adjustment_label")}
                      value={a.label}
                      disabled={!canPost}
                      onChange={(e) => setAdjustments((prev) => prev.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)))}
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      aria-label={t("acc_zakat_adjustment_amount")}
                      placeholder="±0.00"
                      value={a.amountText}
                      disabled={!canPost}
                      onChange={(e) => setAdjustments((prev) => prev.map((x) => (x.id === a.id ? { ...x, amountText: signedDecimal(e.target.value) } : x)))}
                      className="h-8 text-end text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      aria-label={t("acc_zakat_override_note")}
                      value={a.note ?? ""}
                      disabled={!canPost}
                      onChange={(e) => setAdjustments((prev) => prev.map((x) => (x.id === a.id ? { ...x, note: e.target.value } : x)))}
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="px-4 py-2 text-end">
                    {canPost && (
                      <button
                        type="button"
                        aria-label={t("acc_zakat_remove_adjustment")}
                        onClick={() => setAdjustments((prev) => prev.filter((x) => x.id !== a.id))}
                        className="inline-grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {adjustments.length === 0 && (
                <tr className="border-t">
                  <td className="px-4 py-2 text-xs text-muted-foreground" colSpan={5}>{t("acc_zakat_adjustments_hint")}</td>
                </tr>
              )}
              <tr className="border-t bg-primary/5 font-black">
                <td className="px-4 py-2.5" colSpan={4}>
                  {t("acc_zakat_base")}
                  {z.floorApplied && <span className="ms-2 text-xs font-normal text-warning">{t("acc_zakat_floor_applied")}</span>}
                </td>
                <td className="px-4 py-2.5 text-end"><Money value={z.base} /></td>
              </tr>
              <tr className="border-t">
                <td className="px-4 py-2.5" colSpan={4}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{t("acc_zakat_due")}</span>
                    <div role="radiogroup" aria-label={t("acc_zakat_rate_basis")} className="flex items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5">
                      {(Object.keys(ZAKAT_RATES) as ZakatRateBasis[]).map((b) => (
                        <button
                          key={b}
                          type="button"
                          role="radio"
                          aria-checked={rateBasis === b}
                          disabled={!canPost}
                          onClick={() => setRateBasis(b)}
                          className={cn(
                            "h-7 rounded-md px-2.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                            rateBasis === b ? "bg-primary text-white" : "text-slate-600 hover:bg-white"
                          )}
                        >
                          {t(`acc_zakat_rate_${b}`, { rate: pctText(ZAKAT_RATES[b]) })}
                        </button>
                      ))}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-end font-black"><Money value={z.zakat} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </AccountingSection>

      <AccountingSection title={t("acc_zakat_books")} icon={Landmark}>
        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2"><span>{t("acc_zakat_due")}</span><Money value={z.zakat} className="font-bold" /></div>
            <div className="flex items-center justify-between gap-2"><span>{t("acc_zakat_booked")}</span><Money value={z.booked} /></div>
            <div className="flex items-center justify-between gap-2 border-t pt-2 font-black">
              <span>{z.toBook >= 0 ? t("acc_zakat_to_book") : t("acc_zakat_to_release")}</span>
              <Money value={Math.abs(z.toBook)} />
            </div>
            {dirty && <p className="text-[11px] text-warning">{t("acc_zakat_save_first")}</p>}
            {canPost && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button className="gap-1.5" disabled={dirty || Math.abs(z.toBook) < 0.005} onClick={() => { setProvisionDateText(provisionDate); setProvisionOpen(true) }}>
                  <Coins size={15} aria-hidden="true" />
                  {z.toBook >= 0 ? t("acc_zakat_book") : t("acc_zakat_release")}
                </Button>
                <Button variant="outline" className="gap-1.5" disabled={z.payable <= 0} onClick={() => setPayOpen(true)}>
                  <Landmark size={15} aria-hidden="true" />
                  {t("acc_zakat_pay")}
                </Button>
              </div>
            )}
          </div>
          <div className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
            <p className="mb-2 font-bold text-foreground">{t("acc_zakat_flow_title")}</p>
            <ul className="list-disc space-y-1 ps-4">
              <li>{t("acc_zakat_flow_is")}</li>
              <li>{t("acc_zakat_flow_bs")}</li>
              <li>{t("acc_zakat_flow_cf")}</li>
            </ul>
            <p className="mt-3">{t("acc_zakat_disclaimer")}</p>
            {saved?.updatedByUserName && (
              <p className="mt-2">{t("acc_zakat_last_saved", { name: saved.updatedByUserName })}</p>
            )}
          </div>
        </div>
      </AccountingSection>

      <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{z.toBook >= 0 ? t("acc_zakat_book") : t("acc_zakat_release")}</DialogTitle>
            <DialogDescription>{t("acc_zakat_book_hint", { amount: Math.abs(z.toBook).toLocaleString("en-US", { minimumFractionDigits: 2 }) })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="zakat-date">{t("acc_date")} *</Label>
            <Input id="zakat-date" type="date" dir="ltr" min={range.from} max={range.to} value={provisionDateText} onChange={(e) => setProvisionDateText(e.target.value)} />
            {!provisionDateValid && <p className="text-[11px] text-destructive">{t("acc_zakat_date_in_year")}</p>}
            {provisionDateValid && isPeriodClosed(data.periods, provisionDateText) && (
              <p className="text-[11px] text-destructive">{t("acc_entry_closed_period", { period: periodOf(provisionDateText) })}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProvisionOpen(false)} disabled={booking}>{t("acc_cancel")}</Button>
            <Button onClick={bookProvision} disabled={booking || !provisionDateValid} className="gap-1.5">
              {booking && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {t("acc_je_post")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CashPostingDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        title={t("acc_zakat_pay")}
        description={t("acc_zakat_pay_hint")}
        defaultAmount={z.payable}
        submitLabel={t("acc_zakat_pay")}
        onSubmit={payZakat}
      />
    </div>
  )
}
