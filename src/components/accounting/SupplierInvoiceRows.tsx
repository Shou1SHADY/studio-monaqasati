"use client"

// The supplier invoices Finance matches and schedules (Supplier 1.0 boundary: "Finance — the invoice → three-way match
// with the PO and the receipt, then scheduling"). Each row reads the invoice against the order's price and what our
// receipts accepted (`matchInvoice`) and shows the next share due under the order's frozen terms (`scheduleInvoices`).
// A row opens the order's drawer, where Finance records the payment or holds the invoice — nothing is written here.

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { Money, useDateText } from "@/components/procurement/PoBits"
import { displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { matchInvoice, scheduleInvoices, type InvoiceMatch, type InvoiceSchedule, type MatchState, type SupplierInvoiceDoc } from "@/lib/procurement/supplier-invoice-match"
import type { PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"
import { riyadhDay } from "@/lib/hr/format"
import { moneyFigure } from "@/components/procurement/PoModel"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

/** The riyal sign beside the figure, as the row's total shows it. */
const sar = (n: number) => sarLtr(moneyFigure(n))

const TONE: Record<MatchState, PillTone> = { match: "ok", under: "warn", check: "bad" }

export interface SupplierInvoiceRow {
  inv: SupplierInvoiceDoc
  po: PurchaseOrder
  match: InvoiceMatch
  schedule: InvoiceSchedule
}

/** Our company's supplier invoices on its own orders, matched and scheduled — unpaid first, the soonest due on top. */
export function useSupplierInvoiceRows(orgId: string, orders: readonly PurchaseOrder[], deliveries: readonly ReceiptFact[]): { rows: SupplierInvoiceRow[]; loading: boolean } {
  const firestore = useFirestore()
  const invQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "supplierInvoices"), where("buyerOrgId", "==", orgId)) : null), [firestore, orgId])
  const trQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "supplierTransfers"), where("buyerOrgId", "==", orgId)) : null), [firestore, orgId])
  const { data: invData, isLoading: invLoading } = useCollection<SupplierInvoiceDoc>(invQ)
  const { data: trData, isLoading: trLoading } = useCollection<SupplierInvoiceDoc>(trQ)

  const rows = useMemo(() => {
    const poById = new Map(orders.map((po) => [po.id, po]))
    // A transfer the supplier answered "not received" pays nothing.
    const paidByPo = new Map<string, number>()
    for (const x of trData || []) {
      if (x.state === "miss") continue
      const poId = String(x.poId || "")
      paidByPo.set(poId, (paidByPo.get(poId) || 0) + (Number(x.amount) || 0))
    }
    const byPo = new Map<string, SupplierInvoiceDoc[]>()
    for (const inv of invData || []) {
      const poId = String(inv.poId || "")
      if (!poById.has(poId)) continue
      byPo.set(poId, [...(byPo.get(poId) || []), inv])
    }
    const out: SupplierInvoiceRow[] = []
    for (const [poId, invs] of byPo) {
      const po = poById.get(poId) as PurchaseOrder
      const schedules = scheduleInvoices(invs, po, paidByPo.get(poId) || 0)
      for (const inv of invs) out.push({ inv, po, match: matchInvoice(inv, po, deliveries), schedule: schedules.get(inv.id) as InvoiceSchedule })
    }
    const key = (r: SupplierInvoiceRow) => r.schedule.next?.due || "9999-12-31"
    return out.sort((a, b) => Number(!a.schedule.next) - Number(!b.schedule.next) || key(a).localeCompare(key(b)) || String(b.inv.date || "").localeCompare(String(a.inv.date || "")))
  }, [invData, trData, orders, deliveries])

  return { rows, loading: invLoading || trLoading }
}

export function SupplierInvoiceRows({ rows, onOpen }: { rows: SupplierInvoiceRow[]; onOpen: (poId: string) => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const fmt = useDateText()
  const today = riyadhDay()
  const sep = locale === "ar" ? "، " : ", "

  return (
    <ul className="divide-y">
      {rows.map(({ inv, po, match, schedule }) => {
        const next = schedule.next
        const late = !!next && !!next.due && next.due < today
        return (
          <li key={inv.id}>
            <button
              type="button"
              onClick={() => onOpen(po.id)}
              className="flex w-full flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-foreground" dir="ltr">
                    {String(inv.number || "")}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">{po.supplierName}</span>
                  <StatusPill tone={TONE[match.state]}>{t(`fpd_inv_${match.state}`)}</StatusPill>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground sm:truncate">
                  {t("fpd_inv_refs", {
                    po: displayPoNumber(po.docNumber, locale),
                    list: match.receipts.map((r) => displayReceiptNumber(r.grn, locale)).join(sep) || "—",
                    date: fmt(String(inv.date || "")),
                  })}
                </span>
                {match.state === "under" && match.diff != null && match.expectedNet != null && (
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {t("fpd_inv_under_note", { diff: sar(Math.abs(match.diff)), expected: sar(match.expectedNet) })}
                  </span>
                )}
                {match.state === "check" && <span className="mt-0.5 block text-[11px] text-destructive">{t("fpd_inv_check_note")}</span>}
              </span>
              <span className="shrink-0 text-end max-sm:flex max-sm:basis-full max-sm:items-baseline max-sm:justify-between max-sm:gap-3">
                <Money value={match.gross} className="block text-sm font-bold text-foreground" />
                <span className={cn("mt-0.5 block text-[11px] font-semibold max-sm:mt-0", !next ? "text-success" : late ? "text-destructive" : "text-muted-foreground")}>
                  {!next ? t("fpd_inv_paid") : t(late ? "fpd_inv_overdue" : "fpd_inv_next", { amount: sar(next.open), date: fmt(next.due) })}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
