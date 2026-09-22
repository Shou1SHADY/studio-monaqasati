"use client"

// Procurement's inbox from the workshop (MAT-05, T22/T23). When a work order
// is short of material, the workshop manager sends the shortfall here
// (mfg.purchase.requested) and the order's date waits "after arrival". Buying
// it is Procurement's: start an RFQ prefilled with the item, then mark it
// arrived — the workshop reads that and computes the date again. Block quality
// notices and scrap borne by the supplier land here too: the claim is raised
// by Procurement, never inside Manufacturing (FL-11, T15).

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { AlertTriangle, CheckCircle2, Factory, Loader2, PackageCheck, Send, ShieldAlert, ShoppingCart } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { formatCrmDate, formatSar } from "@/lib/crm"
import { WORK_ORDERS } from "@/lib/manufacturing"
import { MFG_BLOCK_NOTICES, MFG_PRODUCTS, itemKey, type MfgProduct, type PurchaseRequestRecord, type WorkOrderScrap } from "@/lib/manufacturing-engine"
import {
  isV2Order,
  markBlockClaimRaised,
  markPurchaseArrived,
  sourceOf,
  type MfgBlockNotice,
  type WorkOrderV2,
} from "@/lib/manufacturing-writes"
import { orderRef } from "@/lib/manufacturing-view"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import { fmtQty } from "@/components/manufacturing/ui/MfgUi"
import { SignedInAs, mfgActError } from "@/components/shared/MfgHandoffBits"

type Pending =
  | { kind: "arrived"; order: WorkOrderV2; request: PurchaseRequestRecord; lotted: boolean }
  | { kind: "claim"; notice: MfgBlockNotice }

