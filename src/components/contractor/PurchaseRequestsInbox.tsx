"use client"

// «طلبات الشراء الواردة» (PRD 3.0 §7.2; the prototype's vNeed): every need line
// that reached Purchasing — a work order's shortfall, a project's request, a
// stock gap — ONE ROW PER MATERIAL LINE, sorted by its last order day, each
// with its computed path and one next step in its drawer. Lines are selected
// and ordered together (an agreement order, a direct order, one RFQ); a
// project request's lines travel as one, because its links are the request's.
//
// Nothing here RAISES a need. A buyer sees his categories; the owner, when he
// has a team, reads. The derivation lives in `src/lib/procurement/need-desk.ts`.

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, FileSignature, Lightbulb, Loader2, Scale, ShoppingCart, X } from "lucide-react"
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
import { useProcurementNeeds } from "@/hooks/useProcurementNeeds"
import { cn } from "@/lib/utils"
import { matchesSearch } from "@/lib/search-text"
import { declinePurchaseRequest, markPurchaseArrived, moveRequestToPurchase } from "@/lib/manufacturing-writes"
import { orderRef } from "@/lib/manufacturing-view"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import { DESK_SEGMENTS, inBuyerScope, inSegment, isActionState, mergeHint, segmentCounts, selectionSummary, sortRows, type DeskSegment, type NeedRow } from "@/lib/procurement/need-desk"
import { needSourceParam } from "@/lib/procurement/needs"
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
import { LINE_STATE_TONE, PATH_ICON, PATH_TONE, fmtDay } from "@/components/procurement/need-bits"

type Confirm = { kind: "arrived" | "decline" | "buy" | "lapsed"; row: NeedRow }

