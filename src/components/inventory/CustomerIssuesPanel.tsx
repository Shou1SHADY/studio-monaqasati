"use client"

// Customer issues (صرف للعملاء) — Inventory's step in the three-step handshake
// (Sales PRD DLV-02, T17). Sales requests a delivery; the storekeeper
// authorises it here against stock the warehouse truly has — on hand minus
// what other open notes already claim — and only then can the client sign.
// The figure that decides is Inventory's, not Sales'. Nothing moves at this
// step: stock leaves when the client signs, at the quantity actually received.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, getDocs, query, where } from "firebase/firestore"
import { AlertTriangle, CheckCircle2, Loader2, Lock, PackageCheck, PauseCircle, Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { formatCrmDate } from "@/lib/crm"
import { SALES_DELIVERY_NOTES, claimedFromWarehouse, deliveryShortfalls, trulyAvailable, type SalesDeliveryNote } from "@/lib/sales-orders"
import { authorizeDelivery } from "@/lib/sales-order-writes"

type StockRow = { id: string; name: string; quantity: number; lot: string | null; remnant: boolean }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function CustomerIssuesPanel({ orgId, actor, canAuthorize }: { orgId: string; actor: { id: string; name: string }; canAuthorize: boolean }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()

  const notesQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, SALES_DELIVERY_NOTES), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: notesData } = useCollection(notesQuery)
  const notes = useMemo(() => (notesData || []) as SalesDeliveryNote[], [notesData])

  // What waits on the storekeeper, oldest first; then what waits on the client.
  const open = useMemo(
    () =>
      notes
        .filter((n) => n.status === "requested" || n.status === "authorized" || n.status === "held")
        .sort((a, b) => (a.status === b.status ? (a.requestedAt || "").localeCompare(b.requestedAt || "") : a.status === "requested" ? -1 : b.status === "requested" ? 1 : 0)),
    [notes]
  )

  // Stock of every warehouse an open note draws on — read once per set of warehouses.
  const warehouseIds = useMemo(() => Array.from(new Set(open.map((n) => n.warehouseId).filter((x): x is string => !!x))).sort(), [open])
  const warehouseKey = warehouseIds.join("|")
  const [stock, setStock] = useState<Record<string, StockRow[]>>({})
  const [stockVersion, setStockVersion] = useState(0)
  useEffect(() => {
    if (!firestore || !warehouseKey) return
    let alive = true
    void (async () => {
      const next: Record<string, StockRow[]> = {}
      for (const id of warehouseKey.split("|")) {
        try {
          const snap = await getDocs(collection(firestore, "warehouses", id, "inventoryItems"))
          next[id] = snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || "", quantity: Number(d.data().quantity) || 0, lot: (d.data().lot as string) || null, remnant: !!d.data().remnant }))
        } catch (err) {
          console.error(err)
          next[id] = []
        }
      }
      if (alive) setStock(next)
    })()
    return () => {
      alive = false
    }
  }, [firestore, warehouseKey, stockVersion])

  const [busyId, setBusyId] = useState<string | null>(null)

  const authorize = async (note: SalesDeliveryNote) => {
    if (!firestore || busyId) return
    setBusyId(note.id)
    try {
      await authorizeDelivery(firestore, { note, stockRows: stock[note.warehouseId || ""] || [], allNotes: notes, actor })
      toast({ title: t("cip_authorized_toast", { number: note.noteNumber }) })
    } catch (err) {
      console.error(err)
      const code = err instanceof Error ? err.message : ""
      toast({ title: t(code === "insufficient_stock" ? "cip_err_stock" : code === "held" ? "cip_err_held" : code === "not_requested" ? "cip_err_state" : "crm_save_error"), variant: "destructive" })
      setStockVersion((v) => v + 1)
    } finally {
      setBusyId(null)
    }
  }

  if (!open.length) return null

  const waiting = open.filter((n) => n.status === "requested").length

  return (
    <section className="overflow-hidden rounded-xl border bg-white" aria-labelledby="customer-issues-title">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b bg-muted/30 px-5 py-3.5">
        <div className="min-w-0">
          <h2 id="customer-issues-title" className="flex items-center gap-2 text-sm font-black text-foreground">
            <Truck size={15} className="text-primary" aria-hidden="true" />
            {t("cip_title")}
            {waiting > 0 && <Badge className="border-none bg-warning/10 text-[10px] tabular-nums text-warning">{waiting}</Badge>}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("cip_desc")}</p>
        </div>
      </header>

      <ul className="divide-y">
        {open.map((note) => {
          const rows = stock[note.warehouseId || ""] || []
          const short = note.warehouseId ? deliveryShortfalls(note.lines, note.warehouseId, rows, notes, note.id) : []
          const blocked = note.status === "requested" && short.length > 0
          return (
            <li key={note.id} className="space-y-2 px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground" dir="ltr">{note.noteNumber}</span>
                <span className="text-sm font-bold text-foreground" dir="auto">{note.contactName || "—"}</span>
                <span className="text-[11px] text-muted-foreground">{t("so_order_no", { number: note.orderNumber })}</span>
                {note.status === "requested" ? (
                  <Badge className="border-none bg-warning/10 text-[10px] text-warning">{t("cip_st_requested")}</Badge>
                ) : note.status === "authorized" ? (
                  <Badge className="border-none bg-cta/10 text-[10px] text-cta">{t("cip_st_authorized")}</Badge>
                ) : (
                  <Badge className="gap-1 border-none bg-destructive/10 text-[10px] text-destructive">
                    <PauseCircle size={10} aria-hidden="true" />
                    {t("sf_status_held")}
                  </Badge>
                )}
                {note.status === "requested" && canAuthorize && (
                  <Button size="sm" className="ms-auto h-8 gap-1.5" disabled={blocked || busyId === note.id} onClick={() => void authorize(note)}>
                    {busyId === note.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <PackageCheck size={13} aria-hidden="true" />}
                    {t("cip_authorize_btn")}
                  </Button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-xs">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground">
                      <th scope="col" className="py-1 text-start font-semibold">{t("cip_col_item")}</th>
                      <th scope="col" className="py-1 text-end font-semibold">{t("cip_col_requested")}</th>
                      <th scope="col" className="py-1 text-end font-semibold">{t("cip_col_on_hand")}</th>
                      <th scope="col" className="py-1 text-end font-semibold">{t("cip_col_claimed")}</th>
                      <th scope="col" className="py-1 text-end font-semibold">{t("cip_col_available")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {note.lines.map((l) => {
                      const onHand = rows.filter((r) => same(r.name, l.name)).reduce((s, r) => s + r.quantity, 0)
                      const claimed = note.warehouseId ? claimedFromWarehouse(notes, note.warehouseId, l.name, note.id) : 0
                      const available = trulyAvailable(onHand, claimed)
                      const lineShort = l.quantity > available + 0.005
                      return (
                        <tr key={l.name} className="border-t">
                          <td className="py-1.5 font-semibold text-foreground" dir="auto">{l.name}</td>
                          <td className="py-1.5 text-end tabular-nums" dir="ltr">{l.quantity}</td>
                          <td className="py-1.5 text-end tabular-nums text-muted-foreground" dir="ltr">{onHand}</td>
                          <td className="py-1.5 text-end tabular-nums text-muted-foreground" dir="ltr">{claimed}</td>
                          <td className={cn("py-1.5 text-end font-bold tabular-nums", lineShort ? "text-destructive" : "text-success")} dir="ltr">{available}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-muted-foreground">
                {note.warehouseName && <span>{note.warehouseName} · </span>}
                {t("cip_requested_by", { name: note.createdByUserName || "—", date: formatCrmDate(note.requestedAt || "", locale) })}
                {note.status === "authorized" && note.authorizedByUserName && <> · {t("cip_authorized_by", { name: note.authorizedByUserName })}</>}
              </p>

              {blocked && (
                <p className="flex items-start gap-1.5 text-[11px] font-semibold text-destructive" role="alert">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {t("cip_short", { items: short.map((s) => s.name).join(" · ") })}
                </p>
              )}
              {note.status === "authorized" && (
                <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                  {t("cip_waits_client")}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {!canAuthorize && (
        <p className="flex items-center gap-1.5 border-t px-5 py-2 text-[11px] text-muted-foreground">
          <Lock size={11} aria-hidden="true" />
          {t("cip_read_only")}
        </p>
      )}
    </section>
  )
}
