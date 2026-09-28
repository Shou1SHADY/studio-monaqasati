"use client"

// The RFQs as a list (the reference prototype's list view): the RFQ with its
// number, city, products and author under it; the project (or general stock /
// the workshop); the offers — or a direct award's supplier — with the
// unanswered queries; the deadline with "n left"; the estimate at the last
// price we paid ("no estimate" when a line has no history; money holders
// only); the stage. A selection column carries the bulk actions.

import { useLocale, useTranslations } from "next-intl"
import { LayoutGrid } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { DeadlineText, OffersTag, RfqStagePill, type RfqRow } from "@/components/procurement/RfqCard"
import { useRfqInquiryCounts } from "@/hooks/useRfqInquiryCounts"
import { displayCity } from "@/lib/constants"
import { displayDocNumber } from "@/lib/procurement/format"
import { productCount, rfqStage } from "@/lib/procurement/rfq-view"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

export interface RfqTableRow {
  rfq: RfqRow
  projectLabel: string
  sealed: boolean
  estimate: number | null
  directSupplier: string | null
}

function OffersCell({ row, onGlance }: { row: RfqTableRow; onGlance: () => void }) {
  const tp = useTranslations("Portal.Procurement")
  const q = useRfqInquiryCounts(row.rfq.status === "Draft" ? null : row.rfq.id)
  return (
    <>
      <button type="button" onClick={onGlance} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <OffersTag rfq={row.rfq} sealed={row.sealed} directSupplier={row.directSupplier} />
      </button>
      {q.unanswered > 0 && <p className="mt-1 text-[11px] text-warning">{tp("rfqpo.list.unanswered", { count: q.unanswered })}</p>}
    </>
  )
}

export function RfqTable({
  rows,
  now,
  seesPrices,
  selected,
  onToggle,
  onToggleAll,
  onGlance,
}: {
  rows: RfqTableRow[]
  now: Date
  seesPrices: boolean
  selected: string[]
  onToggle: (id: string) => void
  onToggleAll: () => void
  onGlance: (rfq: RfqRow) => void
}) {
  const t = useTranslations("Portal.Contractor")
  const tp = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const all = rows.length > 0 && selected.length === rows.length

  return (
    <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="border-b text-xs font-semibold text-muted-foreground">
          <tr>
            <th className="w-10 px-3 py-3">
              <Checkbox checked={all ? true : selected.length ? "indeterminate" : false} onCheckedChange={onToggleAll} aria-label={t("rfq_select_all")} />
            </th>
            <th className="px-3 py-3 text-start">{t("rfqv_col_rfq")}</th>
            <th className="px-3 py-3 text-start">{t("rfqv_col_project")}</th>
            <th className="px-3 py-3 text-start">{t("rfqv_col_offers")}</th>
            <th className="px-3 py-3 text-start">{t("rfqv_col_deadline")}</th>
            {seesPrices && <th className="px-3 py-3 text-end">{t("rfqv_col_estimate")}</th>}
            <th className="px-3 py-3 text-start">{t("rfqv_col_status")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const { rfq, projectLabel, sealed, estimate } = row
            const stage = rfqStage(rfq, now)
            const isSelected = selected.includes(rfq.id)
            const meta = [
              rfq.rfqNumber ? displayDocNumber(rfq.rfqNumber, locale) : `#${rfq.id.slice(0, 6)}`,
              rfq.city ? `${displayCity(rfq.city, locale)}${rfq.district ? ` — ${displayCity(rfq.district, locale)}` : ""}` : null,
              t("rfqv_products", { count: productCount(rfq) }),
              rfq.createdByUserName || null,
            ].filter(Boolean)
            return (
              <tr key={rfq.id} className={cn("hover:bg-muted/30", isSelected && "bg-module/5")}>
                <td className="px-3 py-3">
                  <Checkbox checked={isSelected} onCheckedChange={() => onToggle(rfq.id)} aria-label={rfq.title} />
                </td>
                <td className="max-w-[360px] px-3 py-3">
                  <button type="button" onClick={() => onGlance(rfq)} className="block max-w-full truncate rounded-sm text-start font-bold text-foreground hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                    {rfq.title}
                  </button>
                  <span className="block truncate text-[11px] text-muted-foreground">{meta.join(" · ")}</span>
                </td>
                <td className="px-3 py-3">
                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-cta/20 bg-cta/5 px-2 py-0.5 text-[11px] font-semibold text-cta">
                    <LayoutGrid size={12} aria-hidden="true" />
                    {projectLabel}
                  </span>
                </td>
                <td className="px-3 py-3">{stage === "draft" ? <span className="text-xs text-muted-foreground">—</span> : <OffersCell row={row} onGlance={() => onGlance(rfq)} />}</td>
                <td className="whitespace-nowrap px-3 py-3 text-xs">{rfq.directAward ? "—" : <DeadlineText rfq={rfq} now={now} />}</td>
                {seesPrices && (
                  <td className="whitespace-nowrap px-3 py-3 text-end tabular-nums" dir="ltr">
                    {estimate !== null ? sarLtr(Math.round(estimate).toLocaleString("en-US")) : <span className="text-xs text-muted-foreground">{tp("rfqpo.list.no_estimate")}</span>}
                  </td>
                )}
                <td className="px-3 py-3">
                  <RfqStagePill stage={stage} sealed={sealed} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
