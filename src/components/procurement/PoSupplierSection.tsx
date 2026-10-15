"use client"

// What the supplier did beside the order on the free journey (Supplier 1.0): the delivery he reported, the reason
// he declined, the invoices he filed, the transfers Finance told him about and the warranty he registered.
// Nothing here is typed by the contractor except accepting the warranty — Finance's transfer goes out with the
// payment it records.

import { useMemo, type ReactElement, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { Button } from "@/components/ui/button"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { Money, useDateText } from "./PoBits"

type Doc = Record<string, unknown> & { id: string }

const str = (v: unknown) => (typeof v === "string" ? v : "")
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const fileOf = (d: Doc) => {
  const f = d.file as { name?: unknown; url?: unknown } | undefined
  return { name: str(f?.name) || str(d.fileName), url: str(f?.url) }
}

function useBuyerDocs(name: string, orgId: string, poId: string, open: boolean) {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && open && orgId ? query(collection(firestore, name), where("buyerOrgId", "==", orgId), where("poId", "==", poId)) : null), [firestore, name, open, orgId, poId])
  return useCollection<Doc>(q)
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

export function PoSupplierSection({
  po,
  orgId,
  open,
  canAcceptWarranty,
  busy,
  onAcceptWarranty,
  Section,
}: {
  po: PurchaseOrder
  orgId: string
  open: boolean
  canAcceptWarranty: boolean
  busy: boolean
  onAcceptWarranty: (warranty: { id: string; itemName: string }) => void
  Section: (props: { title: string; children: ReactNode }) => ReactElement
}) {
  const t = useTranslations("Portal.ProcOrders")
  const fmt = useDateText()
  const { data: invoicesData } = useBuyerDocs("supplierInvoices", orgId, po.id, open)
  const { data: transfersData } = useBuyerDocs("supplierTransfers", orgId, po.id, open)
  const { data: warrantiesData } = useBuyerDocs("supplierWarranties", orgId, po.id, open)

  const pending = useMemo(() => (po.deliveryReports || []).filter((r) => !r.closedAt), [po.deliveryReports])
  const invoices = useMemo(() => [...(invoicesData || [])].sort((a, b) => str(a.date).localeCompare(str(b.date))), [invoicesData])
  const transfers = useMemo(() => [...(transfersData || [])].sort((a, b) => str(a.reportedAt).localeCompare(str(b.reportedAt))), [transfersData])
  const warranties = warrantiesData || []
  const decline = po.supplierDecline

  if (!pending.length && !decline && !invoices.length && !transfers.length && !warranties.length) return null

  return (
    <Section title={t("supplier.title")}>
      {decline && (
        <Block title={t("supplier.declined")}>
          <p className="text-sm" dir="auto">
            {t(`supplier.reason_${decline.reason}`)}
            {decline.note ? ` — ${decline.note}` : ""}
          </p>
          <p className="text-[11px] text-muted-foreground">{t("supplier.by_on", { by: decline.byName, date: fmt(decline.at) })}</p>
        </Block>
      )}

      {pending.length > 0 && (
        <Block title={t("supplier.reports")}>
          {pending.map((r) => (
            <div key={r.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-sm">
              <p className="font-bold">{t("supplier.report_line", { date: fmt(r.date) })}</p>
              {r.note && (
                <p className="text-xs text-muted-foreground" dir="auto">
                  {r.note}
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("supplier.report_hint")}
                {r.reminders.length > 0 ? ` · ${t("supplier.report_reminded", { count: r.reminders.length })}` : ""}
              </p>
            </div>
          ))}
        </Block>
      )}

      {invoices.length > 0 && (
        <Block title={t("supplier.invoices", { count: invoices.length })}>
          {invoices.map((i) => {
            const file = fileOf(i)
            return (
              <div key={i.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-bold" dir="ltr">
                    {str(i.number)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{fmt(str(i.date))}</p>
                  {file.url && (
                    <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cta underline-offset-2 hover:underline">
                      {file.name || t("supplier.file")}
                    </a>
                  )}
                </div>
                <Money value={num(i.amountNet)} className="shrink-0 font-bold" />
              </div>
            )
          })}
        </Block>
      )}

      {transfers.length > 0 && (
        <Block title={t("supplier.transfers", { count: transfers.length })}>
          {transfers.map((x) => {
            const state = str(x.state)
            return (
              <div key={x.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-bold">
                    <Money value={num(x.amount)} />
                  </p>
                  <p className="text-[11px] text-muted-foreground" dir="auto">
                    {[str(x.bank), str(x.ref)].filter(Boolean).join(" · ")}
                  </p>
                  {state === "miss" && x.note ? (
                    <p className="text-xs text-destructive" dir="auto">
                      {str(x.note)}
                    </p>
                  ) : null}
                </div>
                <p className={state === "ok" ? "shrink-0 text-xs font-bold text-success" : state === "miss" ? "shrink-0 text-xs font-bold text-destructive" : "shrink-0 text-xs font-bold text-amber-600"}>
                  {t(`supplier.transfer_${state === "ok" || state === "miss" ? state : "sent"}`)}
                </p>
              </div>
            )
          })}
        </Block>
      )}

      {warranties.length > 0 && (
        <Block title={t("supplier.warranty")}>
          {warranties.map((w) => {
            const file = fileOf(w)
            const ok = str(w.state) === "ok"
            return (
              <div key={w.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-bold" dir="auto">
                    {str(w.itemName)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{t("supplier.warranty_until", { date: fmt(str(w.until)) })}</p>
                  {file.url && (
                    <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cta underline-offset-2 hover:underline">
                      {file.name || t("supplier.file")}
                    </a>
                  )}
                </div>
                {ok ? (
                  <p className="shrink-0 text-xs font-bold text-success">{t("supplier.warranty_ok")}</p>
                ) : canAcceptWarranty ? (
                  <Button size="sm" variant="success" disabled={busy} onClick={() => onAcceptWarranty({ id: w.id, itemName: str(w.itemName) })}>
                    {t("supplier.warranty_accept")}
                  </Button>
                ) : (
                  <p className="shrink-0 text-xs font-bold text-amber-600">{t("supplier.warranty_wait")}</p>
                )}
              </div>
            )
          })}
        </Block>
      )}
    </Section>
  )
}
