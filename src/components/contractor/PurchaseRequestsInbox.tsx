"use client"

// «طلبات الشراء الواردة» (Procurement 1.5, PUR-01): the REQUEST, not the line — what a
// project, the workshop or the stores sent as one request is one card, under the number it
// was written with («ط.م 03 · مجمع الياسمين»), with its materials, its need-by date, its last
// day to order, who asked and one state. On a new request: «انشره» opens its panel on the
// publishing step (then the review, and «انشر» there only), «جهّزه» opens the editor on a
// draft. Picking several offers «اجمعها في طلب عروض واحد». A line's own path and acts (an
// agreement, a direct order, the workshop, «تعذّر الشراء») stay in its drawer («التفاصيل»).
//
// Nothing here RAISES a need. A buyer sees his categories; the owner acts (question 1) unless
// he stepped back. The lines' derivation lives in `need-desk.ts`, the cards in `incoming-requests.ts`.

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, FileSignature, Loader2, Scale, ShoppingCart, X } from "lucide-react"
import { Link, usePathname, useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { useModules } from "@/hooks/useCompanyModules"
import { useProcurementNeeds } from "@/hooks/useProcurementNeeds"
import { cn } from "@/lib/utils"
import { matchesSearch } from "@/lib/search-text"
import { declinePurchaseRequest, markPurchaseArrived, moveRequestToPurchase } from "@/lib/manufacturing-writes"
import { orderRef } from "@/lib/manufacturing-view"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import { inBuyerScope, selectionSummary, type NeedRow } from "@/lib/procurement/need-desk"
import { REQUEST_SEGMENTS, inRequestSegment, requestCards, requestSegmentCounts, sortCards, type RequestCard, type RequestSegment } from "@/lib/procurement/incoming-requests"
import { displayNeedRef } from "@/lib/procurement/format"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { RfqEditor } from "@/components/procurement/rfq-editor/RfqEditor"
import { recordNeedDecision } from "@/lib/procurement/need-decision-writes"
import { todayOf } from "@/lib/procurement/po"
import { ProcWriteError } from "@/lib/procurement/writes"
import { sarLtr } from "@/lib/riyal"
import { fmtQty } from "@/components/manufacturing/ui/MfgUi"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { PrRouteToMfgDialog } from "@/components/contractor/PrRouteToMfgDialog"
import { SignedInAs, mfgActError } from "@/components/shared/MfgHandoffBits"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { DirectOrderDialog } from "@/components/procurement/DirectOrderDialog"
import { NeedLineDrawer } from "@/components/procurement/NeedLineDrawer"
import { ProceedPurchaseDialog } from "@/components/procurement/ProceedPurchaseDialog"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { fmtDay } from "@/components/procurement/need-bits"

type Confirm = { kind: "arrived" | "decline" | "buy" | "lapsed"; row: NeedRow }

const isSeg = (v: string | null): v is RequestSegment => !!v && (REQUEST_SEGMENTS as string[]).includes(v)

export function PurchaseRequestsInbox() {
  const t = useTranslations("Portal.Shared")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = usePermissions()
  const { toast } = useToast()
  const { on } = useModules()
  const world = useProcurementWorld()
  const { actor: procActor, orgId, policies } = world
  const actor = { id: procActor.uid, name: procActor.name }
  const desk = useProcurementNeeds(world)
  const { agreements, history } = useProcurementPrices(orgId || null)
  const [now] = useState(() => new Date())
  const today = todayOf(now)

  const ownerRO = procActor.isOwner && desk.ownerHasTeam
  const canStartRfq = !ownerRO && (procActor.isOwner || can("rfq.manage") || can("rfq.create") || can("offers.accept") || can("po.approve"))
  const canOrder = !ownerRO && (procActor.isOwner || procActor.canPrepare)
  const canAct = canStartRfq || canOrder
  const canMarkArrived = !ownerRO && (procActor.isOwner || can("rfq.manage") || can("warehouses.manage"))
  const canAnswer = !ownerRO && (procActor.isOwner || can("rfq.manage"))

  const search = searchParams.get("search") || ""
  const searching = search.trim().length > 0
  const seg: RequestSegment = searching ? "all" : isSeg(searchParams.get("seg")) ? (searchParams.get("seg") as RequestSegment) : "new"
  const panelKey = searchParams.get("publish")
  const openLine = searchParams.get("line")
  const setQuery = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k)
      else p.set(k, v)
    }
    const qs = p.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  const scoped = useMemo(() => desk.rows.filter((r) => inBuyerScope(r, desk.viewerCategories)), [desk.rows, desk.viewerCategories])
  const cards = useMemo(() => requestCards(scoped, world.rfqs as Array<{ id: string; status?: string | null; needSources?: unknown; purchaseSource?: unknown }>), [scoped, world.rfqs])
  const counts = useMemo(() => requestSegmentCounts(cards), [cards])
  const visible = useMemo(
    () => sortCards(cards.filter((c) => inRequestSegment(c, seg) && matchesSearch(search, [displayNeedRef(c.need.refLabel, locale), c.need.refLabel, c.need.context, c.need.requestedBy, c.need.projectName, c.need.rfqNumber, c.need.poNumber, ...c.rows.map((r) => r.name)]))),
    [cards, seg, search, locale]
  )

  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  useEffect(() => setSelected(new Set()), [seg])
  const toggle = (needKey: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(needKey)) next.delete(needKey)
      else next.add(needKey)
      return next
    })
  const summary = useMemo(() => selectionSummary(scoped, selected, { agreements, policies, now }), [scoped, selected, agreements, policies, now])

  const [ordering, setOrdering] = useState<{ rows: NeedRow[]; mode: "agreement" | "direct" } | null>(null)
  const [proceeding, setProceeding] = useState<NeedRow[] | null>(null)
  const [asking, setAsking] = useState<NeedRow | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const siblings = (row: NeedRow) => scoped.filter((r) => r.needKey === row.needKey && r.open > 0)
  /** «جهّزه» / «اجمعها في طلب عروض واحد»: the editor on these requests, each its own group (PUR-01, PUR-02). */
  const editorHref = (keys: string[]) => `/contractor/rfqs/new?requests=${encodeURIComponent(Array.from(new Set(keys)).join("|"))}`

  const drawerRow = openLine ? desk.rows.find((r) => r.key === openLine) ?? null : null
  const mfgOf = (row: NeedRow) => (row.need.kind === "mfg" ? desk.mfgByKey.get(row.needKey) : undefined)

  const runConfirm = async () => {
    if (!firestore || !confirm || busy) return
    const { kind, row } = confirm
    setBusy(true)
    setError(null)
    try {
      if (kind === "arrived" || kind === "decline") {
        const m = mfgOf(row)
        if (!m) return
        const { order: o, request: r, lotted } = m
        if (kind === "arrived") {
          await markPurchaseArrived(firestore, { orderId: o.id, purchaseRequestId: r.id, actor })
          await emitMfgEvent(firestore, { kind: "purchase_arrived", copy: t, organizationId: orgId, actor, to: [{ permission: "manufacturing.manage" }, { permission: "warehouses.manage" }, { users: [r.byId] }], params: { ref: orderRef(o), qty: fmtQty(r.quantity), unit: r.unit, item: r.itemName, block: lotted ? "@mfn_arrived_block" : "" }, workOrderId: o.id, link: mfgLinks.inventoryDesk() })
          toast({ title: t("mfy_pr_arrived_saved") })
        } else {
          await declinePurchaseRequest(firestore, { orderId: o.id, purchaseRequestId: r.id, reason, actor })
          await emitMfgEvent(firestore, { kind: "purchase_declined", copy: t, organizationId: orgId, actor, to: [{ permission: "manufacturing.manage" }, { users: [r.byId] }], params: { ref: orderRef(o), qty: fmtQty(r.quantity), unit: r.unit, item: r.itemName, reason: reason.trim() }, workOrderId: o.id, link: mfgLinks.order(o.id) })
          toast({ title: t("pri_declined_saved") })
        }
      } else if (kind === "buy") {
        const s = row.need.source
        if (s.kind !== "project_request" || !s.projectId || !s.purchaseRequestId) return
        await recordNeedDecision(firestore, procActor, { projectId: s.projectId, requestId: s.purchaseRequestId, kind: "buy" })
        toast({ title: t("nd_buy_saved") })
      } else {
        const mr = row.need.mfgRequestId ? desk.mfgRequests[row.need.mfgRequestId] : undefined
        if (!mr) return
        await moveRequestToPurchase(firestore, { request: mr, actor })
        toast({ title: t("nd_lapsed_saved") })
      }
      setConfirm(null)
      setReason("")
    } catch (err) {
      console.error(err)
      setError(err instanceof ProcWriteError ? tProc(`err_${err.code}`, err.params) : mfgActError(t, err))
    } finally {
      setBusy(false)
    }
  }

  const loading = desk.loading
  const money = (v: number) => sarLtr(Math.round(v).toLocaleString("en-US"))
  const actsFor = (row: NeedRow) => {
    const m = mfgOf(row)
    const live = m && (m.request.state === "sent" || m.request.state === "ordered")
    return {
      canAct: canAct && inBuyerScope(row, desk.viewerCategories),
      canRfq: canStartRfq,
      canOrder,
      seesPrices: procActor.seesPrices,
      onRfq: (r: NeedRow) => setQuery({ publish: r.needKey, line: null }),
      onOrder: (r: NeedRow, mode: "agreement" | "direct") => setOrdering({ rows: siblings(r), mode }),
      onProceed: (r: NeedRow) => setProceeding(desk.rows.filter((x) => x.needKey === r.needKey)),
      onAskWorkshop: (r: NeedRow) => setAsking(r),
      onBuyNotMake: (r: NeedRow) => setConfirm({ kind: "buy", row: r }),
      onWorkshopLapsed: (r: NeedRow) => setConfirm({ kind: "lapsed", row: r }),
      onArrived: live && canMarkArrived ? (r: NeedRow) => setConfirm({ kind: "arrived", row: r }) : undefined,
      onSendBack: live && canAnswer ? (r: NeedRow) => setConfirm({ kind: "decline", row: r }) : undefined,
    }
  }

  return (
    <div className="space-y-6 pb-24" dir={isRtl ? "rtl" : "ltr"}>
      <ProcurementHeader title={t("pri_title")} description={t("nd_desc")} />

      <div className="flex flex-wrap items-center gap-2">
        <ProcChipGroup items={REQUEST_SEGMENTS.filter((f) => f !== "elsewhere" || counts.elsewhere > 0).map((f) => ({ id: f, label: t(`rq_seg_${f}`), count: counts[f] }))} active={seg} onPick={(f) => setQuery({ seg: f, search: null })} label={t("pri_state")} dimmed={searching} />
        {searching && (
          <span className="ms-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
            {t("nd_results", { count: visible.length, term: search.trim() })}
            <button type="button" onClick={() => setQuery({ search: null, seg: null })} aria-label={t("so_search_clear")} className="grid h-6 w-6 place-items-center rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        )}
        {ownerRO && <span className="ms-auto text-xs font-semibold text-muted-foreground">{t("nd_owner_read")}</span>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border bg-card p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border bg-card p-12 text-center text-muted-foreground">
          <ShoppingCart size={36} className="mx-auto mb-2 opacity-20" aria-hidden="true" />
          <p className="text-sm">{searching ? t("so_search_none", { term: search.trim() }) : t("rq_empty")}</p>
          <p className="mt-1 text-xs">{on("project-management") ? t("rq_empty_hint") : t("rq_empty_hint_team")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((c) => (
            <RequestCardView
              key={c.key}
              card={c}
              selectable={canStartRfq && c.selectable}
              selected={selected.has(c.key)}
              onToggle={() => toggle(c.key)}
              canAct={canStartRfq}
              onPublish={() => setQuery({ publish: c.key, line: null })}
              prepareHref={editorHref([c.key])}
              onDetails={() => setQuery({ line: c.rows[0].key })}
            />
          ))}
        </ul>
      )}

      {canAct && summary.lines > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3 shadow-lg" role="region" aria-label={t("nd_selection")}>
          <b className="text-sm">{t("rq_sel", { count: selected.size, lines: summary.lines })}</b>
          <span className="text-xs text-muted-foreground">{summary.value != null && procActor.seesPrices ? t("nd_sel_value", { value: money(summary.value) }) : t("nd_sel_no_estimate")}</span>
          <span className="ms-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={() => setSelected(new Set())}>
              {t("nd_clear")}
            </Button>
            {canOrder && summary.agreement && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOrdering({ rows: summary.rows, mode: "agreement" })}>
                <FileSignature size={13} aria-hidden="true" /> {t("dor_open_agreement")}
              </Button>
            )}
            {canOrder && summary.directOk && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOrdering({ rows: summary.rows, mode: "direct" })}>
                <ShoppingCart size={13} aria-hidden="true" /> {t("dor_open_direct")}
              </Button>
            )}
            {canStartRfq && (
              <Button asChild size="sm" className="h-8 gap-1.5">
                <Link href={editorHref(Array.from(selected))}>
                  <Scale size={13} aria-hidden="true" /> {selected.size > 1 ? t("rq_combine") : t("rq_prepare")}
                </Link>
              </Button>
            )}
          </span>
        </div>
      )}

      {/* «انشره»: the request's own panel — الطلب · النشر · المراجعة (PUR-01 p.3–4). */}
      <Sheet open={!!panelKey} onOpenChange={(o) => !o && setQuery({ publish: null })}>
        <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="w-full overflow-y-auto sm:max-w-4xl">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("rq_panel")}</SheetTitle>
          </SheetHeader>
          {panelKey && <RfqEditor key={panelKey} variant="panel" requestKeys={[panelKey]} onClose={() => setQuery({ publish: null })} />}
        </SheetContent>
      </Sheet>

      {drawerRow && <NeedLineDrawer row={drawerRow} agreements={agreements} history={history} cap={policies.directPurchaseCap} today={today} acts={actsFor(drawerRow)} orgId={orgId || null} onClose={() => setQuery({ line: null })} />}

      {ordering && (
        <DirectOrderDialog
          rows={ordering.rows}
          mode={ordering.mode}
          agreement={ordering.mode === "agreement" ? selectionSummary(ordering.rows, new Set(ordering.rows.map((r) => r.needKey)), { agreements, policies, now }).agreement : null}
          history={history}
          orders={world.orders}
          supplierRecords={world.supplierRecords}
          policies={policies}
          actor={procActor}
          orgId={orgId}
          onClose={() => {
            setOrdering(null)
            setSelected(new Set())
          }}
        />
      )}
      {proceeding && <ProceedPurchaseDialog rows={proceeding} actor={procActor} onClose={() => setProceeding(null)} />}
      {asking && on("manufacturing") && asking.need.source.kind === "project_request" && (
        <PrRouteToMfgDialog
          makeOrBuy
          request={{ id: asking.need.source.purchaseRequestId || "", title: asking.need.refLabel, items: asking.need.lines.map((l) => ({ name: l.name, quantity: String(l.quantity), unit: l.unit })), notes: asking.need.note }}
          projectId={asking.need.projectId || ""}
          projectName={asking.need.projectName || ""}
          orgId={orgId}
          actor={actor}
          products={desk.products}
          settings={desk.mfgSettings}
          onClose={() => setAsking(null)}
        />
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>{t(`nd_confirm_${confirm.kind}_title`)}</DialogTitle>
                <DialogDescription>
                  {confirm.kind === "arrived"
                    ? t("pri_arrived_desc", { qty: fmtQty(confirm.row.total), unit: confirm.row.unit, item: confirm.row.name })
                    : confirm.kind === "decline"
                      ? t("pri_decline_desc", { item: confirm.row.name, ref: confirm.row.need.refLabel })
                      : t(`nd_confirm_${confirm.kind}_desc`, { item: confirm.row.name })}
                </DialogDescription>
              </DialogHeader>
              {confirm.kind === "decline" && (
                <div className="space-y-1.5">
                  <Label htmlFor="pri-reason">{t("pri_decline_reason")}</Label>
                  <Input id="pri-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("pri_decline_reason_ph")} dir="auto" />
                </div>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
              <SignedInAs name={actor.name} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>
                  {t("acc_cancel")}
                </Button>
                <Button onClick={runConfirm} disabled={busy || (confirm.kind === "decline" && !reason.trim())} className="gap-1.5">
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

function RequestCardView({
  card: c,
  selectable,
  selected,
  onToggle,
  canAct,
  onPublish,
  prepareHref,
  onDetails,
}: {
  card: RequestCard
  selectable: boolean
  selected: boolean
  onToggle: () => void
  canAct: boolean
  onPublish: () => void
  prepareHref: string
  onDetails: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const n = c.need
  const ref = displayNeedRef(n.refLabel, locale)
  const place = n.projectName || n.context || t("nd_for_stock")
  const ld = c.lastOrderIn
  const live = c.state === "new" || c.state === "prepared" || c.state === "partial"
  return (
    <li className={cn("rounded-2xl border bg-card p-4 transition-colors", selected && "border-module/50 bg-module/5")}>
      <div className="flex flex-wrap items-start gap-3">
        {selectable && <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={t("rq_select", { ref })} className="mt-1" />}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="flex flex-wrap items-center gap-2">
            <b className="text-base" dir="auto">
              {ref}
            </b>
            <span className="text-sm font-semibold text-foreground" dir="auto">
              {place}
            </span>
            <StatusPill tone={RQ_TONE[c.state]}>{t(`rq_state_${c.state}`, { rfq: n.rfqNumber || "", po: n.poNumber || "" })}</StatusPill>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">{t(`pri_from_${n.kind}`)}</span>
          </p>
          {n.requestedBy && <p className="text-xs text-muted-foreground">{t("rq_by", { name: n.requestedBy })}</p>}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" dir="auto">
            {c.rows.map((r) => (
              <span key={r.key}>
                {r.name} <b className="tabular-nums" dir="ltr">{fmtQty(r.state === "open" || r.state === "late" ? r.open : r.total)}</b> <span className="text-xs text-muted-foreground">{r.unit}</span>
                {r.samplePending && <span className="ms-1 text-[11px] font-semibold text-warning">· {t("nd_sample_pending")}</span>}
              </span>
            ))}
          </p>
          <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            <span>{t("rq_need_by", { date: c.needBy ? fmtDay(c.needBy, locale) : "—" })}</span>
            {live && ld != null && (
              <span className={cn("inline-flex items-center gap-1 font-semibold", ld < 0 ? "text-destructive" : ld <= 2 ? "text-warning" : "")}>
                {ld < 0 && <AlertTriangle size={11} aria-hidden="true" />}
                {ld < 0 ? t("nd_last_day_passed", { days: -ld }) : t("nd_order_by", { date: fmtDay(c.lastOrderDay, locale), days: ld })}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAct && c.state === "new" && (
            <>
              <Button size="sm" onClick={onPublish}>
                {t("rq_publish")}
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={prepareHref}>{t("rq_prepare")}</Link>
              </Button>
            </>
          )}
          {canAct && c.state === "prepared" && c.draftId && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/contractor/rfqs/new?edit=${c.draftId}`}>{t("rq_open_draft")}</Link>
            </Button>
          )}
          {(c.state === "rfq" || c.state === "partial") && n.rfqId && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/contractor/rfqs/${n.rfqId}`}>{t("rq_open_rfq")}</Link>
            </Button>
          )}
          {c.state === "order" && n.poId && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/contractor/rfqs/orders?po=${n.poId}`}>{t("rq_open_po")}</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDetails}>
            {t("nd_details")}
          </Button>
        </div>
      </div>
    </li>
  )
}

const RQ_TONE: Record<RequestCard["state"], "ok" | "warn" | "bad" | "info" | "mute" | "module" | "violet"> = {
  new: "module",
  prepared: "info",
  elsewhere: "mute",
  partial: "violet",
  rfq: "violet",
  order: "info",
  done: "ok",
  failed: "bad",
  withdrawn: "mute",
}
