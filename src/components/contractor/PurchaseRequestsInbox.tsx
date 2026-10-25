"use client"

// «طلبات الشراء الواردة» (Procurement 2.0, INC-01..11): the REQUEST, not the line — what a
// project, the team, the workshop or the stores sent as one request is one card, under the number it
// was written with («ط.م 03 · مجمع الياسمين»), with who asked, who approved, where it goes, its
// materials, its need-by date, its last day to order and one state — read from the STORED request
// (`procIncoming`), whose lines are each in one place. The segments are قادمة · جديدة · مُجهَّزة · في عروض ·
// في أوامر · اكتملت · انتهت; what is left to buy of a partly handled request stays in «جديدة» under «الباقي منه».
// On a new request: «انشره» opens its panel on the publishing step (then the review, and «انشر» there
// only), «جهّزه» opens the editor on a draft, «تعذّر الشراء» closes what is left to buy with the reason its
// requester reads. Picking several offers «اجمعها في طلب عروض واحد». A line's own path and acts (an
// agreement, a direct order, the workshop) stay in its drawer («التفاصيل»).
//
// Nothing here RAISES a need except «طلب مواد» of a company without Project Management. A buyer sees his
// categories; the owner acts (question 1) unless he stepped back. The lines' derivation lives in
// `need-desk.ts`, the cards in `incoming-requests.ts`, the request's rules in `incoming-state.ts`.

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, Eye, FileSignature, Layers, Loader2, PackagePlus, Scale, ShoppingCart, Users, X } from "lucide-react"
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
import { declinePurchaseRequest, markPurchaseArrived } from "@/lib/manufacturing-writes"
import { orderRef } from "@/lib/manufacturing-view"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import { inBuyerScope, selectionSummary, type NeedRow } from "@/lib/procurement/need-desk"
import { REQUEST_SEGMENTS, inRequestSegment, requestCards, requestSegmentCounts, sortCards, type RequestCard, type RequestSegment } from "@/lib/procurement/incoming-requests"
import { displayNeedRef, displayPoNumber } from "@/lib/procurement/format"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { RfqEditor } from "@/components/procurement/rfq-editor/RfqEditor"
import { replyClockOf, type ReplyClock } from "@/lib/procurement/incoming-state"
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
import { BeforeBuyingTable, BeforeChips } from "@/components/procurement/BeforeBuying"
import { GuideLink } from "@/components/procurement/guide/GuideLink"
import { ByMaterialView } from "@/components/procurement/ByMaterialView"
import { UpcomingList } from "@/components/procurement/UpcomingList"
import { RequestStatusBlock } from "@/components/procurement/RequestStatusBlock"
import { Callout } from "@/components/module-ui/Callout"
import { useUpcoming } from "@/hooks/useUpcoming"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { TeamRequestDialog } from "@/components/procurement/TeamRequestDialog"
import { ReqFailDialog } from "@/components/procurement/ReqFailDialog"
import { fmtDay } from "@/components/procurement/need-bits"
import { siteLine } from "@/lib/procurement/delivery-sites"
import { displayCity } from "@/lib/constants"

type Confirm = { kind: "arrived" | "decline"; row: NeedRow }

const isSeg = (v: string | null): v is RequestSegment => !!v && (REQUEST_SEGMENTS as string[]).includes(v)

