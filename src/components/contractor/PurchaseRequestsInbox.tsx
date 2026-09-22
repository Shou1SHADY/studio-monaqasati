"use client"

// Purchasing's inbox: every material shortfall Manufacturing sent, as a table
// Purchasing can work from — open, ordered (an RFQ started), arrived, declined —
// with what is on hand now, and one action per row.
//
// The direction is fixed: a shortfall travels manufacturing → warehouse →
// purchasing. Nothing here RAISES a request (the rules refuse it); this desk
// answers them — starts the RFQ, records the arrival, or sends one back with
// a reason the workshop manager will read on the order.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { AlertTriangle, CheckCircle2, ExternalLink, Inbox, Loader2, PackageCheck, Search, ShoppingCart, Undo2, X } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useOrgStock } from "@/hooks/useOrgStock"
import { cn } from "@/lib/utils"
import { formatCrmDate } from "@/lib/crm"
import { matchesSearch } from "@/lib/search-text"
import { WORK_ORDERS } from "@/lib/manufacturing"
import { MFG_PRODUCTS, itemKey, type MfgProduct, type PurchaseRequestRecord } from "@/lib/manufacturing-engine"
import { declinePurchaseRequest, isV2Order, markPurchaseArrived, sourceOf, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { orderRef } from "@/lib/manufacturing-view"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import { fmtQty } from "@/components/manufacturing/ui/MfgUi"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { SignedInAs, mfgActError } from "@/components/shared/MfgHandoffBits"

type StateFilter = "open" | "arrived" | "declined" | "all"
const STATE_FILTERS: StateFilter[] = ["open", "arrived", "declined", "all"]

interface Row {
  order: WorkOrderV2
  request: PurchaseRequestRecord
  productName: string
  lotted: boolean
}

const STATE_TONE: Record<PurchaseRequestRecord["state"], string> = {
  sent: "bg-module/10 text-module",
  ordered: "bg-module/10 text-module",
  arrived: "bg-success/10 text-success",
  declined: "bg-muted text-muted-foreground",
}

export function PurchaseRequestsInbox() {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { can } = usePermissions()
  const { toast } = useToast()

  const userDocRef = useMemoFirebase(() => (isUserLoading || !user || !firestore ? null : doc(firestore, "users", user.uid)), [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const actor = { id: user?.uid || "", name: (profile as { name?: string } | null)?.name || user?.email || "" }
  const canStartRfq = can("rfq.manage") || can("rfq.create")
  const canAnswer = can("rfq.manage")
  const canMarkArrived = can("rfq.manage") || can("warehouses.manage")

  const ordersQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: ordersData, isLoading } = useCollection(ordersQuery)
  const productsQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, MFG_PRODUCTS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: productsData } = useCollection(productsQuery)
  const rfqsQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "rfqs"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: rfqsData } = useCollection(rfqsQuery)
  const warehousesQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: warehousesData } = useCollection(warehousesQuery)
  const warehouses = useMemo(() => ((warehousesData || []) as Array<{ id: string; isOutbound?: boolean }>), [warehousesData])
  const stock = useOrgStock(warehouses, warehouses.length > 0)

  const productById = useMemo(() => new Map(((productsData || []) as MfgProduct[]).map((p) => [p.id, p])), [productsData])
  const rfqById = useMemo(() => new Map(((rfqsData || []) as Array<{ id: string; rfqNumber?: string; title?: string; status?: string }>).map((r) => [r.id, r])), [rfqsData])

  const rows = useMemo<Row[]>(
    () =>
      ((ordersData || []) as WorkOrderV2[])
        .filter(isV2Order)
        .flatMap((o) =>
          (o.purchaseRequests || []).map((request) => {
            const p = productById.get(o.productId || "")
            return { order: o, request, productName: o.productName || p?.name || "", lotted: !!p?.bom.some((b) => b.lotted && itemKey(b.itemName) === itemKey(request.itemName)) }
          })
        )
        .sort((a, b) => (a.request.needBy || "9999").localeCompare(b.request.needBy || "9999") || (a.request.at < b.request.at ? 1 : -1)),
    [ordersData, productById]
  )

  const [state, setState] = useState<StateFilter>("open")
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [search, setSearch] = useState("")
  const today = new Date().toISOString().slice(0, 10)
  const overdue = (r: Row) => !!r.request.needBy && r.request.needBy.slice(0, 10) < today && (r.request.state === "sent" || r.request.state === "ordered")
  const inState = (r: Row) => (state === "all" ? true : state === "open" ? r.request.state === "sent" || r.request.state === "ordered" : r.request.state === state)
  const searching = search.trim().length > 0
  const visible = rows.filter(
    (r) =>
      (searching || inState(r)) &&
      (!onlyOverdue || overdue(r)) &&
      matchesSearch(search, [r.request.itemName, orderRef(r.order), r.productName, r.request.by, r.order.projectName, r.order.source?.contactName, r.request.rfqNumber])
  )
  const counts = {
    open: rows.filter((r) => r.request.state === "sent" || r.request.state === "ordered").length,
    arrived: rows.filter((r) => r.request.state === "arrived").length,
    declined: rows.filter((r) => r.request.state === "declined").length,
    all: rows.length,
  }

  const sourceText = (o: WorkOrderV2): string => {
    const s = sourceOf(o)
    if (s === "project") return `${t("mfg4_source_project")} · ${o.projectName || "—"}`
    if (s === "client") return [t("mfg4_source_client"), o.salesOrderNumber != null ? `#${o.salesOrderNumber}` : "", o.source?.contactName || ""].filter(Boolean).join(" · ")
    return t("mfg4_source_stock")
  }
  const rfqHref = (r: Row) =>
    `/contractor/rfqs/new?items=${encodeURIComponent(JSON.stringify([{ name: r.request.itemName, quantity: r.request.quantity, unit: r.request.unit }]))}&source=${encodeURIComponent(`${r.order.id}:${r.request.id}`)}`

  // ── one action at a time, confirmed ──
  const [pending, setPending] = useState<{ kind: "arrived" | "decline"; row: Row } | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    if (!firestore || !pending || busy) return
    const { row } = pending
    const { order: o, request: r } = row
    setBusy(true)
    setError(null)
    try {
      if (pending.kind === "arrived") {
        await markPurchaseArrived(firestore, { orderId: o.id, purchaseRequestId: r.id, actor })
        await emitMfgEvent(firestore, {
          kind: "purchase_arrived",
          copy: t,
          organizationId: orgId,
          actor,
          to: [{ permission: "manufacturing.manage" }, { permission: "warehouses.manage" }, { users: [r.byId] }],
          params: { ref: orderRef(o), qty: fmtQty(r.quantity), unit: r.unit, item: r.itemName, block: row.lotted ? "@mfn_arrived_block" : "" },
          workOrderId: o.id,
          link: mfgLinks.inventoryDesk(),
        })
        toast({ title: t("mfy_pr_arrived_saved") })
      } else {
        await declinePurchaseRequest(firestore, { orderId: o.id, purchaseRequestId: r.id, reason, actor })
        await emitMfgEvent(firestore, {
          kind: "purchase_declined",
          copy: t,
          organizationId: orgId,
          actor,
          to: [{ permission: "manufacturing.manage" }, { users: [r.byId] }],
          params: { ref: orderRef(o), qty: fmtQty(r.quantity), unit: r.unit, item: r.itemName, reason: reason.trim() },
          workOrderId: o.id,
          link: mfgLinks.order(o.id),
        })
        toast({ title: t("pri_declined_saved") })
      }
      setPending(null)
      setReason("")
    } catch (err) {
      console.error(err)
      setError(mfgActError(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <ProcurementHeader icon={Inbox} title={t("pri_title")} description={t("pri_desc")} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-md">
          <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("pri_search")} aria-label={t("pri_search")} className="h-10 pe-9 ps-9 text-sm" />
          {searching && (
            <button type="button" onClick={() => setSearch("")} aria-label={t("so_search_clear")} className="absolute end-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X size={14} />
            </button>
          )}
        </div>
        <div className={cn("flex flex-wrap items-center gap-1.5", searching && "opacity-60")} role="group" aria-label={t("pri_state")}>
          {STATE_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={state === s && !searching}
              onClick={() => { setSearch(""); setState(s) }}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                state === s && !searching ? "border-module bg-module text-module-foreground" : "border-border bg-card text-muted-foreground hover:border-module/40"
              )}
            >
              {t(`pri_state_${s}`)} <span className="ms-1 opacity-70">{counts[s]}</span>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={onlyOverdue}
            onClick={() => setOnlyOverdue((v) => !v)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              onlyOverdue ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-card text-muted-foreground hover:border-module/40"
            )}
          >
            {t("pri_overdue_only")} <span className="ms-1 opacity-70">{rows.filter(overdue).length}</span>
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="animate-spin text-muted-foreground" size={28} />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <ShoppingCart size={36} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">{searching ? t("so_search_none", { term: search.trim() }) : t("pri_empty")}</p>
            <p className="mt-1 text-xs">{t("pri_empty_hint")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs font-bold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start">{t("pri_col_item")}</th>
                  <th className="px-3 py-2 text-start">{t("pri_col_order")}</th>
                  <th className="px-3 py-2 text-start">{t("pri_col_need_by")}</th>
                  <th className="px-3 py-2 text-end">{t("pri_col_on_hand")}</th>
                  <th className="px-3 py-2 text-start">{t("pri_col_state")}</th>
                  <th className="px-3 py-2 text-end">{t("pri_col_actions")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const { order: o, request: r } = row
                  const late = overdue(row)
                  const onHand = stock.byName.get(itemKey(r.itemName))
                  const rfq = r.rfqId ? rfqById.get(r.rfqId) : undefined
                  return (
                    <tr key={`${o.id}-${r.id}`} className={cn("border-t align-top", late && "bg-destructive/[0.03]")}>
                      <td className="px-3 py-2.5">
                        <p className="font-bold" dir="auto">{r.itemName}</p>
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {fmtQty(r.quantity)} {r.unit}
                          {row.lotted && <span className="ms-1">· {t("pri_lotted")}</span>}
                        </p>
                        {r.note && <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">{r.note}</p>}
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{t("mfy_pr_requested", { name: r.by, date: formatCrmDate(r.at, locale) })}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/contractor/${mfgLinks.order(o.id)}`} className="font-mono text-xs font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded" dir="ltr">
                          {orderRef(o)}
                        </Link>
                        <p className="text-xs" dir="auto">{row.productName}</p>
                        <p className="text-[11px] text-muted-foreground" dir="auto">{sourceText(o)}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        {r.needBy ? (
                          <Badge className={cn("gap-1 border-none text-[11px]", late ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground")}>
                            {late && <AlertTriangle size={11} aria-hidden="true" />}
                            <span dir="ltr">{r.needBy.slice(0, 10)}</span>
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums" dir="ltr">
                        {stock.loading ? <span className="text-xs text-muted-foreground">…</span> : onHand == null ? <span className="text-xs text-muted-foreground">{t("pri_not_in_stock")}</span> : `${fmtQty(onHand)} ${r.unit}`}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge className={cn("border-none text-[11px]", STATE_TONE[r.state])}>{t(`pri_state_badge_${r.state}`)}</Badge>
                        {r.state === "ordered" && r.rfqId && (
                          <Link href={`/contractor/rfqs/${r.rfqId}`} className="mt-1 flex items-center gap-1 text-[11px] font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                            {rfq?.rfqNumber || r.rfqNumber || t("pri_open_rfq")}
                            <ExternalLink size={10} className="rtl-flip" aria-hidden="true" />
                          </Link>
                        )}
                        {r.state === "arrived" && <p className="mt-1 text-[11px] text-muted-foreground">{r.arrivedBy || ""} {r.arrivedAt ? formatCrmDate(r.arrivedAt, locale) : ""}</p>}
                        {r.state === "declined" && r.declinedReason && <p className="mt-1 text-[11px] text-muted-foreground" dir="auto">{r.declinedReason}</p>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {r.state === "sent" && canStartRfq && (
                            <Button asChild size="sm" className="h-8 gap-1.5 text-xs">
                              <Link href={rfqHref(row)}>
                                <ShoppingCart size={13} aria-hidden="true" /> {t("mfy_pr_start_rfq")}
                              </Link>
                            </Button>
                          )}
                          {(r.state === "sent" || r.state === "ordered") && canMarkArrived && (
                            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setPending({ kind: "arrived", row })}>
                              <PackageCheck size={13} aria-hidden="true" /> {t("mfy_pr_mark_arrived")}
                            </Button>
                          )}
                          {(r.state === "sent" || r.state === "ordered") && canAnswer && (
                            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-muted-foreground" onClick={() => { setReason(""); setPending({ kind: "decline", row }) }}>
                              <Undo2 size={13} aria-hidden="true" /> {t("pri_decline")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!pending} onOpenChange={(open) => { if (!open && !busy) setPending(null) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>{pending.kind === "arrived" ? t("mfy_pr_mark_arrived") : t("pri_decline")}</DialogTitle>
                <DialogDescription>
                  {pending.kind === "arrived"
                    ? t("pri_arrived_desc", { qty: fmtQty(pending.row.request.quantity), unit: pending.row.request.unit, item: pending.row.request.itemName })
                    : t("pri_decline_desc", { item: pending.row.request.itemName, ref: orderRef(pending.row.order) })}
                </DialogDescription>
              </DialogHeader>
              {pending.kind === "decline" && (
                <div className="space-y-1.5">
                  <Label htmlFor="pri-reason">{t("pri_decline_reason")}</Label>
                  <Input id="pri-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("pri_decline_reason_ph")} dir="auto" />
                </div>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
              <SignedInAs name={actor.name} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>{t("acc_cancel")}</Button>
                <Button onClick={confirm} disabled={busy || (pending.kind === "decline" && !reason.trim())} className="gap-1.5">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {t("pri_confirm")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