export function MfgPurchaseRequestsPanel({
  canStartRfq,
  canMarkArrived,
  canClaim,
}: {
  /** rfq.manage || rfq.create */
  canStartRfq: boolean
  /** rfq.manage || warehouses.manage */
  canMarkArrived: boolean
  /** rfq.manage || rfq.create */
  canClaim: boolean
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const actor = { id: user?.uid || "", name: (profile as { name?: string } | null)?.name || user?.email || "" }

  const ordersQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: ordersData } = useCollection(ordersQuery)
  const productsQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, MFG_PRODUCTS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: productsData } = useCollection(productsQuery)
  const noticesQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, MFG_BLOCK_NOTICES), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: noticesData } = useCollection(noticesQuery)

  const orders = useMemo(() => ((ordersData || []) as WorkOrderV2[]).filter(isV2Order), [ordersData])
  const productById = useMemo(() => new Map(((productsData || []) as MfgProduct[]).map((p) => [p.id, p])), [productsData])

  const requests = useMemo(
    () =>
      orders
        .filter((o) => o.status === "open")
        .flatMap((o) => (o.purchaseRequests || []).filter((p) => p.state === "sent").map((p) => ({ order: o, request: p })))
        .sort((a, b) => (a.request.needBy || "9999").localeCompare(b.request.needBy || "9999")),
    [orders]
  )

  const notices = useMemo(
    () => ((noticesData || []) as MfgBlockNotice[]).filter((n) => !n.closedAt && !n.claimRaisedAt).sort((a, b) => (a.at < b.at ? 1 : -1)),
    [noticesData]
  )

  const supplierScrap = useMemo(
    () =>
      orders
        .flatMap((o) => (o.scrapRecords || []).filter((s) => s.status === "approved" && s.bearer === "supplier").map((s) => ({ order: o, scrap: s })))
        .sort((a, b) => ((a.scrap.approvedAt || "") < (b.scrap.approvedAt || "") ? 1 : -1))
        .slice(0, 20),
    [orders]
  )

  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!orgId || (requests.length === 0 && notices.length === 0 && supplierScrap.length === 0)) return null

  const today = new Date().toISOString().slice(0, 10)
  const unitOf = (o: WorkOrderV2) => o.unit || productById.get(o.productId || "")?.unit || ""

  const sourceText = (o: WorkOrderV2): string => {
    const s = sourceOf(o)
    if (s === "project") return `${t("mfg4_source_project")} · ${o.projectName || "—"}`
    if (s === "client") {
      const name = o.source?.contactName || ""
      const so = o.salesOrderNumber != null ? `#${o.salesOrderNumber}` : ""
      return [t("mfg4_source_client"), so, name].filter(Boolean).join(" · ")
    }
    return t("mfg4_source_stock")
  }

  const isLotted = (o: WorkOrderV2, itemName: string): boolean => {
    const p = productById.get(o.productId || "")
    return !!p?.bom.some((b) => b.lotted && itemKey(b.itemName) === itemKey(itemName))
  }

  const rfqHref = (r: PurchaseRequestRecord) =>
    `/contractor/rfqs/new?items=${encodeURIComponent(JSON.stringify([{ name: r.itemName, quantity: r.quantity, unit: r.unit }]))}`

  const confirm = async () => {
    if (!firestore || !pending || busy) return
    setBusy(true)
    setError(null)
    try {
      if (pending.kind === "arrived") {
        const { order: o, request: r, lotted } = pending
        await markPurchaseArrived(firestore, { orderId: o.id, purchaseRequestId: r.id, actor })
        // procurement.purchase.arrived — the order's material date clears (T23).
        await emitMfgEvent(firestore, {
          kind: "purchase_arrived",
          copy: t,
          organizationId: orgId,
          actor,
          to: [{ permission: "manufacturing.manage" }, { users: [r.byId] }],
          params: { ref: orderRef(o), qty: fmtQty(r.quantity), unit: r.unit, item: r.itemName, block: lotted ? "@mfn_arrived_block" : "" },
          workOrderId: o.id,
          link: mfgLinks.order(o.id),
        })
        toast({ title: t("mfy_pr_arrived_saved") })
      } else {
        await markBlockClaimRaised(firestore, { noticeId: pending.notice.id, actor })
        await emitMfgEvent(firestore, {
          kind: "block_claim_raised",
          copy: t,
          organizationId: orgId,
          actor,
          to: [{ users: [pending.notice.byId] }, { permission: "manufacturing.manage" }, { permission: "manufacturing.cost" }],
          params: { lot: pending.notice.lot },
        })
        toast({ title: t("mfy_claim_saved") })
      }
      setPending(null)
    } catch (err) {
      console.error(err)
      setError(mfgActError(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="overflow-hidden border-none shadow-sm" dir={isRtl ? "rtl" : "ltr"}>
      <CardHeader className="border-b bg-muted/30 pb-4">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base font-black">
          <Factory size={18} className="text-primary" aria-hidden="true" />
          {t("mfy_pr_title")}
          {requests.length > 0 && <Badge className="border-none bg-warning/10 text-[11px] text-warning">{requests.length}</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("mfy_pr_desc")}{" "}
          <Link href="/contractor/rfqs/requests" className="font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            {t("pri_open_inbox")} →
          </Link>
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {requests.length > 0 && (
          <ul className="divide-y">
            {requests.map(({ order: o, request: r }) => {
              const late = !!r.needBy && r.needBy.slice(0, 10) < today
              return (
                <li key={`${o.id}-${r.id}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ShoppingCart size={14} className="text-muted-foreground" aria-hidden="true" />
                      <span className="text-sm font-bold text-foreground" dir="auto">{r.itemName}</span>
                      <span className="text-sm font-black text-foreground" dir="ltr">
                        <span className="tabular-nums">{fmtQty(r.quantity)}</span> {r.unit}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", late ? "border-destructive/30 text-destructive" : "text-muted-foreground")}
                      >
                        {r.needBy ? t("mfy_pr_needed_by", { date: formatCrmDate(r.needBy, locale) }) : t("mfy_pr_no_date")}
                      </Badge>
                      {late && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-destructive">
                          <AlertTriangle size={11} aria-hidden="true" />
                          {t("mfy_pr_overdue")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground">
                      <span className="font-mono text-muted-foreground" dir="ltr">{orderRef(o)}</span>
                      <span className="mx-1.5">·</span>
                      <span dir="auto">{o.productName || productById.get(o.productId || "")?.name || ""}</span>
                      <span className="mx-1.5">·</span>
                      <span dir="auto">{sourceText(o)}</span>
                    </p>
                    {r.note && <p className="text-xs text-muted-foreground" dir="auto">{r.note}</p>}
                    <p className="text-[11px] text-muted-foreground">{t("mfy_pr_requested", { name: r.by, date: formatCrmDate(r.at, locale) })}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {canStartRfq && (
                      <Button asChild size="sm" variant="outline" className="h-9 gap-1.5">
                        <Link href={rfqHref(r)}>
                          <Send size={13} aria-hidden="true" />
                          {t("mfy_pr_start_rfq")}
                        </Link>
                      </Button>
                    )}
                    {canMarkArrived && (
                      <Button
                        size="sm"
                        className="h-9 gap-1.5"
                        onClick={() => {
                          setError(null)
                          setPending({ kind: "arrived", order: o, request: r, lotted: isLotted(o, r.itemName) })
                        }}
                      >
                        <PackageCheck size={13} aria-hidden="true" />
                        {t("mfy_pr_mark_arrived")}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {(notices.length > 0 || supplierScrap.length > 0) && (
          <div className={cn("space-y-3 px-5 py-4", requests.length > 0 && "border-t")}>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
                <ShieldAlert size={15} className="text-destructive" aria-hidden="true" />
                {t("mfy_claims_title")}
              </h3>
              <p className="text-[11px] text-muted-foreground">{t("mfy_claims_desc")}</p>
            </div>

            {notices.length > 0 && (
              <ul className="divide-y overflow-hidden rounded-xl border">
                {notices.map((n) => (
                  <li key={n.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-foreground" dir="ltr">{n.lot}</span>
                        {n.itemName && <span className="text-xs text-foreground" dir="auto">{n.itemName}</span>}
                        <Badge className="border-none bg-destructive/10 text-[10px] text-destructive">{t(`mfg4_defect_${n.defect}`)}</Badge>
                        {n.quarantinedAt && <Badge className="border-none bg-muted text-[10px] text-muted-foreground">{t("mfy_claim_quarantined")}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground" dir="auto">{n.note}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("mfy_claim_orders", { count: n.orderIds?.length || 0 })} · {t("mfy_claim_raised_by", { name: n.by, date: formatCrmDate(n.at, locale) })}
                      </p>
                    </div>
                    {canClaim && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 shrink-0 gap-1.5"
                        onClick={() => {
                          setError(null)
                          setPending({ kind: "claim", notice: n })
                        }}
                      >
                        <CheckCircle2 size={13} aria-hidden="true" />
                        {t("mfy_claim_btn")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {supplierScrap.length > 0 && (
              <div className="overflow-hidden rounded-xl border">
                <p className="border-b bg-muted/30 px-4 py-2 text-xs font-bold text-foreground">{t("mfy_claim_scrap")}</p>
                <ul className="divide-y">
                  {supplierScrap.map(({ order: o, scrap: s }: { order: WorkOrderV2; scrap: WorkOrderScrap }) => (
                    <li key={`${o.id}-${s.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
                      <span className="font-mono text-muted-foreground" dir="ltr">{orderRef(o)}</span>
                      <span className="font-semibold text-foreground" dir="auto">{o.productName || ""}</span>
                      <span dir="ltr">
                        <span className="tabular-nums">{fmtQty(s.quantity)}</span> {unitOf(o)}
                      </span>
                      {s.defect && <span className="text-muted-foreground">{t(`mfg4_defect_${s.defect}`)}</span>}
                      {o.slabApproval?.lot && <span className="font-mono text-muted-foreground" dir="ltr">{o.slabApproval.lot}</span>}
                      <span className="ms-auto font-black tabular-nums text-foreground" dir="ltr">{formatSar(s.value, locale)}</span>
                      <span className="w-full text-[11px] text-muted-foreground">
                        {t("mfy_claim_scrap_meta", { name: s.approvedByName || "—", date: formatCrmDate(s.approvedAt, locale) })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!pending} onOpenChange={(v) => { if (!v && !busy) setPending(null) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          {pending?.kind === "arrived" && (
            <AlertDialogHeader>
              <AlertDialogTitle>{t("mfy_pr_arrived_title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("mfy_pr_arrived_desc", { qty: fmtQty(pending.request.quantity), unit: pending.request.unit, item: pending.request.itemName, ref: orderRef(pending.order) })}
              </AlertDialogDescription>
            </AlertDialogHeader>
          )}
          {pending?.kind === "claim" && (
            <AlertDialogHeader>
              <AlertDialogTitle>{t("mfy_claim_confirm_title")}</AlertDialogTitle>
              <AlertDialogDescription>{t("mfy_claim_confirm_desc", { lot: pending.notice.lot })}</AlertDialogDescription>
            </AlertDialogHeader>
          )}
          {pending?.kind === "arrived" && (
            <ul className="space-y-1 text-xs text-foreground">
              {pending.lotted && <li className="font-semibold text-warning">{t("mfy_pr_arrived_lotted")}</li>}
              <li className="text-muted-foreground">{t("mfy_pr_arrived_stock")}</li>
            </ul>
          )}
          <SignedInAs name={actor.name} />
          {error && <p className="text-xs font-semibold text-destructive" role="alert">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="gap-1.5"
              onClick={(ev) => {
                ev.preventDefault()
                void confirm()
              }}
            >
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {pending?.kind === "claim" ? t("mfy_claim_btn") : t("mfy_pr_mark_arrived")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
