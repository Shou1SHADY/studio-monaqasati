"use client"

// The comparison tab of one RFQ (Procurement 2.0 CMP-01…06, 14, 15, 16, 18, RFQ-09, G-14): suppliers as columns up to five offers, as
// rows beyond (sticky supplier column) with a manual toggle; the big number of a cell is the effective price per request unit, ★ marks
// the lowest, the fact rows sit under it, «آخر شراء» under each material, the strip of the lowest per material above. Award by a cell or
// by a supplier; the bottom bar counts «اختير N من M». A pick is pinned to the offer VERSION: an offer edited, excluded or expired after
// the pick drops out with «عُدّل بعد اختيارك». The seal is gone: every price is shown the moment it arrives.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Columns3, FileCheck, Rows3, Scale, ShieldCheck, Star, TrendingDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { Chip } from "@/components/module-ui/Chip"
import { Panel } from "@/components/module-ui/Panel"
import { moneyFigure } from "@/components/procurement/PoModel"
import { useToast } from "@/hooks/use-toast"
import { buildCompareModel, experienceFrom, lowestPicksOfModel, type CompareColumn, type Experience } from "@/lib/procurement/compare-model"
import { dropStale, offerIsOut, pickAllOf, planAward, planSupplier, type AwardPicks, type Dropped, type PlanOffer, type PlanPolicies, type PlanRfq } from "@/lib/procurement/award-plan"
import type { DecisionMap } from "@/lib/procurement/offer-decisions"
import { supplierKey } from "@/lib/procurement/po"
import { locksOf } from "@/lib/procurement/rfq-server/award-locks"
import type { PriceHistoryEntry } from "@/lib/procurement/prices"
import type { PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"
import { cn } from "@/lib/utils"
import { CompareCell } from "./CompareCell"
import { FACT_IDS, FactCell } from "./CompareFacts"
import { LastBuy } from "./LastBuy"
import { awardSupplierOrgId } from "@/lib/procurement/award"
import { SupplierLink } from "../SupplierLink"
import { MaterialStrip } from "./MaterialStrip"

const sar = (h: number | null | undefined): string => moneyFigure(h == null ? null : h / 100)

export interface RfqCompareGridProps {
  rfq: PlanRfq
  offers: PlanOffer[]
  decisions: DecisionMap
  /** The company's orders and receipts: the locks (a line in a live order), our experience of each supplier. */
  orders: PurchaseOrder[]
  receipts: ReceiptFact[]
  history: PriceHistoryEntry[]
  policies: PlanPolicies
  /** Registered AND verified by his documents. */
  verifiedOf: (offer: PlanOffer) => boolean
  picks: AwardPicks
  onPicksChange: (next: AwardPicks) => void
  canPick: boolean
  showPrices: boolean
  /** `YYYY-MM-DD`, Riyadh. */
  today: string
  now?: Date
  actor: { uid: string; isOwner: boolean; canPrepare: boolean; canApprove: boolean }
  onReview: () => void
  onAskReval?: (offer: PlanOffer) => void
  /** «اختر الأقل لكل بند» asked outside the grid (the best cards): a new value picks the lowest per line, then `onLowestHandled`. */
  lowestRequest?: number | null
  onLowestHandled?: () => void
  /** Shown above the grid once an award was made (orders and the reason). */
  awardedBlock?: ReactNode
  /** The «لا عرض حيّاً» block and the like. */
  top?: ReactNode
  /** Wider notes of the page (kept by the host). */
  children?: ReactNode
}

export function RfqCompareGrid(props: RfqCompareGridProps) {
  const { rfq, offers, decisions, orders, receipts, history, policies, picks, onPicksChange, canPick, showPrices, today, actor } = props
  const t = useTranslations("Portal.Procurement.cmp2")
  const now = props.now ?? new Date()
  const [layoutMode, setLayoutMode] = useState<"auto" | "columns" | "rows">("auto")
  const { toast } = useToast()
  // «أخفِ المستبعدين» starts on once something is excluded (prototype `cmpF.hideOut`); the chip stays a toggle.
  const [hideChoice, setHideExcluded] = useState<boolean | null>(null)
  const [shortlistOnly, setShortlistOnly] = useState(false)
  const [termsOnly, setTermsOnly] = useState(false)
  const [sortLine, setSortLine] = useState<number | null>(null)
  const [dropped, setDropped] = useState<Dropped[]>([])

  const mine = useMemo(() => orders.filter((o) => o.rfqId === rfq.id), [orders, rfq.id])
  const locks = useMemo(() => locksOf(mine), [mine])
  const ctx = useMemo(() => ({ today, policies, decisions, locked: locks.locked, liveOfferIds: locks.liveOfferIds }), [today, policies, decisions, locks])

  const scores = useMemo(() => {
    const map = new Map<string, Experience>()
    const keys = new Set(orders.map((o) => supplierKey(o)))
    for (const key of keys) map.set(key, experienceFrom(orders.filter((o) => supplierKey(o) === key), receipts, now))
    return map
    // `now` only matters to the day; recomputing when the orders or receipts change is what keeps it honest.
  }, [orders, receipts])
  const experienceOf = useMemo(
    () => (o: PlanOffer): Experience | null => {
      const s = planSupplier(o)
      return scores.get(supplierKey({ supplierOrgId: s.supplierOrgId, supplierName: s.supplierName, isGuestSupplier: s.isGuestSupplier })) ?? null
    },
    [scores]
  )

  const anyExcluded = useMemo(() => offers.some((o) => offerIsOut(o, decisions[o.id])), [offers, decisions])
  const hideExcluded = hideChoice ?? anyExcluded
  const model = useMemo(
    () => buildCompareModel({ rfq, offers, ctx, picks, history, experienceOf, verifiedOf: props.verifiedOf, opts: { layout: layoutMode, hideExcluded, shortlistOnly, termsOnly, sortLine } }),
    [rfq, offers, ctx, picks, history, experienceOf, props.verifiedOf, layoutMode, hideExcluded, shortlistOnly, termsOnly, sortLine]
  )
  const byId = useMemo(() => new Map(offers.map((o) => [o.id, o])), [offers])

  // G-14: a pick whose offer changed, was excluded or expired since is dropped, and the buyer is told.
  useEffect(() => {
    const r = dropStale(picks, offers, model.ev, ctx)
    if (r.dropped.length) {
      setDropped(r.dropped)
      onPicksChange(r.picks)
    }
    // Only when the world moves under the picks; the picks themselves change by the buyer's own clicks.
  }, [offers, decisions, mine])

  const names = (list: Dropped[]) => [...new Set(list.map((d) => model.columns.find((c) => c.offer.id === d.offerId)?.name || byId.get(d.offerId)?.companyName || "—"))]

  const plan = useMemo(() => planAward({ rfq, offers, picks: Object.entries(picks).map(([li, p]) => ({ li: Number(li), offerId: p.offerId, rev: p.rev })) }, { ...ctx, actor, onTimeOf: (o) => experienceOf(o)?.onTimePercent ?? null, hasRecord: (o) => (experienceOf(o)?.orders ?? 0) > 0 }), [rfq, offers, picks, ctx, actor, experienceOf])
  const open = model.rows.filter((r) => !locks.locked[r.li]).length
  const interactive = canPick && showPrices

  const togglePick = (li: number, col: CompareColumn) => {
    const cur = picks[li]
    // «للطلب كاملاً فقط»: one cell takes every line he priced (or none) — the review would refuse a part of it anyway.
    if (col.facts.whole) {
      if (cur && cur.offerId === col.offer.id) {
        onPicksChange(Object.fromEntries(Object.entries(picks).filter(([, p]) => p.offerId !== col.offer.id)))
        return
      }
      onPicksChange(pickAllOf(model.ev, col.offer, ctx, picks))
      toast({ title: t("whole_picked", { name: col.name || "—" }) })
      return
    }
    const next = { ...picks }
    if (cur && cur.offerId === col.offer.id) delete next[li]
    else next[li] = { offerId: col.offer.id, rev: col.rev }
    onPicksChange(next)
  }
  const pickLowest = (safe: boolean) => onPicksChange(lowestPicksOfModel(model, byId, safe ? { safeOnly: (o) => props.verifiedOf(o) && Boolean((o.offerPdfUrl || "").trim()) && !planSupplier(o).isGuestSupplier } : {}))
  const pickSupplier = (col: CompareColumn) => onPicksChange(pickAllOf(model.ev, col.offer, ctx, picks))

  // The best cards' «اختر الأقل لكل بند» (prototype `cmp-best` with `go`): the picks are made here, where the model is.
  const lowestRequest = props.lowestRequest ?? null
  useEffect(() => {
    if (lowestRequest == null) return
    if (interactive) pickLowest(false)
    props.onLowestHandled?.()
    // Only a new request picks; the model moving under it must not re-pick over the buyer's own clicks.
  }, [lowestRequest])

  if (!model.columns.length && !offers.length) {
    return (
      <Panel title={t("heading")} icon={Scale}>
        <p className="text-sm font-semibold">{t("none")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("none_hint")}</p>
      </Panel>
    )
  }

  const rowsLayout = model.layout === "rows"
  const chosenSuppliers = [...new Set(plan.groups.map((g) => model.columns.find((c) => c.offer.id === g.offerId)?.name || "—"))]

  return (
    <div className="space-y-4">
      {props.top}
      {props.awardedBlock}
      {dropped.length > 0 && (
        <Callout tone="warn">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("dropped", { names: names(dropped).join("، ") })}</span>
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setDropped([])}>
              {t("understood")}
            </Button>
          </span>
        </Callout>
      )}

      <MaterialStrip strip={model.strip} columns={model.columns} sortLine={sortLine} onSort={setSortLine} showPrices={showPrices} />

      <Panel
        title={t("heading")}
        icon={Scale}
        bodyClassName="p-0"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {interactive && !model.lumpOnly && (
              <>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => pickLowest(false)}>
                  <TrendingDown size={13} aria-hidden="true" />
                  {t("pick_lowest")}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => pickLowest(true)}>
                  <Star size={13} aria-hidden="true" />
                  {t("pick_lowest_safe")}
                </Button>
              </>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <Chip selected={hideExcluded} onClick={() => setHideExcluded(!hideExcluded)} count={model.columns.length ? undefined : 0}>
            {t("hide_excluded", { count: hideExcluded ? model.hiddenExcluded : offers.filter((o) => model.ev.byId[o.id] && !model.ev.byId[o.id].live).length })}
          </Chip>
          <Chip selected={shortlistOnly} onClick={() => setShortlistOnly((v) => !v)}>
            {t("shortlist_only", { count: model.shortlistCount })}
          </Chip>
          <Chip selected={termsOnly} onClick={() => setTermsOnly((v) => !v)}>
            {t("terms_only")}
          </Chip>
          <span className="ms-auto inline-flex items-center gap-1">
            <Chip selected={model.layout === "columns"} icon={Columns3} onClick={() => setLayoutMode("columns")}>
              {t("suppliers_columns")}
            </Chip>
            <Chip selected={model.layout === "rows"} icon={Rows3} onClick={() => setLayoutMode("rows")}>
              {t("suppliers_rows")}
            </Chip>
          </span>
        </div>
        <p className="px-4 pt-2 text-[11px] text-muted-foreground">{t("caption", { count: model.columns.length, tie: model.ev.tiePercent })}</p>
        {model.hasPieces && <p className="mx-4 mt-2 rounded-lg bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">{t("piece_note")}</p>}

        <div className="overflow-x-auto p-2">
          {!rowsLayout ? (
            <table className="w-full min-w-max text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th scope="col" className="sticky start-0 z-10 bg-muted px-3 py-2.5 text-start align-bottom font-bold">
                    {t("line")}
                  </th>
                  {model.columns.map((c) => (
                    <th key={c.offer.id} scope="col" className={cn("max-w-[14rem] px-3 py-2.5 text-start align-top font-normal", c.excluded && "opacity-60")}>
                      <SupplierHead col={c} />
                      {interactive && !c.excluded && (
                        <button type="button" onClick={() => pickSupplier(c)} className="mt-1 text-[11px] font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {t("award_all_of", { name: c.name })}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.rows.map((r) => (
                  <tr key={r.li} className="border-t align-top">
                    <th scope="row" className="sticky start-0 z-10 bg-card px-3 py-2 text-start font-semibold">
                      <span className="block max-w-[14rem] truncate" dir="auto" title={r.name}>
                        {r.name || "—"}
                      </span>
                      <span className="block text-[11px] font-normal text-muted-foreground" dir="auto">
                        <bdi dir="ltr">{r.qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}</bdi> {r.unit}
                      </span>
                      <WarrantyAsked months={r.warrantyAsked} />
                      {showPrices && <LastBuy entry={r.lastBuy} />}
                    </th>
                    {model.columns.map((c) => (
                      <td key={c.offer.id} className="px-2 py-1.5">
                        <CompareCell
                          cell={r.cells[c.offer.id]}
                          unit={r.unit}
                          lineName={r.name}
                          supplier={c.name}
                          showPrices={showPrices}
                          interactive={interactive}
                          excluded={c.excluded}
                          onPick={() => togglePick(r.li, c)}
                          onAskReval={props.onAskReval ? () => props.onAskReval?.(c.offer) : undefined}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                {FACT_IDS.map((id) => (
                  <tr key={id} className="border-t bg-muted/20 align-top">
                    <th scope="row" className="sticky start-0 z-10 bg-muted px-3 py-2 text-start text-xs font-bold">
                      {t(`fact_${id}`)}
                    </th>
                    {model.columns.map((c) => (
                      <td key={c.offer.id} className="px-3 py-2 text-xs">
                        <FactCell id={id} col={c} showPrices={showPrices} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-max text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th scope="col" className="sticky start-0 z-10 bg-muted px-3 py-2.5 text-start align-bottom font-bold">
                    {t("supplier")}
                  </th>
                  {model.rows.map((r) => (
                    <th key={r.li} scope="col" className="px-3 py-2.5 text-start align-top font-semibold">
                      <span className="block max-w-[12rem] truncate" dir="auto">
                        {r.name || "—"}
                      </span>
                      <WarrantyAsked months={r.warrantyAsked} />
                      {showPrices && <LastBuy entry={r.lastBuy} />}
                    </th>
                  ))}
                  {FACT_IDS.map((id) => (
                    <th key={id} scope="col" className="px-3 py-2.5 text-start align-top text-xs font-bold">
                      {t(`fact_${id}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.columns.map((c) => (
                  <tr key={c.offer.id} className={cn("border-t align-top", c.excluded && "opacity-60")}>
                    <th scope="row" className="sticky start-0 z-10 bg-card px-3 py-2 text-start font-normal">
                      <SupplierHead col={c} />
                      {interactive && !c.excluded && (
                        <button type="button" onClick={() => pickSupplier(c)} className="mt-1 text-[11px] font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {t("award_all_of", { name: c.name })}
                        </button>
                      )}
                    </th>
                    {model.rows.map((r) => (
                      <td key={r.li} className="px-2 py-1.5">
                        <CompareCell
                          cell={r.cells[c.offer.id]}
                          unit={r.unit}
                          lineName={r.name}
                          supplier={c.name}
                          showPrices={showPrices}
                          interactive={interactive}
                          excluded={c.excluded}
                          onPick={() => togglePick(r.li, c)}
                          onAskReval={props.onAskReval ? () => props.onAskReval?.(c.offer) : undefined}
                        />
                      </td>
                    ))}
                    {FACT_IDS.map((id) => (
                      <td key={id} className="px-3 py-2 text-xs">
                        <FactCell id={id} col={c} showPrices={showPrices} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {canPick && (
          <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {t("chosen_n_of_m", { n: plan.clean.length, m: open })}
              {plan.clean.length > 0 && showPrices && (
                <>
                  {" · "}
                  {chosenSuppliers.join("، ")}
                  {" · "}
                  <b className="text-foreground" dir="ltr">
                    {sar(plan.grossH)}
                  </b>{" "}
                  {t("incl_vat")}
                </>
              )}
            </span>
            <span className="ms-auto flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!plan.clean.length} onClick={() => onPicksChange({})}>
                {t("clear")}
              </Button>
              <Button type="button" size="sm" className="gap-2 bg-module text-white hover:bg-module/90" disabled={!plan.clean.length || !showPrices} onClick={props.onReview}>
                <FileCheck size={14} aria-hidden="true" />
                {t("review")}
              </Button>
            </span>
          </div>
        )}
      </Panel>
      {props.children}
    </div>
  )
}

/** «ضمان 24 شهراً» under a material that asks one (prototype material header). */
function WarrantyAsked({ months }: { months: number | null }) {
  const t = useTranslations("Portal.Procurement.cmp2")
  if (months == null) return null
  return (
    <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
      <ShieldCheck size={11} aria-hidden="true" />
      {t("warranty_asked", { months })}
    </span>
  )
}

function SupplierHead({ col }: { col: CompareColumn }) {
  const t = useTranslations("Portal.Procurement.cmp2")
  return (
    <>
      <span className="block truncate font-bold text-foreground" dir="auto" title={col.name}>
        {col.shortlisted && <Star size={11} className="me-1 inline text-warning" aria-label={t("shortlisted")} />}
        {/* SP-03: the supplier's name opens his file over the comparison. */}
        <SupplierLink orgId={col.facts.guest ? null : awardSupplierOrgId(col.offer as never)} name={col.name} />
      </span>
      {col.shortlisted && <small className="block text-warning">{t("shortlist_short")}</small>}
      {col.facts.guest && <small className="block text-violet">{t("off_platform")}</small>}
      {col.excluded && <small className="block font-bold text-destructive">{t("excluded")}</small>}
      {col.taken && <small className="block font-bold text-success">{t("awarded_to")}</small>}
      {col.facts.whole && <small className="block text-muted-foreground">{t("whole_only")}</small>}
      {col.facts.unregistered && <small className="block text-muted-foreground">{t("unregistered")}</small>}
      {col.rev > 1 && <small className="block text-muted-foreground">{t("version", { n: col.rev })}</small>}
    </>
  )
}
