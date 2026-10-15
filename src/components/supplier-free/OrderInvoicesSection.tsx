"use client"

// The invoices a supplier filed on purchase orders (the free journey's `supplierInvoices`), with the transfers the
// contractor told him about and the warranties he registered — shown in the FULL portal's invoices page too, so a
// company that upgrades keeps them (SUB-04). The supplier confirms a transfer that arrived from here as well.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { FileCheck2, Loader2, Shield } from "lucide-react"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { sarLtr } from "@/lib/riyal"
import { callAct } from "@/lib/supplier-free/act-client"
import { invoiceFigures } from "@/lib/supplier-free/invoice-rules"
import { bareNumber } from "@/lib/supplier-free/derive"
import { cn } from "@/lib/utils"

type Doc = Record<string, unknown> & { id: string }
const str = (v: unknown) => (typeof v === "string" ? v : "")
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const money = (n: number) => sarLtr(new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n))

function useOrgDocs(name: string, orgId: string) {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, name), where("supplierOrgId", "==", orgId)) : null), [firestore, name, orgId])
  return useCollection<Doc>(q).data || []
}

export function OrderInvoicesSection({ orgId }: { orgId: string }) {
  const t = useTranslations("Portal.Supplier")
  const locale = useLocale()
  const { toast } = useToast()
  const invoices = useOrgDocs("supplierInvoices", orgId)
  const transfers = useOrgDocs("supplierTransfers", orgId)
  const warranties = useOrgDocs("supplierWarranties", orgId)
  const [busy, setBusy] = useState<string | null>(null)

  const byPo = useMemo(() => {
    const m = new Map<string, { invoices: Doc[]; transfers: Doc[] }>()
    const slot = (poId: string) => m.get(poId) || m.set(poId, { invoices: [], transfers: [] }).get(poId)!
    for (const i of invoices) slot(str(i.poId)).invoices.push(i)
    for (const x of transfers) slot(str(x.poId)).transfers.push(x)
    return [...m.entries()].map(([poId, v]) => ({ poId, invoices: v.invoices.sort((a, b) => str(a.date).localeCompare(str(b.date))), transfers: v.transfers.sort((a, b) => str(a.reportedAt).localeCompare(str(b.reportedAt))) }))
  }, [invoices, transfers])

  if (!byPo.length && !warranties.length) return null

  const confirm = async (x: Doc) => {
    setBusy(x.id)
    try {
      await callAct({ action: "transfer.answer", transferId: x.id, answer: "ok" })
      toast({ title: t("inv_orders_confirmed") })
    } catch (err) {
      console.error(err)
      toast({ title: t("inv_save_error"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }
  const sep = locale === "ar" ? "، " : ", "

  return (
    <section className="space-y-3" aria-labelledby="order-invoices-title">
      <div>
        <h2 id="order-invoices-title" className="flex items-center gap-2 text-lg font-black text-primary">
          <FileCheck2 size={18} aria-hidden="true" />
          {t("inv_orders_title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("inv_orders_desc")}</p>
      </div>
      {byPo.map((g) => (
        <Card key={g.poId}>
          <CardContent className="space-y-3 p-4">
            {g.invoices.map((i) => {
              const fig = invoiceFigures(i)
              const grns = Array.isArray(i.grns) ? (i.grns as unknown[]).map((x) => bareNumber(x)) : []
              return (
                <div key={i.id} className="flex flex-wrap items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-bold" dir="ltr">{str(i.number)}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">{str(i.date)}</p>
                    {grns.length > 0 && <p className="text-xs text-muted-foreground">{t("inv_orders_covers", { list: grns.join(sep) })}</p>}
                  </div>
                  <div className="text-end">
                    <p className="text-xs text-muted-foreground">{t("inv_orders_gross")}</p>
                    <p className="font-black tabular-nums" dir="ltr">{money(fig.gross)}</p>
                  </div>
                </div>
              )
            })}
            {g.transfers.length > 0 && (
              <div className="space-y-1.5 border-t pt-2">
                <p className="text-xs font-bold text-muted-foreground">{t("inv_orders_transfers")}</p>
                {g.transfers.map((x) => {
                  const st = str(x.state) === "ok" ? "ok" : str(x.state) === "miss" ? "miss" : "sent"
                  return (
                    <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        <b className="tabular-nums" dir="ltr">{money(num(x.amount))}</b>
                        <span className="ms-2 text-xs text-muted-foreground" dir="auto">{[str(x.bank), str(x.ref)].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={cn("text-xs font-bold", st === "ok" ? "text-success" : st === "miss" ? "text-destructive" : "text-amber-700")}>{t(`inv_orders_transfer_${st}`)}</span>
                        {st === "sent" && (
                          <Button size="sm" variant="success" className="h-7 gap-1 text-xs" disabled={busy === x.id} onClick={() => void confirm(x)}>
                            {busy === x.id && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                            {t("inv_orders_confirm")}
                          </Button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {warranties.length > 0 && (
        <Card>
          <CardContent className="space-y-1.5 p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <Shield size={13} aria-hidden="true" />
              {t("inv_orders_warranties")}
            </p>
            {warranties.map((w) => (
              <p key={w.id} className="text-sm" dir="auto">
                {t("inv_orders_warranty_until", { item: str(w.itemName), date: str(w.until) })}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  )
}
