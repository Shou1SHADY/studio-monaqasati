"use client"

// «أفضل ما وصل» (RFQ-04, CMP-14): the lowest complete offer, the fastest, what a split award would save and cost, and how
// thin the competition is on the weakest line. Every figure comes from `bestCards` (offer-calc) — the same numbers the rows
// and the header carry (G-03).

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Gauge, Scale, Split, Timer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Money } from "@/components/procurement/PoBits"
import { fromHalalas } from "@/lib/procurement/offer-calc"
import type { BestCards, OfferRowModel } from "@/lib/procurement/rfq-offers-view"
import { cn } from "@/lib/utils"

function Card({ icon: Icon, title, tone, children }: { icon: typeof Scale; title: string; tone: string; children: ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-1 rounded-xl border p-3", tone)}>
      <h3 className="flex items-center gap-1.5 text-xs font-black">
        <Icon size={14} aria-hidden="true" />
        {title}
      </h3>
      {children}
    </section>
  )
}

function SupplierChip({ row, fallback }: { row: OfferRowModel; fallback: string }) {
  const name = row.name || fallback
  return (
    <p className="flex items-center gap-2 text-xs font-semibold">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-current/10 text-[11px] font-black" aria-hidden="true">
        {name.trim().charAt(0).toUpperCase()}
      </span>
      <span className="truncate" dir="auto">
        {name}
      </span>
    </p>
  )
}

export function RfqBestCards({ cards, showPrices, fallbackName, canSplit, onSplit }: { cards: BestCards; showPrices: boolean; fallbackName: string; canSplit: boolean; onSplit: () => void }) {
  const t = useTranslations("Portal.Procurement.rfqpage.best")
  if (cards.noLive) return null
  const amount = (h: number | null) => (showPrices && h != null ? <Money value={fromHalalas(h)} className="text-lg font-black" /> : <span className="text-lg font-black">—</span>)
  const { lowest, fastest, split, competition } = cards
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="rfq-best-cards">
      <Card icon={Scale} title={t("lowest")} tone="border-success/30 bg-success/5 text-success">
        {lowest ? (
          <>
            <SupplierChip row={lowest} fallback={fallbackName} />
            {amount(lowest.grossH)}
            <p className="text-[11px] font-semibold opacity-80">{lowest.ev.vatRate > 0 ? t("incl_all") : t("no_vat_all")}</p>
          </>
        ) : (
          <>
            <span className="text-lg font-black">—</span>
            <p className="text-[11px] font-semibold opacity-80">{t("lowest_none")}</p>
          </>
        )}
      </Card>

      <Card icon={Timer} title={t("fastest")} tone="border-cta/30 bg-cta/5 text-cta">
        {fastest ? (
          <>
            <SupplierChip row={fastest.row} fallback={fallbackName} />
            <span className="text-lg font-black">{t("days", { count: fastest.row.leadDays ?? 0 })}</span>
            <p className="text-[11px] font-semibold opacity-80">
              {showPrices && fastest.row.grossH != null ? <Money value={fromHalalas(fastest.row.grossH)} /> : null}
              {fastest.partial ? ` · ${t("partial")}` : ""}
            </p>
          </>
        ) : (
          <span className="text-lg font-black">—</span>
        )}
      </Card>

      {split && (
        <Card icon={Split} title={t("split")} tone="border-role-approver/30 bg-role-approver-light text-role-approver-ink">
          {amount(split.mix.grossH)}
          <p className="text-[11px] font-semibold">
            {t("split_sub", { count: split.mix.suppliers })}
            {showPrices && split.mix.worthSaying && split.mix.savingH != null ? ` · ${t("split_saving", { amount: fromHalalas(split.mix.savingH).toLocaleString("en-US", { maximumFractionDigits: 2 }), pct: split.mix.savingPct ?? 0 })}` : ""}
          </p>
          <p className="text-[11px] opacity-80">
            {t("split_cost", { orders: split.orders, shipments: split.shipments })}
            {split.newSupplier ? ` · ${t("split_new")}` : ""}
          </p>
          {canSplit && (
            <Button type="button" size="sm" variant="outline" className="mt-1 self-start" onClick={onSplit}>
              {t("pick_lowest")}
            </Button>
          )}
        </Card>
      )}

      {competition && (
        <Card icon={Gauge} title={t("competition")} tone="border-warning/30 bg-warning/5 text-warning">
          <span className="text-lg font-black" dir="ltr">
            {competition.live} / {competition.limit}
          </span>
          <p className="text-[11px] font-semibold">{t("competition_sub")}</p>
        </Card>
      )}
    </div>
  )
}
