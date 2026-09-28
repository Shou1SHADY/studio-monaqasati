"use client"

// Purchasing's incoming needs (PRD 3.0 §7.2, the requests tab): every need that
// reaches Purchasing, in one list — a work order's material shortfall, a
// project's approved internal request, and a stock item at or below its
// minimum — each with its computed route and one action per row.
//
// Nothing here RAISES a need; this desk answers them: starts an RFQ, places the
// order the route points to (on an agreement, or direct under the cap), records
// a shortfall's arrival, or sends one back with a reason the workshop reads.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { AlertTriangle, Boxes, CheckCircle2, ExternalLink, Factory, FileSignature, FolderKanban, Loader2, PackageCheck, Scale, Search, ShoppingCart, Undo2, Warehouse, X, type LucideIcon } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useOrgStock, stockKey } from "@/hooks/useOrgStock"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { useProjectPurchaseRequests } from "@/hooks/useProjectPurchaseRequests"
import { cn } from "@/lib/utils"
import { formatCrmDate } from "@/lib/crm"
import { matchesSearch } from "@/lib/search-text"
import { WORK_ORDERS } from "@/lib/manufacturing"
import { MFG_PRODUCTS, itemKey, type MfgProduct, type PurchaseRequestRecord } from "@/lib/manufacturing-engine"
import { declinePurchaseRequest, isV2Order, markPurchaseArrived, sourceOf, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { orderRef } from "@/lib/manufacturing-view"
import { purchaseRequestRef } from "@/lib/mfg-outside"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import { displayDocNumber } from "@/lib/procurement/format"
import { mfgNeed, needCounts, needSourceParam, projectNeed, sortNeeds, stockNeeds, type Need, type NeedKind, type NeedState } from "@/lib/procurement/needs"
import { needRoute, type NeedRoute, type RouteResult } from "@/lib/procurement/route"
import { fmtQty } from "@/components/manufacturing/ui/MfgUi"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { SignedInAs, mfgActError } from "@/components/shared/MfgHandoffBits"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { DirectOrderDialog } from "@/components/procurement/DirectOrderDialog"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"

type StateFilter = NeedState | "all"
const STATE_FILTERS: StateFilter[] = ["action", "waiting", "rfq", "order", "done", "all"]

const ROUTE_LOOK: Record<NeedRoute, { tone: PillTone; icon: LucideIcon }> = {
  stock: { tone: "warn", icon: Warehouse },
  agreement: { tone: "ok", icon: FileSignature },
  direct: { tone: "info", icon: ShoppingCart },
  rfq: { tone: "violet", icon: Scale },
}

const SOURCE_LOOK: Record<NeedKind, { cls: string; icon: LucideIcon }> = {
  mfg: { cls: "bg-amber-50 text-amber-700", icon: Factory },
  project: { cls: "bg-pm/10 text-pm", icon: FolderKanban },
  stock: { cls: "bg-cta/10 text-cta", icon: Boxes },
}

const DAY_MS = 86_400_000

export function PurchaseRequestsInbox() {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { can } = usePermissions()
  const { toast } = useToast()
  const world = useProcurementWorld()
  const { actor: procActor, orgId, policies } = world
  const actor = { id: procActor.uid, name: procActor.name }
  const canStartRfq = can("rfq.manage") || can("rfq.create")
  const canOrder = procActor.isOwner || procActor.canPrepare
  const canAnswer = can("rfq.manage")
  const canMarkArrived = can("rfq.manage") || can("warehouses.manage")

  const ordersQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: ordersData, isLoading } = useCollection(ordersQuery)
  const productsQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, MFG_PRODUCTS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: productsData } = useCollection(productsQuery)
  const warehousesQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: warehousesData } = useCollection(warehousesQuery)
  const warehouses = useMemo(() => (warehousesData || []) as Array<{ id: string; name?: string; isOutbound?: boolean }>, [warehousesData])
  const stock = useOrgStock(warehouses, warehouses.length > 0)
  const { agreements, history } = useProcurementPrices(orgId || null)
  const projectRequests = useProjectPurchaseRequests(orgId || null)

  const productById = useMemo(() => new Map(((productsData || []) as MfgProduct[]).map((p) => [p.id, p])), [productsData])

  const sourceText = (o: WorkOrderV2): string => {
    const s = sourceOf(o)
    if (s === "project") return `${t("mfg4_source_project")} · ${o.projectName || "—"}`
    if (s === "client") return [t("mfg4_source_client"), o.salesOrderNumber != null ? `#${o.salesOrderNumber}` : "", o.source?.contactName || ""].filter(Boolean).join(" · ")
    return t("mfg4_source_stock")
  }

  // Work-order shortfalls keep their order and request for the arrive / send-back dialogs.
  const mfgByKey = useMemo(() => {
    const m = new Map<string, { order: WorkOrderV2; request: PurchaseRequestRecord; lotted: boolean }>()
    for (const o of ((ordersData || []) as WorkOrderV2[]).filter(isV2Order)) {
      const p = productById.get(o.productId || "")
      for (const request of o.purchaseRequests || []) {
        m.set(`mfg:${o.id}:${request.id}`, { order: o, request, lotted: !!p?.bom.some((b) => b.lotted && itemKey(b.itemName) === itemKey(request.itemName)) })
      }
    }
    return m
  }, [ordersData, productById])

  const needs = useMemo(() => {
    const out: Need[] = []
    mfgByKey.forEach(({ order: o, request }) => {
      const p = productById.get(o.productId || "")
      out.push(mfgNeed({ id: o.id, ref: orderRef(o), context: o.productName || p?.name || sourceText(o), projectId: o.projectId ?? null, projectName: o.projectName ?? null }, request))
    })
    for (const { project, requests } of projectRequests.rows) for (const pr of requests) out.push(projectNeed(project, pr, purchaseRequestRef(pr.id)))
    const names = new Map(warehouses.map((w) => [w.id, w.name || ""]))
    const stockRows = Array.from(stock.byWarehouse.entries()).flatMap(([warehouseId, rows]) => rows.filter((r) => !r.isManufactured).map((r) => ({ ...r, warehouseId, warehouseName: names.get(warehouseId) || "" })))
    out.push(...stockNeeds(stockRows, { rfqs: world.rfqs, orders: world.orders }))
    return sortNeeds(out.filter((n) => n.lines.length > 0))
  }, [mfgByKey, productById, projectRequests.rows, stock.byWarehouse, warehouses, world.rfqs, world.orders])

  const today = new Date().toISOString().slice(0, 10)
  const onHand = (name: string) => (stock.loading ? null : stock.byName.get(stockKey(name)) ?? null)
  const routeOf = (n: Need): RouteResult =>
    needRoute({
      lines: n.lines.map((l) => ({ ...l, onHand: n.kind === "stock" ? null : onHand(l.name) })),
      agreements,
      history,
      directCap: policies.directPurchaseCap,
      today,
    })

  const [state, setState] = useState<StateFilter>("action")
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [search, setSearch] = useState("")
  const overdue = (n: Need) => !!n.needBy && n.needBy < today && (n.state === "action" || n.state === "rfq" || n.state === "order")
  const searching = search.trim().length > 0
  const visible = needs.filter(
    (n) =>
      (searching || state === "all" || n.state === state) &&
      (!onlyOverdue || overdue(n)) &&
      matchesSearch(search, [...n.lines.map((l) => l.name), n.refLabel, n.context, n.requestedBy, n.projectName, n.rfqNumber, n.poNumber])
  )
  const counts = needCounts(needs)

  const rfqHref = (n: Need) => `/contractor/rfqs/new?items=${encodeURIComponent(JSON.stringify(n.lines))}&source=${encodeURIComponent(needSourceParam(n.source))}`
  const refHref = (n: Need): string | null =>
    n.kind === "mfg" ? `/contractor/${mfgLinks.order(n.ownerId)}` : n.kind === "project" ? `/contractor/projects/${n.ownerId}?tab=purchaseRequests` : `/contractor/warehouses/${n.ownerId}`

  // ── one action at a time, confirmed ──
  const [pending, setPending] = useState<{ kind: "arrived" | "decline"; key: string } | null>(null)
  const [ordering, setOrdering] = useState<{ need: Need; route: RouteResult } | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRow = pending ? mfgByKey.get(pending.key) : undefined

  const confirm = async () => {
    if (!firestore || !pending || !pendingRow || busy) return
    const { order: o, request: r, lotted } = pendingRow
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
          params: { ref: orderRef(o), qty: fmtQty(r.quantity), unit: r.unit, item: r.itemName, block: lotted ? "@mfn_arrived_block" : "" },
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

  const loading = isLoading || world.loading

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <ProcurementHeader title={t("pri_title")} description={t("pri_desc_all")} />

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
        <ProcChipGroup
          items={STATE_FILTERS.map((f) => ({ id: f, label: t(`pri_state_${f}`), count: counts[f] }))}
          active={state}
          onPick={(f) => {
            setSearch("")
            setState(f)
          }}
          label={t("pri_state")}
          dimmed={searching}
        />
        <button
          type="button"
          aria-pressed={onlyOverdue}
          onClick={() => setOnlyOverdue((v) => !v)}
          className={cn(
            "min-h-9 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            onlyOverdue ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-card text-muted-foreground hover:border-module/40"
          )}
        >
          {t("pri_overdue_only")} <span className="ms-1 opacity-70">{needs.filter(overdue).length}</span>
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        {loading ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="animate-spin text-muted-foreground" size={28} />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <ShoppingCart size={36} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">{searching ? t("so_search_none", { term: search.trim() }) : t("pri_empty")}</p>
            <p className="mt-1 text-xs">{t("pri_empty_hint_all")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold">{t("pri_col_material")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("pri_col_qty")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("pri_col_need_by")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("pri_col_route")}</th>
                  <th className="px-4 py-3 text-end font-semibold">
                    <span className="sr-only">{t("pri_col_actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((n) => {
                  const late = overdue(n)
                  const days = n.needBy ? Math.round((Date.parse(n.needBy) - Date.parse(today)) / DAY_MS) : null
                  const route = n.state === "action" ? routeOf(n) : null
                  const RouteIcon = route ? ROUTE_LOOK[route.route].icon : null
                  const Src = SOURCE_LOOK[n.kind]
                  const first = n.lines[0]
                  const href = refHref(n)
                  const mfg = n.kind === "mfg" ? mfgByKey.get(n.key) : undefined
                  const open = n.state === "action" || n.state === "rfq" || n.state === "order"
                  return (
                    <tr key={n.key} className="align-middle">
                      <td className="px-4 py-3">
                        <p className="font-bold text-foreground" dir="auto">
                          {first.name}
                          {n.lines.length > 1 && <span className="ms-1 text-xs font-normal text-muted-foreground">{t("pri_more_lines", { count: n.lines.length - 1 })}</span>}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", Src.cls)}>
                            <Src.icon size={11} aria-hidden="true" /> {t(`pri_from_${n.kind}`)}
                          </span>
                          {href ? (
                            <Link href={href} className="rounded font-mono font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                              {n.refLabel}
                            </Link>
                          ) : (
                            <span dir="auto">{n.refLabel}</span>
                          )}
                          {n.context && <span dir="auto">· {n.context}</span>}
                          {n.requestedBy && <span>· {n.requestedBy}</span>}
                        </p>
                        {n.note && <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">{n.note}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-black tabular-nums" dir="ltr">
                          {fmtQty(first.quantity)} <span className="text-xs font-normal text-muted-foreground">{first.unit}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {n.stock
                            ? t("pri_stock_min", { qty: fmtQty(n.stock.onHand), min: fmtQty(n.stock.min) })
                            : stock.loading
                              ? "…"
                              : onHand(first.name) == null
                                ? t("pri_not_in_stock")
                                : t("pri_on_hand", { qty: `${fmtQty(onHand(first.name) ?? 0)} ${first.unit}` })}
                          {mfg?.lotted && <span> · {t("pri_lotted")}</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {n.needBy ? (
                          <>
                            <p className="font-semibold" dir="ltr">{formatCrmDate(n.needBy, locale)}</p>
                            {days !== null && open && (
                              <p className={cn("flex items-center gap-1 text-[11px]", late ? "text-destructive" : days <= 3 ? "text-amber-600" : "text-muted-foreground")}>
                                {late && <AlertTriangle size={11} aria-hidden="true" />}
                                {days < 0 ? t("pri_need_late", { count: -days }) : days === 0 ? t("pri_need_today") : t("pri_need_in", { count: days })}
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {route && RouteIcon ? (
                          <StatusPill tone={ROUTE_LOOK[route.route].tone}>
                            <RouteIcon size={12} aria-hidden="true" /> {t(`pri_route_${route.route}`)}
                          </StatusPill>
                        ) : n.state === "rfq" && n.rfqId ? (
                          <Link href={`/contractor/rfqs/${n.rfqId}`} className="flex items-center gap-1 rounded text-xs font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {t("pri_in_rfq", { ref: n.rfqNumber || "" })}
                            <ExternalLink size={10} className="rtl-flip" aria-hidden="true" />
                          </Link>
                        ) : n.state === "order" && n.poId ? (
                          <Link href={`/contractor/rfqs/orders?po=${n.poId}`} className="flex items-center gap-1 rounded text-xs font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {t("pri_in_order", { ref: displayDocNumber(n.poNumber || "", locale) })}
                            <ExternalLink size={10} className="rtl-flip" aria-hidden="true" />
                          </Link>
                        ) : n.state === "waiting" ? (
                          <StatusPill tone="mute">{t(`pri_waiting_${n.waitingOn || "warehouse"}`)}</StatusPill>
                        ) : (
                          <span className="text-xs text-muted-foreground" dir="auto">
                            {t(`pri_done_${n.kind}`)}
                            {n.endNote ? ` · ${n.endNote}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {n.state === "action" && route && canOrder && (route.route === "agreement" || route.route === "direct") && (
                            <Button size="sm" className="h-8 gap-1.5 bg-module text-xs text-module-foreground hover:bg-module/90" onClick={() => setOrdering({ need: n, route })}>
                              <ShoppingCart size={13} aria-hidden="true" /> {t(route.route === "agreement" ? "dor_open_agreement" : "dor_open_direct")}
                            </Button>
                          )}
                          {n.state === "action" && canStartRfq && route?.route !== "stock" && (
                            <Button
                              asChild
                              size="sm"
                              variant={route && (route.route === "agreement" || route.route === "direct") ? "outline" : "default"}
                              className={cn(
                                "h-8 gap-1.5 text-xs",
                                route && (route.route === "agreement" || route.route === "direct") ? "border border-border bg-card text-foreground shadow-none hover:bg-muted" : "bg-module text-module-foreground hover:bg-module/90"
                              )}
                            >
                              <Link href={rfqHref(n)}>
                                <Scale size={13} aria-hidden="true" /> {t("mfy_pr_start_rfq")}
                              </Link>
                            </Button>
                          )}
                          {mfg && (mfg.request.state === "sent" || mfg.request.state === "ordered") && canMarkArrived && (
                            <Button size="sm" variant="outline" className="h-8 gap-1.5 border border-border bg-card text-xs text-foreground shadow-none hover:bg-muted" onClick={() => setPending({ kind: "arrived", key: n.key })}>
                              <PackageCheck size={13} aria-hidden="true" /> {t("mfy_pr_mark_arrived")}
                            </Button>
                          )}
                          {mfg && (mfg.request.state === "sent" || mfg.request.state === "ordered") && canAnswer && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 gap-1.5 text-xs text-muted-foreground"
                              onClick={() => {
                                setReason("")
                                setPending({ kind: "decline", key: n.key })
                              }}
                            >
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

      {ordering && (
        <DirectOrderDialog need={ordering.need} route={ordering.route} history={history} orders={world.orders} policies={policies} actor={procActor} orgId={orgId} onClose={() => setOrdering(null)} />
      )}

      <Dialog
        open={!!pending}
        onOpenChange={(o) => {
          if (!o && !busy) setPending(null)
        }}
      >
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          {pending && pendingRow && (
            <>
              <DialogHeader>
                <DialogTitle>{pending.kind === "arrived" ? t("mfy_pr_mark_arrived") : t("pri_decline")}</DialogTitle>
                <DialogDescription>
                  {pending.kind === "arrived"
                    ? t("pri_arrived_desc", { qty: fmtQty(pendingRow.request.quantity), unit: pendingRow.request.unit, item: pendingRow.request.itemName })
                    : t("pri_decline_desc", { item: pendingRow.request.itemName, ref: orderRef(pendingRow.order) })}
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
                <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
                  {t("acc_cancel")}
                </Button>
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
