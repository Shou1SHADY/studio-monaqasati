"use client"

import { Fragment, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { AccountingData } from "@/hooks/useAccounting"
import { accountLedger } from "@/lib/accounting/balances"
import { CHART_OF_ACCOUNTS, naturalSign } from "@/lib/accounting/accounts"
import { accountBreakdown, type TreeNode } from "@/lib/accounting/statement-tree"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { Money, accountingBasePath } from "./AccountingShell"
import { ScaleCaption, periodLabel, periodRangeText } from "./AccountingToolbar"

/**
 * A figure that is not a statement row — a cash account on the dashboard, a
 * KPI, a "locked cash" line — as something the panel can open. `codes` may be
 * leaves or rollups (they are prefix-matched); the label defaults to the first
 * code's name in the chart of accounts.
 */
export function accountNode(codes: string[], value: number, label?: { ar: string; en: string }): TreeNode {
  const account = CHART_OF_ACCOUNTS.find((a) => a.code === codes[0])
  return {
    id: `acct-${codes.join("-")}`,
    kind: "account",
    labelAr: label?.ar ?? account?.nameAr ?? codes[0],
    labelEn: label?.en ?? account?.nameEn ?? codes[0],
    value,
    basis: "closing",
    codes,
    ...(codes.length === 1 && account?.postable ? { accountCode: codes[0] } : {}),
  }
}

/**
 * What a statement figure is made of: every account behind it with its number,
 * opening balance, the period's debits and credits, and closing balance. An
 * account row opens into the journal lines that moved it, and links to its full
 * ledger page.
 */
export function AccountBreakdownSheet({
  node,
  data,
  portal,
  onClose,
}: {
  node: TreeNode | null
  data: AccountingData
  portal: CrmPortal
  onClose: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const [openCode, setOpenCode] = useState<string | null>(null)

  const breakdown = useMemo(() => (node?.codes ? accountBreakdown(node.codes, data.windows) : null), [node, data.windows])
  const lines = useMemo(
    () => (openCode ? accountLedger(data.entries, openCode, data.period.from, data.period.to, data.filter) : null),
    [openCode, data.entries, data.period.from, data.period.to, data.filter]
  )
  const Chevron = isRtl ? ChevronLeft : ChevronRight
  const base = accountingBasePath(portal)

  const basisKey = node?.basis === "movement" ? "acc_breakdown_basis_movement" : node?.basis === "opening" ? "acc_breakdown_basis_opening" : "acc_breakdown_basis_closing"

  return (
    <Sheet open={!!node} onOpenChange={(open) => { if (!open) { setOpenCode(null); onClose() } }}>
      <SheetContent side={isRtl ? "left" : "right"} className="w-full sm:max-w-3xl overflow-y-auto" dir={isRtl ? "rtl" : "ltr"}>
        {node && breakdown && (
          <>
            <SheetHeader className="text-start space-y-1.5">
              <SheetTitle className="text-lg font-black text-primary">{locale === "ar" ? node.labelAr : node.labelEn}</SheetTitle>
              <SheetDescription className="text-xs">
                {periodLabel(data.period, locale)} · <span dir="ltr">{periodRangeText(data.period)}</span> · {t(basisKey)}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-primary/5 px-4 py-3">
              <span className="text-sm font-bold">{t("acc_breakdown_statement_figure")}</span>
              <Money value={node.value} className="text-lg font-black" />
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-muted-foreground">{t("acc_breakdown_accounts", { count: breakdown.rows.length })}</p>
              <ScaleCaption scale={data.scale} />
            </div>

            {breakdown.rows.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("acc_breakdown_empty")}</p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 font-black text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start w-20">{t("acc_account_code")}</th>
                      <th className="px-3 py-2 text-start">{t("acc_account_name")}</th>
                      <th className="px-3 py-2 text-end">{t("acc_opening_balance")}</th>
                      <th className="px-3 py-2 text-end">{t("acc_debit")}</th>
                      <th className="px-3 py-2 text-end">{t("acc_credit")}</th>
                      <th className="px-3 py-2 text-end">{t("acc_closing_balance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.rows.map((row) => {
                      const isOpen = openCode === row.code
                      return (
                        <Fragment key={row.code}>
                          <tr className={cn("border-t", isOpen && "bg-primary/5")}>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => setOpenCode(isOpen ? null : row.code)}
                                aria-expanded={isOpen}
                                className="flex items-center gap-1 font-mono tabular-nums text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                dir="ltr"
                              >
                                {isOpen ? <ChevronDown size={12} /> : <Chevron size={12} />}
                                {row.code}
                              </button>
                            </td>
                            <td className="px-3 py-2 font-semibold">{locale === "ar" ? row.nameAr : row.nameEn}</td>
                            <td className="px-3 py-2 text-end"><Money value={row.opening} /></td>
                            <td className="px-3 py-2 text-end"><Money value={row.debit} /></td>
                            <td className="px-3 py-2 text-end"><Money value={row.credit} /></td>
                            <td className="px-3 py-2 text-end font-bold"><Money value={row.closing} /></td>
                          </tr>
                          {isOpen && lines && (
                            <tr className="bg-slate-50/80">
                              <td colSpan={6} className="px-3 py-3">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <span className="text-[11px] font-bold text-muted-foreground">{t("acc_breakdown_movements", { count: lines.rows.length })}</span>
                                  <Link
                                    href={`${base}/ledger?account=${row.code}`}
                                    className="text-[11px] font-bold text-cta flex items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                  >
                                    {t("acc_breakdown_open_ledger")}
                                    <ExternalLink size={11} aria-hidden="true" />
                                  </Link>
                                </div>
                                {lines.rows.length === 0 ? (
                                  <p className="text-[11px] text-muted-foreground">{t("acc_breakdown_no_movements")}</p>
                                ) : (
                                  <table className="w-full text-[11px]">
                                    <thead className="text-muted-foreground">
                                      <tr>
                                        <th className="py-1 text-start w-24">{t("acc_date")}</th>
                                        <th className="py-1 text-start w-12">#</th>
                                        <th className="py-1 text-start">{t("acc_description")}</th>
                                        <th className="py-1 text-end w-24">{t("acc_debit")}</th>
                                        <th className="py-1 text-end w-24">{t("acc_credit")}</th>
                                        <th className="py-1 text-end w-24">{t("acc_balance")}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {lines.rows.map((l, i) => (
                                        <tr key={`${l.entryId}-${i}`} className="border-t border-border/50">
                                          <td className="py-1 tabular-nums" dir="ltr">{l.date}</td>
                                          <td className="py-1 tabular-nums" dir="ltr">
                                            <Link
                                              href={`${base}/journal?entry=${encodeURIComponent(l.entryId)}`}
                                              title={t("acc_entry_details")}
                                              className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                            >
                                              {l.entryNumber}
                                            </Link>
                                          </td>
                                          <td className="py-1">{l.description}{l.note ? <span className="text-muted-foreground"> — {l.note}</span> : null}</td>
                                          <td className="py-1 text-end">{l.debit ? <Money value={l.debit} /> : "—"}</td>
                                          <td className="py-1 text-end">{l.credit ? <Money value={l.credit} /> : "—"}</td>
                                          <td className="py-1 text-end"><Money value={naturalSign(row.code, l.balance)} /></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                    <tr className="border-t bg-muted/30 font-black">
                      <td className="px-3 py-2" colSpan={2}>{t("acc_total")}</td>
                      <td className="px-3 py-2 text-end"><Money value={breakdown.totals.opening} /></td>
                      <td className="px-3 py-2 text-end"><Money value={breakdown.totals.debit} /></td>
                      <td className="px-3 py-2 text-end"><Money value={breakdown.totals.credit} /></td>
                      <td className="px-3 py-2 text-end"><Money value={breakdown.totals.closing} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">{t("acc_breakdown_sign_note")}</p>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
