"use client"

// One offer as a row of the list (RFQ-05): rank · supplier and where he came from · total with its basis and how far above
// the lowest · what he priced · lead time and terms · validity and when he sent it · tags. Compact on purpose — a list of
// fifty must read at a glance (NFR-03) — and every figure is the one the comparison and the award read.

import { memo } from "react"
import { useTranslations } from "next-intl"
import { MailQuestion, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/module-ui/IconButton"
import { Money, useDateText } from "@/components/procurement/PoBits"
import { fromHalalas } from "@/lib/procurement/offer-calc"
import { currentNote, daysAgo, piecePackNames, warrantyOf, type OfferRowModel } from "@/lib/procurement/rfq-offers-view"
import { cn } from "@/lib/utils"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useTermsText } from "./rfqOfferText"
import type { RfqView } from "./rfqOfferView"
import { OfferTags } from "./OfferTags"

export interface OfferRowProps {
  row: OfferRowModel
  rfq: RfqView
  today: string
  showPrices: boolean
  canShortlist: boolean
  canAsk: boolean
  fallbackName: string
  hasRecord: boolean
  /** Registered and verified by his documents — told apart from the orders we gave him (prototype row subtitle). */
  verified?: boolean
  /** Our orders with him. */
  orders?: number
  onOpen: (id: string) => void
  onToggleShortlist: (row: OfferRowModel) => void
  onClarify: (row: OfferRowModel) => void
}

const RANK_TONE: Record<number, string> = { 1: "bg-warning/15 text-warning" }

/** A click on the row opens the panel, unless it landed on one of the row's own controls. */
const fromControl = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, [role='button']"))