/** The states whose request may still have lines to publish: its panel is the request; the others open the line's own drawer. */
const PANEL_STATES: RequestCard["state"][] = ["new", "prepared", "partial"]
const hasPanel = (c: RequestCard) => PANEL_STATES.includes(c.state)

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
  const mfgOn = on("manufacturing")
  const clock = useMemo(() => replyClockOf(now, policies), [now, policies])

  const ownerRO = procActor.isOwner && desk.ownerHasTeam
  const canStartRfq = !ownerRO && (procActor.isOwner || can("rfq.manage") || can("rfq.create") || can("offers.accept") || can("po.approve"))
  const canOrder = !ownerRO && (procActor.isOwner || procActor.canPrepare)
  const canAct = canStartRfq || canOrder
  const canMarkArrived = !ownerRO && (procActor.isOwner || can("rfq.manage") || can("warehouses.manage"))
  const canAnswer = !ownerRO && (procActor.isOwner || can("rfq.manage"))

  const search = searchParams.get("search") || ""
  const searching = search.trim().length > 0
  const byMaterialView = searchParams.get("view") === "mat" && !searching
  const seg: RequestSegment = searching ? "all" : isSeg(searchParams.get("seg")) ? (searchParams.get("seg") as RequestSegment) : "new"
  // Without Project Management the team asks for materials here (PUR-10, question 4): «طلب مواد».
  const teamOn = !on("project-management")
  const [raising, setRaising] = useState(false)
  const [failing, setFailing] = useState<RequestCard | null>(null)
  const panelKey = searchParams.get("publish")
  // «انشره» opens the panel on the publishing step; a press on the row (or «التفاصيل») on the request itself.
  const panelStep: 1 | 2 = searchParams.get("step") === "1" ? 1 : 2
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
  const upcoming = useUpcoming(orgId || null)
  const counts = useMemo(() => requestSegmentCounts(cards, upcoming.items.length), [cards, upcoming.items.length])
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
  const [asking, setAsking] = useState<NeedRow | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const siblings = (row: NeedRow) => scoped.filter((r) => r.needKey === row.needKey && r.open > 0)
  /** «جهّزه» / «اجمعها في طلب عروض واحد»: the editor on these requests, each its own group (PUR-01, PUR-02). */
  const editorHref = (keys: string[]) => `/contractor/rfqs/new?requests=${encodeURIComponent(Array.from(new Set(keys)).join("|"))}`

  const panelCard = panelKey ? cards.find((c) => c.key === panelKey) ?? null : null
  const drawerRow = openLine ? desk.rows.find((r) => r.key === openLine) ?? null : null
  const drawerCard = drawerRow ? cards.find((c) => c.key === drawerRow.needKey) ?? null : null
  // A request with nothing left to buy (each material issued, made or waiting for a reply) opens its panel with the reason, and no editor.
  const panelBlocked = !!panelCard && panelCard.buyLines === 0 && PANEL_STATES.includes(panelCard.state)
  const deadlineOf = (rfqId: string | null | undefined) => (rfqId ? ((world.rfqs.find((r) => r.id === rfqId)?.deadline as string | null | undefined) ?? null) : null)
  const orderOf = (poId: string | null | undefined) => {
    const o = poId ? world.orders.find((x) => x.id === poId) : null
    return o ? { supplierName: o.supplierName || null, dueDate: o.promisedDate || o.dueDate || null } : null
  }
  useEffect(() => {
    if (!panelBlocked || panelStep !== 2) return
    toast({ title: t("rq_nothing_toast") })
    setQuery({ step: "1" })
  }, [panelBlocked, panelStep, panelKey])
  const mfgOf = (row: NeedRow) => (row.need.kind === "mfg" ? desk.mfgByKey.get(row.needKey) : undefined)

  const runConfirm = async () => {
    if (!firestore || !confirm || busy) return
    const { kind, row } = confirm
    setBusy(true)
    setError(null)
    try {
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
      onAskWorkshop: (r: NeedRow) => setAsking(r),
      onArrived: live && canMarkArrived ? (r: NeedRow) => setConfirm({ kind: "arrived", row: r }) : undefined,
      onSendBack: live && canAnswer ? (r: NeedRow) => setConfirm({ kind: "decline", row: r }) : undefined,
    }
  }

  return (
    <div className="space-y-6 pb-24" dir={isRtl ? "rtl" : "ltr"}>
      <ProcurementHeader
        title={t("pri_title")}
        description={teamOn ? t(on("manufacturing") ? "nd_desc_team" : "nd_desc_team_stock") : t("nd_desc")}
        action={
          teamOn ? (
            <Button className="gap-1.5" onClick={() => setRaising(true)}>
              <PackagePlus size={15} aria-hidden="true" /> {t("tr_open")}
            </Button>
          ) : undefined
        }
      />

      <GuideLink variant="incoming" />

      <div className="flex flex-wrap items-center gap-2">
        <ProcChipGroup<"req" | "mat">
          items={[
            { id: "req", label: tProc("bymat_view_request") },
            { id: "mat", label: tProc("bymat_view_material") },
          ]}
          active={byMaterialView ? "mat" : "req"}
          onPick={(v) => setQuery({ view: v === "mat" ? "mat" : null })}
          label={tProc("bymat_view_label")}
        />
        {!byMaterialView && <ProcChipGroup<RequestSegment>
          items={REQUEST_SEGMENTS.map((f) => ({ id: f, label: t(`rq_seg_${f}`), count: counts[f] }))}
          active={seg}
          onPick={(f) => setQuery({ seg: f, search: null })}
          label={t("pri_state")}
          dimmed={searching}
        />}
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

      {teamOn && !byMaterialView && !(seg === "upcoming" && !searching) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          <Users size={16} className="shrink-0 text-module" aria-hidden="true" />
          <span className="min-w-0 flex-1 basis-72">{t("rq_team_banner")}</span>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link href="/contractor/rfqs/my-requests">
              <Eye size={13} aria-hidden="true" /> {t("rq_team_view")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link href="/contractor/rfqs/guide">
              <Layers size={13} aria-hidden="true" /> {t("rq_team_flow")}
            </Link>
          </Button>
        </div>
      )}

      {byMaterialView ? (
        loading ? (
          <div className="flex items-center justify-center rounded-2xl border bg-card p-16">
            <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
          </div>
        ) : (
          <ByMaterialView rows={scoped} history={history} canCombine={canStartRfq} />
        )
      ) : seg === "upcoming" && !searching ? (
        <UpcomingList items={upcoming.items} loading={upcoming.loading} watched={upcoming.watched} onWatch={upcoming.watch} history={history} />
      ) : loading ? (
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
              onPublish={() => setQuery({ publish: c.key, step: null, line: null })}
              prepareHref={editorHref([c.key])}
              onDetails={() => (hasPanel(c) ? setQuery({ publish: c.key, step: "1", line: null }) : setQuery({ line: c.rows[0].key }))}
              onLine={(rowKey) => setQuery({ line: rowKey })}
              onFail={c.need.incoming && canStartRfq && c.buyLines > 0 ? () => setFailing(c) : undefined}
              rfqCloses={(id) => (world.rfqs.find((r) => r.id === id)?.deadline as string | null | undefined) ?? null}
              clock={clock}
              mfgOn={mfgOn}
            />
          ))}
        </ul>
      )}

      {teamOn && (
        <TeamRequestDialog
          open={raising}
          onOpenChange={setRaising}
          orgId={orgId || ""}
          from="incoming"
          onSent={() => setQuery({ seg: "new", search: null })}
        />
      )}

      <ReqFailDialog card={failing} onClose={() => setFailing(null)} />

      {canAct && summary.lines > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3 shadow-lg max-md:pe-20" role="region" aria-label={t("nd_selection")}>
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
      <Sheet open={!!panelKey} onOpenChange={(o) => !o && setQuery({ publish: null, step: null })}>
        <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="w-full overflow-y-auto sm:max-w-4xl">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("rq_panel")}</SheetTitle>
          </SheetHeader>
          {panelCard && (
            <div className="space-y-3 px-4 pt-4">
              <RequestStatusBlock card={panelCard} rfqDeadline={deadlineOf(panelCard.rfqs[0]?.id)} order={orderOf(panelCard.orders[0]?.id)} />
              {panelCard.need.incoming && <BeforeBuyingTable doc={panelCard.need.incoming} clock={clock} mfgOn={mfgOn} canAct={canStartRfq} history={history} />}
              {panelCard.need.incoming?.src === "mfg" && <p className="text-xs text-muted-foreground">{tProc("before_hint_mfg_src")}</p>}
              {panelBlocked && <Callout tone="warn">{t("rq_nothing_block")}</Callout>}
            </div>
          )}
          {panelKey && !panelBlocked && <RfqEditor key={`${panelKey}:${panelStep}`} variant="panel" requestKeys={[panelKey]} startStep={panelStep} onClose={() => setQuery({ publish: null, step: null })} />}
        </SheetContent>
      </Sheet>

      {drawerRow && (
        <NeedLineDrawer
          row={drawerRow}
          agreements={agreements}
          history={history}
          cap={policies.directPurchaseCap}
          today={today}
          acts={actsFor(drawerRow)}
          orgId={orgId || null}
          banner={drawerCard ? <RequestStatusBlock card={drawerCard} rfqDeadline={deadlineOf(drawerCard.rfqs[0]?.id)} order={orderOf(drawerCard.orders[0]?.id)} /> : undefined}
          onClose={() => setQuery({ line: null })}
        />
      )}

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
                    : t("pri_decline_desc", { item: confirm.row.name, ref: displayNeedRef(confirm.row.need.refLabel, locale) })}
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
                <Button onClick={runConfirm} disabled={busy || (confirm.kind === "decline" && reason.trim().length < 3)} className="gap-1.5">
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
  onLine,
  onFail,
  rfqCloses,
  clock,
  mfgOn,
}: {
  card: RequestCard
  selectable: boolean
  selected: boolean
  onToggle: () => void
  canAct: boolean
  onPublish: () => void
  prepareHref: string
  onDetails: () => void
  /** A press on a material opens that line's own drawer (its path and acts). */
  onLine: (rowKey: string) => void
  /** «تعذّر الشراء»: closes what is left to buy, with the reason and the alternative its requester reads. */
  onFail?: () => void
  rfqCloses: (rfqId: string) => string | null
  clock: ReplyClock
  mfgOn: boolean
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const n = c.need
  const doc = n.incoming
  const ref = displayNeedRef(n.refLabel, locale)
  const place = n.projectName || n.context || t("nd_for_stock")
  const ld = c.lastOrderIn
  const live = c.buyLines > 0 && (c.state === "new" || c.state === "prepared" || c.state === "partial")
  const rfqLink = c.rfqs[0] ?? (n.rfqId ? { id: n.rfqId, number: n.rfqNumber } : null)
  const poLink = c.orders[0] ?? (n.poId ? { id: n.poId, number: n.poNumber } : null)
  const inHand = c.state === "rfq" || c.state === "partial" || c.state === "order"
  const where = doc ? siteLine(doc.place, (c) => displayCity(c, locale)) : ""
  const closes = rfqLink ? rfqCloses(rfqLink.id) : null
  const noCategory = c.rows.some((r) => (r.state === "open" || r.state === "late" || r.state === "mfgl") && doc && !doc.lines[r.index]?.material && !doc.lines[r.index]?.category)
  const meta = [
    n.requestedBy ? t("rq_by", { name: n.requestedBy }) : "",
    n.approved?.name || n.approved?.on ? t("rq_approved", { date: n.approved.on ? fmtDay(n.approved.on, locale) : "—" }) : "",
    doc?.workOrderNo ? t("rq_wo", { no: doc.workOrderNo }) : "",
    where ? t("rq_place", { place: where }) : "",
  ].filter(Boolean)
  const lineNote = (r: NeedRow): string | null => {
    const own = doc?.lines[r.index]
    if (r.state === "chk") return t("bef_wait_stock")
    if (r.state === "mfgw") return t("bef_wait_mfg")
    if (r.state === "stk") return t("bef_covered")
    if (r.state === "cx") return own?.fail ? t("bef_failed") : t("bef_gone")
    if (own && (own.mk?.st === "make" || own.mk?.st === "part")) return t("bef_make")
    return null
  }
  return (
    <li
      className={cn("cursor-pointer rounded-2xl border bg-card p-4 transition-colors hover:border-module/40", selected && "border-module/50 bg-module/5")}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, input, label, [role='checkbox']")) return
        onDetails()
      }}
    >
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
            <StatusPill tone={RQ_TONE[c.state]}>{t(`rq_state_${c.state}`)}</StatusPill>
            {c.remainder && <StatusPill tone="violet">{t("rq_remainder")}</StatusPill>}
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">{t(`pri_from_${n.kind}`)}</span>
          </p>
          {meta.length > 0 && (
            <p className="text-xs text-muted-foreground" dir="auto">
              {meta.join(" · ")}
            </p>
          )}
          {doc && live && <BeforeChips doc={doc} clock={clock} mfgOn={mfgOn} />}
          {live && noCategory && <StatusPill tone="warn">{t("rq_no_cat")}</StatusPill>}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" dir="auto">
            {c.rows.map((r) => {
              const note = lineNote(r)
              const reduced = r.state === "open" && r.total > r.open + 0.005
              return (
                <span key={r.key}>
                  <button type="button" onClick={() => onLine(r.key)} className="rounded text-start hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("rq_line_open", { name: r.name })}>
                    {r.name}
                  </button>{" "}
                  <b className="tabular-nums" dir="ltr">{fmtQty(r.state === "open" ? r.open : r.total)}</b>
                  {reduced && <s className="ms-1 text-xs tabular-nums text-muted-foreground" dir="ltr">{fmtQty(r.total)}</s>}{" "}
                  <span className="text-xs text-muted-foreground">{r.unit}</span>
                  {r.link && <span className="ms-1 text-[11px] font-semibold text-muted-foreground">· {t(r.link.poId ? "rq_line_in_po" : "rq_line_in_rfq", { ref: r.link.poId ? r.link.poNumber || "" : r.link.rfqNumber || "" })}</span>}
                  {note && <span className="ms-1 text-[11px] font-semibold text-warning">· {note}</span>}
                  {r.samplePending && <span className="ms-1 text-[11px] font-semibold text-warning">· {t("nd_sample_pending")}</span>}
                </span>
              )
            })}
          </p>
          {(c.state === "rfq" || c.state === "partial") && rfqLink && (
            <p className="text-xs font-semibold text-module" dir="auto">
              {rfqLink.number || "—"} · {t("rq_closes")} {closes ? fmtDay(closes, locale) : "—"}
            </p>
          )}
          {(c.state === "order" || c.state === "partial") && poLink && (
            <p className="text-xs font-semibold text-module" dir="ltr">
              {displayPoNumber(poLink.number || "", locale)}
            </p>
          )}
          {c.state === "withdrawn" && <p className="text-xs font-semibold text-muted-foreground">{t("rq_withdrawn_by", { name: c.withdrawal?.byName || "—", date: c.withdrawal?.on ? fmtDay(c.withdrawal.on, locale) : "—" })}</p>}
          {c.failed && (
            <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive" dir="auto">
              {c.failed.alt ? t("rq_failed_block", { why: c.failed.why, alt: c.failed.alt }) : t("rq_failed_block_noalt", { why: c.failed.why })}
            </p>
          )}
          {c.changes.map((ch) => (
            <p key={ch.kind} className="text-xs font-semibold text-warning" dir="auto">
              {t(ch.kind === "withdrawn" ? "pchg_withdrawn" : "pchg_changed")} · {t("pchg_by", { name: ch.byName || "—", date: ch.on ? fmtDay(ch.on, locale) : "—" })}
              {": "}
              {ch.lines.map((l) => (ch.kind === "withdrawn" ? t("pchg_line_withdrawn", { name: l.name, qty: fmtQty(l.was), unit: l.unit }) : t("pchg_line_changed", { name: l.name, was: fmtQty(l.was), now: fmtQty(l.now), unit: l.unit }))).join(" ؛ ")}
              {inHand && ` — ${t("pchg_decide")}`}
            </p>
          ))}
          <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            <span>{t("rq_need_by", { date: c.needBy ? fmtDay(c.needBy, locale) : "—" })}</span>
            {live && ld != null && (
              <span className={cn("inline-flex items-center gap-1 font-semibold", ld <= 2 ? "text-destructive" : ld <= 7 ? "text-warning" : "")}>
                {ld < 0 && <AlertTriangle size={11} aria-hidden="true" />}
                {ld < 0 ? t("nd_last_day_passed", { days: -ld }) : t("rq_last_day", { date: fmtDay(c.lastOrderDay, locale), days: ld })}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAct && c.buyLines > 0 && (c.state === "new" || c.state === "partial") && (
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
          {(c.state === "rfq" || c.state === "partial") && rfqLink && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/contractor/rfqs/${rfqLink.id}`}>{t("rq_open_rfq")}</Link>
            </Button>
          )}
          {(c.state === "order" || c.state === "partial") && poLink?.id && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/contractor/rfqs/orders?po=${poLink.id}`}>{t("rq_open_po")}</Link>
            </Button>
          )}
          {onFail && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onFail}>
              {t("rq_fail")}
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
  partial: "violet",
  rfq: "violet",
  order: "info",
  done: "ok",
  failed: "bad",
  withdrawn: "mute",
}
