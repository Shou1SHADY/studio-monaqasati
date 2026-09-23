"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeftRight, Loader2, Lock, Users } from "lucide-react"
import { useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useAccounting } from "@/hooks/useAccounting"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import { ACC, accountName } from "@/lib/accounting/accounts"
import { agingReport, openBalancesByParty, NO_PARTY, type OpenBalance } from "@/lib/accounting/analytics"
import { ClosedPeriodError, isPeriodClosed, periodOf, round2 } from "@/lib/accounting/journal"
import { saveManualEntry } from "@/lib/accounting/manual-entry"
import {
  CASH_ACCOUNTS,
  CUSTOMER_ACCOUNTS,
  SETTLEMENT_DEFS,
  SETTLEMENT_DEF,
  SUPPLIER_ACCOUNTS,
  settlementLines,
  suggestedSettlementAmount,
  type SettlementKind,
  type SettlementParty,
} from "@/lib/accounting/settlements"
import { isoToday } from "@/lib/accounting/periods"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingSection, AccountingShell, Money, accountingBasePath, useMoneyFormat } from "./AccountingShell"
import { AccountingToolbar, ScaleCaption, periodRangeText } from "./AccountingToolbar"
import { EmptyBooks, Kpi, LoadingBooks } from "./AccountingParts"

const BUCKET_KEYS = ["acc_aging_0_30", "acc_aging_31_60", "acc_aging_61_90", "acc_aging_90_plus"]

/**
 * Settlements (التسويات): who owes the company and whom it owes, aged, with the
 * clearing vouchers that close those balances — a receipt against a receivable,
 * a payment against a payable, an advance offset, a retention release, a
 * write-off. Every settlement posts a balanced, party-tagged entry, so the
 * statements, the party's statement of account and the aging all move with it.
 */
