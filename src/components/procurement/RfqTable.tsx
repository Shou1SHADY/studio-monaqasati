"use client"

// The RFQs as rows (the reference prototype's rows view): the RFQ with its number and name, the materials and where they go, who it
// reaches, the offers with the unanswered inquiries and the lowest complete offer, when it closes, its state, and the one thing to do
// next. On a phone each row becomes a card (the shared table does it), so nothing scrolls sideways.

import { useTranslations } from "next-intl"
import { Link2 } from "lucide-react"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { IconButton } from "@/components/module-ui/IconButton"
import { Link, useRouter } from "@/i18n/routing"
import { ClosesText, LowestOffer, OffersPill, ReachTag, RfqNumber, RfqPrimaryAction, RfqStagePill, SitesTag, UnansweredTag, type RfqCardRow } from "@/components/procurement/RfqCard"
import { useRfqInquiryCounts } from "@/hooks/useRfqInquiryCounts"
import { productCount } from "@/lib/procurement/rfq-view"
import { cn } from "@/lib/utils"

function OffersCell({ row, seesPrices, onGlance }: { row: RfqCardRow; seesPrices: boolean; onGlance: () => void }) {
  const q = useRfqInquiryCounts(row.state === "draft" ? null : row.id)
  if (row.state === "draft") return <span className="text-xs text-muted-foreground">—</span>
  const showLowest = seesPrices && row.lowest && (row.state === "open" || row.state === "compare") && !row.noLive
  return (
    <span className="flex flex-col items-start gap-1">
      <OffersPill row={row} onGlance={onGlance} />
      {showLowest && (
        <span className="text-[11px] text-muted-foreground">
          <LowestOffer row={row} />
        </span>
      )}
      <UnansweredTag rfqId={row.id} count={q.unanswered} />
    </span>
  )
}

export function RfqTable({
  rows,
  seesPrices,
  canActOn,
  onGlance,
  onReopen,
  onShare,
}: {
  rows: readonly RfqCardRow[]
  seesPrices: boolean
  /** Whether the viewer runs this RFQ (rfq-access.ts). */
  canActOn: (row: RfqCardRow) => boolean
  onGlance: (row: RfqCardRow) => void
  onReopen: (row: RfqCardRow) => void
  /** «رابط الزوار» on an open RFQ the viewer runs (the tile has it too). */
  onShare?: (row: RfqCardRow) => void
}) {
  const t = useTranslations("Portal.Procurement.rfqlist")
  const tc = useTranslations("Portal.Contractor")
  const tg = useTranslations("Portal.Procurement.rfqpage")
  const router = useRouter()
  const hrefOf = (row: RfqCardRow) => `/contractor/rfqs/${row.id}/offers?tab=details`

  const columns: DataColumn<RfqCardRow>[] = [
    {
      key: "rfq",
      header: t("col_rfq"),
      cell: (row) => (
        <span className="flex min-w-0 flex-col items-start gap-1">
          <RfqNumber rfq={row.rfq} />
          <Link href={hrefOf(row)} className="block max-w-[22rem] truncate rounded-sm text-start font-bold text-foreground hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
            {row.rfq.title}
          </Link>
          {row.rfq.createdByUserName && <span className="text-[11px] text-muted-foreground">{t("by", { name: row.rfq.createdByUserName })}</span>}
        </span>
      ),
    },
    {
      key: "materials",
      header: t("col_materials"),
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <span className="text-xs text-muted-foreground">{t("materials", { count: productCount(row.rfq) })}</span>
          <SitesTag row={row} />
        </span>
      ),
    },
    { key: "reach", header: t("col_reach"), hideBelow: "lg", cell: (row) => <ReachTag row={row} /> },
    {
      key: "offers",
      header: t("col_offers"),
      cell: (row) => <OffersCell row={row} seesPrices={seesPrices} onGlance={() => onGlance(row)} />,
    },
    {
      key: "closes",
      header: t("col_closes"),
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          <ClosesText row={row} />
        </span>
      ),
    },
    { key: "status", header: t("col_status"), cell: (row) => <RfqStagePill row={row} /> },
    {
      key: "action",
      header: <span className="sr-only">{t("col_action")}</span>,
      label: t("col_action"),
      cardHidden: false,
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          <RfqPrimaryAction row={row} canAct={canActOn(row)} onReopen={onReopen} />
          {onShare && row.state === "open" && !row.direct && canActOn(row) && <IconButton label={tg("guest_link")} icon={Link2} iconSize={14} variant="outline" className="h-11 w-11 shrink-0 md:h-8 md:w-8" onClick={() => onShare(row)} />}
        </span>
      ),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      caption={tc("rfqv_title")}
      labels={{ sortBy: (c) => c, showMore: (n) => t("show_more", { count: n }) }}
      empty={null}
      rowTone={(row) => (row.noLive ? "bad" : undefined)}
      cardTitleKey="rfq"
      onRowClick={(row) => router.push(hrefOf(row))}
      className={cn("shadow-sm")}
    />
  )
}
