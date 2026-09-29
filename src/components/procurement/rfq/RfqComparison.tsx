"use client"

// The comparison tab of one RFQ (R-01, R-02, R-07): a line × supplier matrix.
// Each column head says what the price stands on — guest or registered, an
// official quote attached or not, delivered or ex-works, who keyed it in, lead
// time and terms. A cell is the supplier's rate for that line and its line
// total; clicking it picks that supplier for that line (whole-request pricing:
// clicking a supplier's total picks the lot). The bar below counts what is
// picked and opens the award. Under it, the notes a buyer should read first.
// A viewer who does not see prices (an expediter) sees «—» and cannot pick.

import { useLocale, useTranslations } from "next-intl"
import { ArrowDown, FileCheck, Lock, Scale, TrendingDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { Money } from "@/components/procurement/PoBits"
import { competingOffers } from "@/lib/procurement/award"
import { pricedProducts } from "@/lib/procurement/offer-pricing"
import { awardMode, awardSummary, bestPerLine, offerTotal, pickLowest, ratesByOffer, toggleWhole, togglePick, type Picks } from "@/lib/procurement/rfq-award"
import type { RfqNote } from "@/lib/procurement/rfq-notes"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"
import { moneyFigure } from "@/components/procurement/PoModel"
import { lineForKey, supplierNameOf, termsOf, type RfqOfferView, type RfqView } from "./rfqOfferView"

const NOTE_TONE = { bad: "block", warn: "warn", info: "info" } as const
/** The prototype shows the six notes that matter most — the list is ordered by weight. */
const MAX_NOTES = 6

export function leadDaysOf(o: Pick<RfqOfferView, "executionDuration" | "executionDurationUnit">): number | null {
  const n = parseInt(String(o.executionDuration ?? ""), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const u = o.executionDurationUnit || ""
  return n * (u === "أشهر" ? 30 : u === "أسابيع" ? 7 : 1)
}

/** «for (project)» under a line: its own project, the RFQ's, the workshop, or general stock. */
export function useLineFor(rfq: RfqView, projectName: string | null) {
  const tp = useTranslations("Portal.Procurement")
  return (index: number): string => {
    const f = lineForKey(rfq, index)
    if (f.kind === "workshop") return tp("rfqpo.list.workshop")
    if (f.kind === "general") return tp("rfqx.details.for_general")
    return f.name || (f.id === rfq.projectId ? projectName : null) || tp("rfqpo.list.project_unknown")
  }
}

export function useTermsText() {
  const t = useTranslations("Portal.Procurement.rfqd")
  return (o: RfqOfferView): string | null => {
    const terms = termsOf(o)
    if (!terms) return null
    if (terms.key === "advance") return t("terms.advance", { percent: terms.percent, days: terms.days })
    if (terms.key === "credit") return t("terms.credit", { days: terms.days })
    if (terms.key === "cash") return t("terms.cash")
    return terms.text
  }
}

export function RfqComparison({
  rfq,
  offers,
  picks,
  onPicksChange,
  canPick,
  showPrices,
  sealed,
  sealedUntil,
  notes,
  onAward,
  canCloseEarly,
  onCloseEarly,
  round,
  onAskRound,
  projectName,
}: {
  rfq: RfqView
  offers: RfqOfferView[]
  picks: Picks
  onPicksChange: (next: Picks) => void
  canPick: boolean
  showPrices: boolean
  sealed: boolean
  sealedUntil: string
  notes: RfqNote[]
  onAward: () => void
  canCloseEarly: boolean
  onCloseEarly: () => void
  /** The one reduction round: may be asked, was asked, or neither applies. */
  round: "can" | "done" | "none"
  onAskRound: () => void
  /** The RFQ's own project, for a line that names none. */
  projectName?: string | null
}) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const tx = useTranslations("Portal.Procurement.rfqx")
  const tc = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const termsText = useTermsText()
  const forText = useLineFor(rfq, projectName ?? null)
  const live = competingOffers(offers)
  const name = (o: RfqOfferView) => supplierNameOf(o, tc("offers_registered_supplier"))

  if (sealed) {
    return (
      <div className="space-y-3">
        <Callout tone="warn">{t("cmp.sealed", { date: sealedUntil, count: live.length })}</Callout>
        {canCloseEarly && live.length > 0 && (
          <Button variant="outline" size="sm" className="gap-2" onClick={onCloseEarly}>
            <Lock size={14} aria-hidden="true" />
            {t("cmp.close_now")}
          </Button>
        )}
      </div>
    )
  }
  if (!live.length) {
    return (
      <Panel title={t("cmp.heading")} icon={Scale}>
        <p className="text-sm text-muted-foreground">{t("cmp.none")}</p>
      </Panel>
    )
  }

  const mode = awardMode(rfq)
  const products = pricedProducts(rfq)
  const rates = ratesByOffer(rfq, live)
  const best = bestPerLine(rfq, live)
  const summary = awardSummary(rfq, live, picks)
  const totals = live.map((o) => offerTotal(o))
  const liveTotals = totals.filter((n): n is number => n != null)
  const minTotal = liveTotals.length ? Math.min(...liveTotals) : null
  const interactive = canPick && showPrices
  const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 })

  const basisText = (o: RfqOfferView) => (o.priceBasis === "exw" ? t("cmp.basis_exw") : o.priceBasis === "site" ? t("cmp.basis_site") : t("cmp.basis_none"))

  return (
    <div className="space-y-4">
      <Panel
        title={mode === "whole" ? t("cmp.title_whole") : t("cmp.title_lines")}
        icon={Scale}
        actions={
          interactive && mode === "lines" ? (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onPicksChange(pickLowest(rfq, live))}>
              <TrendingDown size={13} aria-hidden="true" />
              {t("cmp.pick_lowest")}
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th scope="col" className="sticky start-0 z-10 bg-muted px-3 py-2.5 text-start align-bottom font-bold">
                  {t("cmp.line")}
                </th>
                {live.map((o) => {
                  const lead = leadDaysOf(o)
                  const terms = termsText(o)
                  return (
                    <th key={o.id} scope="col" className="max-w-[14rem] px-3 py-2.5 text-start align-top font-normal">
                      <span className="block truncate font-bold text-foreground" dir="auto" title={name(o)}>
                        {name(o)}
                      </span>
                      {o.isGuestOffer && <small className="block text-violet">{t("cmp.guest")}</small>}
                      <small className={cn("block", o.offerPdfUrl ? "text-success" : "text-warning")}>{o.offerPdfUrl ? t("cmp.quote_attached") : t("cmp.no_quote")}</small>
                      <small className="block text-muted-foreground">
                        {basisText(o)}
                        {o.isManualOffer && (
                          <span className="text-warning">
                            {" · "}
                            {t("cmp.keyed_by", { name: o.recordedByName || "—" })}
                            {o.recordedEarly && ` · ${tx("cmp.before_close")}`}
                            {!o.offerPdfUrl && !o.manualProofUrl && ` · ${t("cmp.no_attachment")}`}
                          </span>
                        )}
                      </small>
                      <small className="block text-muted-foreground">
                        {lead != null ? t("cmp.lead_days", { days: lead }) : t("cmp.lead_none")}
                        {terms && ` · ${terms}`}
                      </small>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.rfqProductIndex} className="border-t">
                  <th scope="row" className="sticky start-0 z-10 bg-card px-3 py-2 text-start align-top font-semibold">
                    <span className="block max-w-[14rem] truncate" dir="auto" title={p.name}>
                      {p.name || "—"}
                    </span>
                    <span className="block max-w-[14rem] truncate text-[11px] font-normal text-muted-foreground" dir="auto">
                      <bdi dir="ltr">{qty(p.quantity)}</bdi> {p.unit} · {forText(p.rfqProductIndex)}
                    </span>
                  </th>
                  {live.map((o) => {
                    const rate = rates.get(o.id)?.get(p.rfqProductIndex)
                    if (rate == null) {
                      return (
                        <td key={o.id} className="px-3 py-2 align-top text-muted-foreground">
                          —
                        </td>
                      )
                    }
                    const picked = picks[p.rfqProductIndex] === o.id
                    const lowest = best[p.rfqProductIndex]?.offerId === o.id && live.length > 1
                    const clickable = interactive && mode === "lines"
                    return (
                      <td key={o.id} className="px-2 py-1.5 align-top">
                        <button
                          type="button"
                          disabled={!clickable}
                          aria-pressed={picked}
                          aria-label={t("cmp.cell_pick_label", { line: p.name, supplier: name(o) })}
                          onClick={() => onPicksChange(togglePick(picks, p.rfqProductIndex, o.id))}
                          className={cn(
                            "flex w-full min-w-[8rem] flex-col items-start rounded-lg border px-2.5 py-1.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            picked ? "border-module bg-module/10 ring-1 ring-module" : lowest ? "border-success/40 bg-success/5" : "border-transparent",
                            clickable ? "hover:border-module/50 hover:bg-muted/50" : "cursor-default"
                          )}
                        >
                          <Money value={rate} masked={!showPrices} className={cn("font-bold", lowest && "text-success", picked && "text-module")} />
                          <Money value={rate * p.quantity} masked={!showPrices} className="text-[11px] text-muted-foreground" />
                          {showPrices && (o.priceHistory || []).length > 0 && <span className="text-[10px] text-success">{t("cmp.after_reduction")}</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/30">
                <th scope="row" className="sticky start-0 z-10 bg-muted px-3 py-2.5 text-start text-xs font-bold">
                  {mode === "whole" ? t("cmp.total_whole") : t("cmp.total_lines")}
                </th>
                {live.map((o, k) => {
                  const total = totals[k]
                  if (mode === "whole") {
                    const indexes = products.length ? products.map((p) => p.rfqProductIndex) : [0]
                    const picked = indexes.every((i) => picks[i] === o.id)
                    const lowest = total != null && total === minTotal && live.length > 1
                    return (
                      <td key={o.id} className="px-2 py-1.5">
                        <button
                          type="button"
                          disabled={!interactive}
                          aria-pressed={picked}
                          aria-label={t("cmp.whole_pick_label", { supplier: name(o) })}
                          onClick={() => onPicksChange(toggleWhole(rfq, picks, o.id))}
                          className={cn(
                            "flex w-full min-w-[8rem] flex-col items-start rounded-lg border px-2.5 py-1.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            picked ? "border-module bg-module/10 ring-1 ring-module" : lowest ? "border-success/40 bg-success/5" : "border-transparent",
                            interactive ? "hover:border-module/50 hover:bg-muted/50" : "cursor-default"
                          )}
                        >
                          <Money value={total} masked={!showPrices || total == null} className={cn("font-black", lowest && "text-success", picked && "text-module")} />
                          <span className="text-[11px] text-muted-foreground">{t("cmp.whole_request")}</span>
                        </button>
                      </td>
                    )
                  }
                  const complete = products.every((p) => rates.get(o.id)?.has(p.rfqProductIndex))
                  return (
                    <td key={o.id} className="px-3 py-2.5 font-black">
                      {complete ? <Money value={total} masked={!showPrices} /> : <span className="text-xs font-semibold text-muted-foreground">{t("cmp.partial")}</span>}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
        {canPick && (
          <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {t("cmp.awarded_n_of_m", { picked: summary.picked, of: summary.of })}
              {summary.picked > 0 && showPrices && (
                <>
                  {" · "}
                  <b className="text-foreground" dir="ltr">
                    {sarLtr(moneyFigure(summary.total))}
                  </b>
                </>
              )}
            </span>
            <Button size="sm" className="ms-auto gap-2 bg-module text-white hover:bg-module/90" disabled={summary.groups.length === 0 || !showPrices} onClick={onAward}>
              <FileCheck size={14} aria-hidden="true" />
              {t("cmp.award_btn")}
            </Button>
          </div>
        )}
      </Panel>

      {notes.length > 0 && (
        <div className="space-y-2" aria-label={t("cmp.notes_label")}>
          {notes.slice(0, MAX_NOTES).map((n, i) => (
            <Callout key={`${n.code}-${i}`} tone={NOTE_TONE[n.tone]}>
              {t(`note.${n.code}`, noteParams(n, locale))}
            </Callout>
          ))}
        </div>
      )}

      {round === "can" && (
        <Button variant="outline" size="sm" className="gap-2" onClick={onAskRound}>
          <ArrowDown size={14} aria-hidden="true" />
          {t("round.button")}
        </Button>
      )}
      {round === "done" && <p className="text-xs text-muted-foreground">{t("round.asked")}</p>}
    </div>
  )
}

function noteParams(n: RfqNote, locale: string): Record<string, string | number> {
  const p: Record<string, string | number> = { ...n.params }
  for (const k of ["best", "last", "threshold"]) if (typeof p[k] === "number") p[k] = sarLtr(moneyFigure(p[k] as number))
  for (const k of ["date", "need"]) {
    if (typeof p[k] === "string" && p[k]) {
      const d = new Date(`${p[k]}T00:00:00`)
      if (!Number.isNaN(d.getTime())) p[k] = d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { year: "numeric", month: "short", day: "numeric" })
    }
  }
  return p
}