export function SettlementsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  const { can } = usePermissions()
  const canPost = can("accounting.post")
  const { compact } = useMoneyFormat()
  const [side, setSide] = useState<SettlementParty>("customer")
  const [target, setTarget] = useState<OpenBalance | null>(null)

  const asOf = data.period.to
  const accounts = side === "customer" ? CUSTOMER_ACCOUNTS : SUPPLIER_ACCOUNTS
  const balances = useMemo(() => openBalancesByParty(data.entries, accounts, asOf), [data.entries, accounts, asOf])
  const aging = useMemo(
    () =>
      side === "customer"
        ? agingReport(data.entries, { accounts: [ACC.clientsReceivable], side: "debit", asOf, filter: data.filter })
        : agingReport(data.entries, { accounts: [ACC.suppliersPayable], side: "credit", asOf, filter: data.filter }),
    [data.entries, side, asOf, data.filter]
  )
  const unassigned = aging.rows.find((r) => r.key === NO_PARTY)?.total ?? 0

  const net = (b: OpenBalance) =>
    side === "customer"
      ? round2((b.byAccount[ACC.clientsReceivable] ?? 0) + (b.byAccount[ACC.retentionReceivable] ?? 0) - (b.byAccount[ACC.advancesFromClients] ?? 0))
      : round2((b.byAccount[ACC.suppliersPayable] ?? 0) - (b.byAccount[ACC.advancesToSuppliers] ?? 0))

  const columns =
    side === "customer"
      ? [
          { code: ACC.clientsReceivable, key: "acc_settle_col_receivable" },
          { code: ACC.retentionReceivable, key: "acc_settle_col_retention" },
          { code: ACC.advancesFromClients, key: "acc_settle_col_advance_received" },
        ]
      : [
          { code: ACC.suppliersPayable, key: "acc_settle_col_payable" },
          { code: ACC.advancesToSuppliers, key: "acc_settle_col_advance_paid" },
        ]

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_settlements")}
      description={t("acc_settle_desc")}
      icon={ArrowLeftRight}
      toolbar={<AccountingToolbar data={data} />}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label={t("acc_settle_side")} className="flex items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5">
          {(["customer", "supplier"] as SettlementParty[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => setSide(s)}
              className={cn(
                "h-8 px-3 rounded-md text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                side === s ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-white"
              )}
            >
              {t(s === "customer" ? "acc_settle_side_customers" : "acc_settle_side_suppliers")}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("acc_settle_as_of")} <span dir="ltr" className="font-semibold tabular-nums">{asOf}</span>
        </p>
      </div>

      {!canPost && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} aria-hidden="true" />
          {t("acc_settle_read_only")}
        </p>
      )}

      {data.isLoading ? (
        <LoadingBooks />
      ) : data.entries.length === 0 ? (
        <EmptyBooks />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {aging.buckets.map((v, i) => (
              <Kpi key={BUCKET_KEYS[i]} label={t(BUCKET_KEYS[i])} value={compact(v)} tone={i === 3 && v > 0.5 ? "bad" : i === 2 && v > 0.5 ? "warn" : "default"} />
            ))}
            <Kpi
              label={t(side === "customer" ? "acc_settle_total_receivable" : "acc_settle_total_payable")}
              value={compact(aging.total)}
              hint={unassigned ? t("acc_settle_unassigned", { amount: compact(unassigned) }) : undefined}
            />
          </div>

          <AccountingSection
            title={t(side === "customer" ? "acc_settle_customers_title" : "acc_settle_suppliers_title", { count: balances.length })}
            icon={Users}
            action={<ScaleCaption scale={data.scale} />}
          >
            {balances.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">{t("acc_settle_nothing_open")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-start">{t("acc_je_party")}</th>
                      {columns.map((c) => (
                        <th key={c.code} className="px-4 py-2.5 text-end">
                          {t(c.key)} <span className="font-mono font-normal" dir="ltr">{c.code}</span>
                        </th>
                      ))}
                      <th className="px-4 py-2.5 text-end">{t("acc_settle_col_net")}</th>
                      <th className="px-4 py-2.5 text-end">{t("acc_settle_col_oldest")}</th>
                      <th className="px-4 py-2.5 w-28" />
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b) => {
                      const agingRow = aging.rows.find((r) => r.key === b.key)
                      return (
                        <tr key={b.key} className="border-t">
                          <td className="px-4 py-2.5 font-semibold">{b.name || b.key}</td>
                          {columns.map((c) => (
                            <td key={c.code} className="px-4 py-2.5 text-end"><Money value={b.byAccount[c.code] ?? 0} /></td>
                          ))}
                          <td className="px-4 py-2.5 text-end font-bold"><Money value={net(b)} /></td>
                          <td className="px-4 py-2.5 text-end text-xs tabular-nums text-muted-foreground" dir="ltr">{agingRow?.oldestDate ?? "—"}</td>
                          <td className="px-4 py-2.5 text-end">
                            {canPost && (
                              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setTarget(b)}>
                                <ArrowLeftRight size={13} aria-hidden="true" />
                                {t("acc_settle_action")}
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </AccountingSection>

          {aging.rows.length > 0 && (
            <AccountingSection title={t("acc_settle_aging_title", { range: periodRangeText(data.period) })} icon={Users}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-start">{t("acc_je_party")}</th>
                      {BUCKET_KEYS.map((k) => (
                        <th key={k} className="px-4 py-2.5 text-end">{t(k)}</th>
                      ))}
                      <th className="px-4 py-2.5 text-end">{t("acc_total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aging.rows.map((r) => (
                      <tr key={r.key} className="border-t">
                        <td className="px-4 py-2.5">{r.key === NO_PARTY ? <span className="text-muted-foreground">{t("acc_settle_no_party")}</span> : r.name || r.key}</td>
                        {r.buckets.map((v, i) => (
                          <td key={i} className={cn("px-4 py-2.5 text-end", i === 3 && v > 0.5 && "text-destructive font-semibold")}><Money value={v} /></td>
                        ))}
                        <td className="px-4 py-2.5 text-end font-bold"><Money value={r.total} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AccountingSection>
          )}
        </div>
      )}

      {target && (
        <SettlementDialog
          portal={portal}
          side={side}
          party={target}
          onClose={() => setTarget(null)}
          locale={locale}
        />
      )}
    </AccountingShell>
  )
}

function SettlementDialog({
  portal,
  side,
  party,
  onClose,
  locale,
}: {
  portal: CrmPortal
  side: SettlementParty
  party: OpenBalance
  onClose: () => void
  locale: string
}) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const router = useRouter()
  const { toast } = useToast()
  const data = useAccounting()
  const kinds = SETTLEMENT_DEFS.filter((d) => d.party === side)
  const [kind, setKind] = useState<SettlementKind>(kinds[0].kind)
  const [amount, setAmount] = useState(String(suggestedSettlementAmount(kinds[0].kind, party.byAccount) || ""))
  const [cashAccount, setCashAccount] = useState<string>(ACC.bankMain)
  const [date, setDate] = useState(isoToday())
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  const def = SETTLEMENT_DEF[kind]
  const value = round2(Number(amount) || 0)
  const closed = isPeriodClosed(data.periods, date)
  const lines = settlementLines(kind, {
    amount: value,
    cashAccount,
    party: party.key.startsWith("name:") ? null : party.key,
    partyName: party.name || null,
    note: note.trim() || null,
  })

  const pickKind = (k: SettlementKind) => {
    setKind(k)
    setAmount(String(suggestedSettlementAmount(k, party.byAccount) || ""))
  }

  const submit = async () => {
    if (!firestore || saving || value <= 0 || closed) return
    setSaving(true)
    try {
      const res = await saveManualEntry(firestore, {
        organizationId: data.organizationId,
        userId: data.userId,
        userName: data.userName,
        date,
        description: `${t(`acc_settle_kind_${kind}`)} — ${party.name || party.key}`,
        reference,
        lines,
        status: "posted",
        sourceType: "settlement",
      })
      toast({ title: t("acc_settle_saved", { number: res.entryNumber }) })
      onClose()
      router.push(`${accountingBasePath(portal)}/journal?entry=${encodeURIComponent(res.id)}`)
    } catch (err) {
      console.error(err)
      toast({
        title: err instanceof ClosedPeriodError ? t("acc_entry_closed_period", { period: err.period }) : t("acc_save_error"),
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("acc_settle_dialog_title", { party: party.name || party.key })}</DialogTitle>
          <DialogDescription>{t("acc_settle_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label>{t("acc_settle_kind")}</Label>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {kinds.map((d) => (
                <button
                  key={d.kind}
                  type="button"
                  aria-pressed={kind === d.kind}
                  onClick={() => pickKind(d.kind)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-start text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    kind === d.kind ? "border-primary bg-primary/5 font-bold text-primary" : "hover:bg-muted/40"
                  )}
                >
                  {t(`acc_settle_kind_${d.kind}`)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{t(`acc_settle_kind_${kind}_hint`)}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="settle-amount">{t("acc_amount")} *</Label>
              <Input id="settle-amount" dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settle-date">{t("acc_date")} *</Label>
              <Input id="settle-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {def.usesCash && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="settle-cash">{t("acc_settle_cash_account")}</Label>
                <SearchableSelect
                  id="settle-cash"
                  size="md"
                  value={cashAccount}
                  onChange={setCashAccount}
                  options={CASH_ACCOUNTS.map((c) => ({ value: c, label: `${c} — ${accountName(c, locale)}` }))}
                  placeholder={t("acc_settle_cash_account")}
                  searchPlaceholder={t("acc_search_options")}
                  noResultsText={t("acc_no_options")}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="settle-ref">{t("acc_entry_reference")}</Label>
              <Input id="settle-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settle-note">{t("acc_je_line_note")}</Label>
              <Input id="settle-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          {closed && (
            <p className="flex items-center gap-1 text-[11px] text-destructive">
              <Lock size={11} aria-hidden="true" />
              {t("acc_entry_closed_period", { period: periodOf(date) })}
            </p>
          )}

          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="mb-1.5 text-[11px] font-bold text-muted-foreground">{t("acc_settle_preview")}</p>
            <table className="w-full text-xs">
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-border/50 first:border-t-0">
                    <td className="py-1">
                      <span className="font-mono text-muted-foreground me-1.5" dir="ltr">{l.account}</span>
                      {accountName(l.account, locale)}
                    </td>
                    <td className="py-1 text-end w-24">{Number(l.debit) ? <Money value={Number(l.debit)} scale="units" /> : "—"}</td>
                    <td className="py-1 text-end w-24">{Number(l.credit) ? <Money value={Number(l.credit)} scale="units" /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("acc_cancel")}</Button>
          <Button onClick={submit} disabled={saving || value <= 0 || closed} className="gap-1.5">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
            {t("acc_settle_post")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
