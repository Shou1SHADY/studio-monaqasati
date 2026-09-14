"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { FileSpreadsheet, Printer, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUser } from "@/firebase"
import { useAccounting } from "@/hooks/useAccounting"
import { usePermissions } from "@/hooks/usePermissions"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { cn } from "@/lib/utils"
import { ACC, CHART_OF_ACCOUNTS, accountName } from "@/lib/accounting/accounts"
import { accountStatement, ledgerParties, type AccountStatement } from "@/lib/accounting/analytics"
import { formatMoney } from "@/lib/accounting/display"
import { CUSTOMER_ACCOUNTS, SUPPLIER_ACCOUNTS } from "@/lib/accounting/settlements"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingSection, AccountingShell, Money, useMoneyFormat } from "./AccountingShell"
import { AccountingToolbar, ScaleCaption, periodLabel, periodRangeText } from "./AccountingToolbar"
import { EmptyBooks, Kpi, LoadingBooks, SOURCE_LABEL_KEY } from "./AccountingParts"
import { escapeHtml, openPrintWindow } from "./print"

type Mode = "party" | "account"
type Scope = "all" | "customer" | "supplier"

const SCOPE_CODES: Record<Scope, string[]> = {
  all: [],
  customer: CUSTOMER_ACCOUNTS,
  supplier: SUPPLIER_ACCOUNTS,
}

/**
 * Statements of account (كشوف الحسابات): one counterparty — a customer or a
 * supplier — across the accounts it touches, or one account (leaf or rollup)
 * across everyone. Opening balance, every movement with a running balance, and
 * the closing position, printable as the document sent to the party.
 */