const isSeg = (v: string | null): v is DeskSegment => !!v && (DESK_SEGMENTS as string[]).includes(v)

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
  const seg: DeskSegment = searching ? "all" : isSeg(searchParams.get("seg")) ? (searchParams.get("seg") as DeskSegment) : "act"
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
  const counts = useMemo(() => segmentCounts(scoped), [scoped])
  const visible = useMemo(
    () => sortRows(scoped.filter((r) => inSegment(r, seg) && matchesSearch(search, [r.name, r.need.refLabel, r.need.context, r.need.requestedBy, r.need.projectName, r.need.rfqNumber, r.need.poNumber, r.category])), seg),
    [scoped, seg, search]
  )
  const acting = seg === "act" && canAct

  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  useEffect(() => setSelected(new Set()), [seg])
  const toggle = (needKey: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(needKey)) next.delete(needKey)
      else next.add(needKey)
      return next
    })
  const hint = acting ? mergeHint(visible, selected) : null
  const summary = useMemo(() => selectionSummary(scoped, selected, { agreements, policies, now }), [scoped, selected, agreements, policies, now])

  const [ordering, setOrdering] = useState<{ rows: NeedRow[]; mode: "agreement" | "direct" } | null>(null)
  const [proceeding, setProceeding] = useState<NeedRow[] | null>(null)
  const [asking, setAsking] = useState<NeedRow | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const siblings = (row: NeedRow) => scoped.filter((r) => r.needKey === row.needKey && r.open > 0)
  const rfqHref = (rows: NeedRow[]) => {
    const needs = Array.from(new Map(rows.map((r) => [r.needKey, r.need])).values())
    const items = rows.map((r) => ({ name: r.name, quantity: r.open, unit: r.unit }))
    const sources = needs.map((n) => needSourceParam(n.source))
    return `/contractor/rfqs/new?items=${encodeURIComponent(JSON.stringify(items))}&source=${encodeURIComponent(sources[0] || "")}${sources.length > 1 ? `&sources=${encodeURIComponent(sources.join("|"))}` : ""}`
  }

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
      seesPrices: procActor.seesPrices,
      onRfq: (r: NeedRow) => router.push(rfqHref(siblings(r))),
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
        <ProcChipGroup items={DESK_SEGMENTS.map((f) => ({ id: f, label: t(`nd_seg_${f}`), count: counts[f] }))} active={seg} onPick={(f) => setQuery({ seg: f, search: null })} label={t("pri_state")} dimmed={searching} />
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

      {hint && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-module/20 bg-module/5 px-4 py-3 text-sm">
          <Lightbulb size={15} className="shrink-0 text-module" aria-hidden="true" />
          <span className="min-w-0 flex-1" dir="auto">
            {t(hint.by === "category" ? "nd_merge_category" : "nd_merge_project", { count: hint.lines, label: hint.label })}
          </span>
          <Button size="sm" variant="outline" className="h-8 border-module/40 text-module" onClick={() => setSelected((prev) => new Set([...Array.from(prev), ...hint.needKeys]))}>
            {t("nd_select_them")}
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border bg-card">
        {loading ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <ShoppingCart size={36} className="mx-auto mb-2 opacity-20" aria-hidden="true" />
            <p className="text-sm">{searching ? t("so_search_none", { term: search.trim() }) : t("nd_empty")}</p>
            <p className="mt-1 text-xs">{t("pri_empty_hint_all")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  {acting && (
                    <th className="w-10 px-3 py-3">
                      <span className="sr-only">{t("nd_select")}</span>
                    </th>
                  )}
                  <th className="px-4 py-3 text-start font-semibold">{t("pri_col_material")}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t("pri_col_qty")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("nd_col_need")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{seg === "act" ? t("pri_col_route") : t("nd_col_where")}</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">{t("pri_col_actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((r) => {
                  const act = isActionState(r.state)
                  const ld = r.lastOrderIn
                  const PathIcon = r.path ? PATH_ICON[r.path] : null
                  const on = selected.has(r.needKey)
                  return (
                    <tr key={r.key} className={cn("cursor-pointer align-middle transition-colors hover:bg-muted/30", on && "bg-module/5")} onClick={() => setQuery({ line: r.key })}>
                      {acting && (
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!r.selectable}
                            onChange={() => toggle(r.needKey)}
                            aria-label={t("nd_select_line", { name: r.name })}
                            className="h-4 w-4 accent-module disabled:opacity-30"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <p className="font-bold text-foreground" dir="auto">
                          {r.name}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold">{t(`pri_from_${r.need.kind}`)}</span>
                          <span dir="auto">{r.need.refLabel}</span>
                          <span dir="auto">· {r.need.projectName || r.need.context || t("nd_for_stock")}</span>
                          {r.samplePending && <span className="font-semibold text-warning">· {t("nd_sample_pending")}</span>}
                          {r.need.returnedFrom && <span className="font-semibold text-cta">· {t("nd_returned_from", { po: r.need.returnedFrom })}</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <b className="tabular-nums" dir="ltr">
                          {fmtQty(act ? r.open : r.total)}
                        </b>{" "}
                        <span className="text-xs text-muted-foreground">{r.unit}</span>
                        {act && r.open < r.total && <p className="text-[11px] text-muted-foreground">{t("nd_of_total", { total: fmtQty(r.total) })}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{r.needBy ? fmtDay(r.needBy, locale) : "—"}</p>
                        {act && ld != null ? (
                          <p className={cn("flex items-center gap-1 text-[11px] font-semibold", ld < 0 ? "text-destructive" : ld <= 2 ? "text-warning" : "text-muted-foreground")}>
                            {ld < 0 && <AlertTriangle size={11} aria-hidden="true" />}
                            {ld < 0 ? t("nd_last_day_passed", { days: -ld }) : t("nd_order_by", { date: fmtDay(r.lastOrderDay, locale), days: ld })}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {act && r.state === "late" ? (
                          <StatusPill tone="warn">{t("nd_state_late")}</StatusPill>
                        ) : act && r.path && PathIcon ? (
                          <StatusPill tone={PATH_TONE[r.path]}>
                            <PathIcon size={12} aria-hidden="true" /> {t(`nd_path_${r.state === "mfgl" ? "rfq" : r.path}`)}
                          </StatusPill>
                        ) : (
                          <StatusPill tone={LINE_STATE_TONE[r.state]}>{t(`nd_state_${r.state}`)}</StatusPill>
                        )}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <span className="inline-flex h-8 items-center rounded-lg border px-3 text-xs font-bold">{act && acting ? t("nd_open") : t("nd_details")}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {acting && summary.lines > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3 shadow-lg" role="region" aria-label={t("nd_selection")}>
          <b className="text-sm">{t("nd_sel_lines", { count: summary.lines })}</b>
          <span className="text-xs text-muted-foreground">{summary.value != null && procActor.seesPrices ? t("nd_sel_value", { value: money(summary.value) }) : t("nd_sel_no_estimate")}</span>
          <span className="ms-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={() => setSelected(new Set())}>
              {t("nd_clear")}
            </Button>
            {canOrder && summary.agreement && (
              <Button size="sm" className="h-8 gap-1.5 bg-module text-module-foreground hover:bg-module/90" onClick={() => setOrdering({ rows: summary.rows, mode: "agreement" })}>
                <FileSignature size={13} aria-hidden="true" /> {t("dor_open_agreement")}
              </Button>
            )}
            {canOrder && summary.directOk && (
              <Button size="sm" className="h-8 gap-1.5 bg-module text-module-foreground hover:bg-module/90" onClick={() => setOrdering({ rows: summary.rows, mode: "direct" })}>
                <ShoppingCart size={13} aria-hidden="true" /> {t("dor_open_direct")}
              </Button>
            )}
            {canStartRfq && (
              <Button asChild size="sm" className="h-8 gap-1.5 bg-module text-module-foreground hover:bg-module/90">
                <Link href={rfqHref(summary.rows)}>
                  <Scale size={13} aria-hidden="true" /> {t("nd_combine_rfq")}
                </Link>
              </Button>
            )}
          </span>
        </div>
      )}

      {drawerRow && <NeedLineDrawer row={drawerRow} agreements={agreements} history={history} cap={policies.directPurchaseCap} today={today} acts={actsFor(drawerRow)} onClose={() => setQuery({ line: null })} />}

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
      {asking && asking.need.source.kind === "project_request" && (
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