function OfferRowView({ row, rfq, today, showPrices, canShortlist, canAsk, fallbackName, hasRecord, verified, orders, onOpen, onToggleShortlist, onClarify }: OfferRowProps) {
  const t = useTranslations("Portal.Procurement.rfqpage.list")
  const date = useDateText()
  const termsText = useTermsText()
  const name = row.name || fallbackName
  const out = row.excluded || row.withdrawn || row.declined
  const ev = row.ev
  const terms = termsText(row.offer as never)
  const warranty = warrantyOf(row.offer, rfq)
  const sent = daysAgo(row.submittedAt, today)
  const guest = row.origin === "guest"
  const lowest = ev.isLowestComplete
  const packs = piecePackNames(row.offer)
  const note = currentNote(row.offer)
  const subtitle = guest
    ? t("off_platform")
    : row.origin === "mdmak"
      ? t("mdmak")
      : verified === undefined
        ? hasRecord
          ? t("verified")
          : t("platform")
        : `${verified ? t("docs_verified") : t("docs_unverified")} · ${orders ? t("orders_with_us", { count: orders }) : t("new_with_us")}`

  return (
    <div
      role="row"
      data-offer={row.id}
      data-state={out ? "out" : row.awarded ? "won" : ev.partial ? "short" : "live"}
      onClick={(e) => !fromControl(e.target) && onOpen(row.id)}
      className={cn(
        "grid cursor-pointer gap-x-3 gap-y-1 border-b px-3 py-2.5 text-sm transition-colors last:border-b-0 hover:bg-muted/40 md:grid-cols-[2.25rem_minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_auto] md:items-center",
        guest && "bg-warning/5",
        out && "opacity-70",
        row.awarded && "bg-success/5"
      )}
    >
      <span role="cell" className={cn("hidden h-7 w-7 place-items-center rounded-full text-xs font-black md:grid", row.rank ? RANK_TONE[row.rank] || "bg-muted text-muted-foreground" : "text-muted-foreground")} aria-label={row.rank ? t("rank", { n: row.rank }) : undefined}>
        {row.rank ? `#${row.rank}` : out ? "—" : "·"}
      </span>

      <div role="cell" className="flex min-w-0 items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-black text-primary" aria-hidden="true">
          {name.trim().charAt(0).toUpperCase() || "؟"}
        </span>
        <span className="min-w-0">
          <button type="button" onClick={() => onOpen(row.id)} className="block max-w-full truncate rounded-sm text-start font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
            {name}
          </button>
          <span className="block truncate text-[11px] text-muted-foreground" data-subtitle>
            {subtitle}
          </span>
        </span>
      </div>

      <div role="cell" className="min-w-0">
        {showPrices && row.grossH != null ? (
          <>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <Money value={fromHalalas(row.grossH)} className={cn("text-base font-black", out && "line-through")} />
              {row.previousGrossH != null && showPrices && <Money value={fromHalalas(row.previousGrossH)} className="text-[11px] text-muted-foreground line-through" />}
            </span>
            <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
              {ev.partial ? <span className="font-bold text-warning">{t("partial")}</span> : out ? null : lowest ? <span className="font-bold text-success">{t("lowest")}</span> : ev.deltaPct != null ? <span dir="ltr">+{ev.deltaPct}%</span> : null}
              <span>{ev.vatRate > 0 ? t("incl") : t("no_vat")}</span>
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>

      <div role="cell" className="min-w-0">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className={cn("h-full rounded-full", ev.partial ? "bg-warning" : "bg-success")} style={{ width: `${row.coverage.of ? Math.round((row.coverage.covered / row.coverage.of) * 100) : 0}%` }} />
        </div>
        <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground">{ev.partial ? t("n_of_m", { covered: row.coverage.covered, of: row.coverage.of }) : t("all_materials")}</span>
      </div>

      <div role="cell" className="min-w-0 text-xs">
        <span className="block font-semibold">{row.leadDays != null ? t("lead_days", { days: row.leadDays }) : t("lead_none")}</span>
        {terms && <span className="block truncate text-[11px] text-muted-foreground" dir="auto">{terms}</span>}
      </div>

      <div role="cell" className="min-w-0 text-xs">
        <span className={cn("block font-semibold", row.validity === "expired" && "text-destructive", row.validity === "soon" && "text-warning")}>{row.validUntil ? date(row.validUntil) : "—"}</span>
        <span className="block text-[11px] text-muted-foreground" suppressHydrationWarning>
          {sent == null ? "" : sent === 0 ? t("sent_today") : t("sent_ago", { days: sent })}
        </span>
      </div>

      <div role="cell" className="flex items-center gap-1 justify-self-end">
        {canShortlist && !row.excluded && (
          <IconButton
            label={row.shortlisted ? t("shortlist_remove") : t("shortlist_add")}
            icon={Star}
            iconSize={15}
            aria-pressed={row.shortlisted}
            className={cn("h-9 w-9 md:h-9 md:w-9", row.shortlisted && "text-warning [&_svg]:fill-current")}
            onClick={() => onToggleShortlist(row)}
          />
        )}
        {canAsk && !out && <IconButton label={t("clarify")} icon={MailQuestion} iconSize={15} className="h-9 w-9 md:h-9 md:w-9" onClick={() => onClarify(row)} />}
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => onOpen(row.id)}>
          {t("details")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1 md:col-span-full md:col-start-2" role="cell">
        <OfferTags row={row} />
        {ev.partial && <StatusPill tone="warn">{t("priced_only", { count: row.coverage.covered })}</StatusPill>}
        <StatusPill tone={(row.officialQuote ? "ok" : "mute") as PillTone}>{row.officialQuote ? t("official") : t("no_official")}</StatusPill>
        {warranty && <StatusPill tone={warranty.short ? "warn" : "ok"}>{warranty.months === 0 ? t("warranty_none") : warranty.short ? t("warranty_short", { months: warranty.months }) : t("warranty_ok", { months: warranty.months })}</StatusPill>}
        {packs.length > 0 && <StatusPill tone="mute">{t("by_piece_named", { packs: packs.join(t("packs_sep")) })}</StatusPill>}
        {note && (
          <span title={note} className="inline-flex max-w-[16rem]">
            <StatusPill tone="mute" className="truncate font-medium">
              <span className="truncate" dir="auto">
                {note}
              </span>
            </StatusPill>
          </span>
        )}
        {ev.kind === "lump" && <StatusPill tone="mute">{t("lump")}</StatusPill>}
        {row.withdrawn && <StatusPill tone="mute">{t("withdrawn")}</StatusPill>}
        {row.declined && <StatusPill tone="mute">{t("declined")}</StatusPill>}
        {row.excluded && row.exclusion && (
          <span className="text-[11px] text-muted-foreground" dir="auto">
            {t("excluded_why", { reason: t(`exclusion.${row.exclusion.code}`) })}
            {row.exclusion.text ? ` — ${row.exclusion.text}` : ""}
          </span>
        )}
      </div>
    </div>
  )
}

export const OfferRow = memo(OfferRowView)