export function AccountStatementsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const data = useAccounting()
  const { user } = useUser()
  const { profile } = usePermissions()
  const companyName = useActiveCompanyName(profile as Parameters<typeof useActiveCompanyName>[0], user?.uid)
  const { compact } = useMoneyFormat()

  const [mode, setMode] = useState<Mode>("party")
  const [party, setParty] = useState("")
  const [scope, setScope] = useState<Scope>("all")
  const [account, setAccount] = useState<string>(ACC.clientsReceivable)

  const parties = useMemo(() => ledgerParties(data.entries).sort((a, b) => a.name.localeCompare(b.name)), [data.entries])
  useEffect(() => {
    if (!party && parties.length > 0) setParty(parties[0].key)
  }, [parties, party])

  const accountOptions = useMemo(() => CHART_OF_ACCOUNTS.filter((a) => a.level >= 3), [])
  const statement: AccountStatement | null = useMemo(() => {
    if (mode === "party" && !party) return null
    return accountStatement(data.entries, {
      codes: mode === "account" ? [account] : SCOPE_CODES[scope],
      party: mode === "party" ? party : null,
      from: data.period.from,
      to: data.period.to,
      filter: data.filter,
    })
  }, [data.entries, data.period.from, data.period.to, data.filter, mode, party, scope, account])

  const subject =
    mode === "party"
      ? parties.find((p) => p.key === party)?.name || "—"
      : `${account} — ${accountName(account, locale)}`

  /** Debit − credit shown the way a statement is read: amount plus its side. */
  const side = (balance: number) => (Math.abs(balance) < 0.005 ? "" : balance > 0 ? t("acc_side_debit") : t("acc_side_credit"))

  const print = () => {
    if (!statement) return
    const fmt = (n: number) => formatMoney(n, "units")
    const rows = statement.rows
      .map(
        (r) => `<tr><td class="num">${escapeHtml(r.date)}</td><td class="num">${r.entryNumber}</td>
<td>${escapeHtml(r.description)}${r.note ? ` — ${escapeHtml(r.note)}` : ""}</td>
<td class="num">${escapeHtml(r.account)}</td>
<td class="num">${r.debit ? fmt(r.debit) : ""}</td><td class="num">${r.credit ? fmt(r.credit) : ""}</td>
<td class="num">${fmt(Math.abs(r.balance))} ${escapeHtml(side(r.balance))}</td></tr>`
      )
      .join("")
    const ok = openPrintWindow({
      title: `${t("acc_stmt_doc_title")} — ${subject}`,
      dir: isRtl ? "rtl" : "ltr",
      bodyHtml: `
<div class="head"><div><h1>${escapeHtml(t("acc_stmt_doc_title"))}</h1>
<div><b>${escapeHtml(subject)}</b></div>
<div class="muted">${escapeHtml(periodLabel(data.period, locale))} · <span dir="ltr">${escapeHtml(periodRangeText(data.period))}</span></div></div>
<div style="text-align:${isRtl ? "left" : "right"}"><b>${escapeHtml(companyName || "")}</b><div class="muted">${escapeHtml(t("acc_stmt_printed_on", { date: new Date().toISOString().slice(0, 10) }))}</div></div></div>
<div class="kpis">
<div class="kpi">${escapeHtml(t("acc_opening_balance"))}<b dir="ltr">${fmt(Math.abs(statement.opening))} ${escapeHtml(side(statement.opening))}</b></div>
<div class="kpi">${escapeHtml(t("acc_stmt_total_debit"))}<b dir="ltr">${fmt(statement.totalDebit)}</b></div>
<div class="kpi">${escapeHtml(t("acc_stmt_total_credit"))}<b dir="ltr">${fmt(statement.totalCredit)}</b></div>
<div class="kpi">${escapeHtml(t("acc_closing_balance"))}<b dir="ltr">${fmt(Math.abs(statement.closing))} ${escapeHtml(side(statement.closing))}</b></div></div>
<table><thead><tr><th class="num">${escapeHtml(t("acc_date"))}</th><th class="num">#</th><th>${escapeHtml(t("acc_description"))}</th>
<th class="num">${escapeHtml(t("acc_account_code"))}</th><th class="num">${escapeHtml(t("acc_debit"))}</th><th class="num">${escapeHtml(t("acc_credit"))}</th><th class="num">${escapeHtml(t("acc_balance"))}</th></tr></thead>
<tbody><tr class="total"><td colspan="6">${escapeHtml(t("acc_opening_balance"))}</td><td class="num">${fmt(Math.abs(statement.opening))} ${escapeHtml(side(statement.opening))}</td></tr>
${rows}
<tr class="total"><td colspan="4">${escapeHtml(t("acc_closing_balance"))}</td><td class="num">${fmt(statement.totalDebit)}</td><td class="num">${fmt(statement.totalCredit)}</td><td class="num">${fmt(Math.abs(statement.closing))} ${escapeHtml(side(statement.closing))}</td></tr></tbody></table>
<div class="foot"><div class="muted">${escapeHtml(t("acc_stmt_print_note"))}</div><div class="sign">${escapeHtml(t("acc_stmt_signature"))}</div></div>`,
    })
    if (!ok) window.alert(t("acc_print_blocked"))
  }

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_account_statements")}
      description={t("acc_stmt_desc")}
      icon={FileSpreadsheet}
      action={
        <Button variant="outline" className="gap-2" onClick={print} disabled={!statement}>
          <Printer size={16} aria-hidden="true" />
          {t("acc_print")}
        </Button>
      }
      toolbar={<AccountingToolbar data={data} />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={t("acc_stmt_mode")} className="flex items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5">
          {(["party", "account"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-8 px-3 rounded-md text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === m ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-white"
              )}
            >
              {t(m === "party" ? "acc_stmt_mode_party" : "acc_stmt_mode_account")}
            </button>
          ))}
        </div>

        {mode === "party" ? (
          <>
            <Select value={party || undefined} onValueChange={setParty} disabled={parties.length === 0}>
              <SelectTrigger className="h-9 w-72 text-xs" aria-label={t("acc_je_party")}>
                <SelectValue placeholder={t("acc_stmt_pick_party")} />
              </SelectTrigger>
              <SelectContent>
                {parties.map((p) => (
                  <SelectItem key={p.key} value={p.key} className="text-xs">
                    {p.name || p.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger className="h-9 w-56 text-xs" aria-label={t("acc_stmt_scope")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">{t("acc_stmt_scope_all")}</SelectItem>
                <SelectItem value="customer" className="text-xs">{t("acc_stmt_scope_customer")}</SelectItem>
                <SelectItem value="supplier" className="text-xs">{t("acc_stmt_scope_supplier")}</SelectItem>
              </SelectContent>
            </Select>
          </>
        ) : (
          <Select value={account} onValueChange={setAccount}>
            <SelectTrigger className="h-9 w-80 text-xs" aria-label={t("acc_account_name")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accountOptions.map((a) => (
                <SelectItem key={a.code} value={a.code} className={cn("text-xs", !a.postable && "font-bold")}>
                  {a.code} — {locale === "ar" ? a.nameAr : a.nameEn}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {data.isLoading ? (
        <LoadingBooks />
      ) : data.entries.length === 0 ? (
        <EmptyBooks />
      ) : mode === "party" && parties.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <Users size={32} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{t("acc_stmt_no_parties")}</p>
        </div>
      ) : statement ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label={t("acc_opening_balance")} value={compact(Math.abs(statement.opening))} hint={side(statement.opening)} />
            <Kpi label={t("acc_stmt_total_debit")} value={compact(statement.totalDebit)} />
            <Kpi label={t("acc_stmt_total_credit")} value={compact(statement.totalCredit)} />
            <Kpi label={t("acc_closing_balance")} value={compact(Math.abs(statement.closing))} hint={side(statement.closing)} tone={statement.closing > 0.005 ? "warn" : "default"} />
          </div>

          <AccountingSection
            title={`${subject} · ${periodRangeText(data.period)}`}
            icon={FileSpreadsheet}
            action={<ScaleCaption scale={data.scale} />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start w-28">{t("acc_date")}</th>
                    <th className="px-4 py-2.5 text-start">{t("acc_description")}</th>
                    <th className="px-4 py-2.5 text-start w-48">{t("acc_account_name")}</th>
                    <th className="px-4 py-2.5 text-end w-28">{t("acc_debit")}</th>
                    <th className="px-4 py-2.5 text-end w-28">{t("acc_credit")}</th>
                    <th className="px-4 py-2.5 text-end w-40">{t("acc_balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t bg-muted/20 font-bold">
                    <td className="px-4 py-2" colSpan={5}>{t("acc_opening_balance")}</td>
                    <td className="px-4 py-2 text-end whitespace-nowrap">
                      <Money value={Math.abs(statement.opening)} /> <span className="text-[10px] text-muted-foreground">{side(statement.opening)}</span>
                    </td>
                  </tr>
                  {statement.rows.length === 0 && (
                    <tr className="border-t">
                      <td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">{t("acc_stmt_no_movements")}</td>
                    </tr>
                  )}
                  {statement.rows.map((r, i) => (
                    <tr key={`${r.entryId}-${i}`} className="border-t">
                      <td className="px-4 py-2 tabular-nums text-muted-foreground" dir="ltr">{r.date}</td>
                      <td className="px-4 py-2">
                        <span className="text-muted-foreground tabular-nums me-1.5" dir="ltr">#{r.entryNumber}</span>
                        {r.description}
                        {SOURCE_LABEL_KEY[r.sourceType] && <span className="ms-1.5 text-[10px] text-muted-foreground">({t(SOURCE_LABEL_KEY[r.sourceType])})</span>}
                        {r.note && <span className="block text-[11px] text-muted-foreground">{r.note}</span>}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <span className="font-mono text-muted-foreground me-1" dir="ltr">{r.account}</span>
                        {accountName(r.account, locale)}
                      </td>
                      <td className="px-4 py-2 text-end">{r.debit ? <Money value={r.debit} /> : "—"}</td>
                      <td className="px-4 py-2 text-end">{r.credit ? <Money value={r.credit} /> : "—"}</td>
                      <td className="px-4 py-2 text-end whitespace-nowrap">
                        <Money value={Math.abs(r.balance)} /> <span className="text-[10px] text-muted-foreground">{side(r.balance)}</span>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t bg-primary/5 font-black">
                    <td className="px-4 py-2.5" colSpan={3}>{t("acc_closing_balance")}</td>
                    <td className="px-4 py-2.5 text-end"><Money value={statement.totalDebit} /></td>
                    <td className="px-4 py-2.5 text-end"><Money value={statement.totalCredit} /></td>
                    <td className="px-4 py-2.5 text-end whitespace-nowrap">
                      <Money value={Math.abs(statement.closing)} /> <span className="text-[10px] text-muted-foreground">{side(statement.closing)}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </AccountingSection>
        </div>
      ) : null}
    </AccountingShell>
  )
}
