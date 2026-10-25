"use client"

// The numbers under the path (RFQ-02, G-03): how many suppliers it reached, how many times it was opened, the offers (and how
// many came from outside the platform), the lowest COMPLETE offer — the one figure every other screen shows — and the
// questions still unanswered, which open the Inquiries tab. Each box is a label and its FIGURE — 0 is a figure too, so a fresh
// RFQ reads «0» rather than a row of sentences with no numbers in them.

import { useTranslations } from "next-intl"
import { MessageCircleQuestion } from "lucide-react"
import { Money } from "@/components/procurement/PoBits"
import { fromHalalas } from "@/lib/procurement/offer-calc"
import { cn } from "@/lib/utils"

export interface NumbersRowProps {
  reached: number | null
  views: number
  offers: number
  offPlatform: number
  /** Gross, in halalas — `RfqWorld.lowestCompleteGrossH`. */
  lowestGrossH: number | null
  showPrices: boolean
  unanswered: number
  onOpenInquiries: () => void
}

const BOX = "flex min-w-0 flex-col gap-0.5 rounded-xl border bg-card px-3 py-2 text-start"

function Figure({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <span className={cn("text-base font-black tabular-nums", muted ? "text-muted-foreground" : "text-foreground")}>{children}</span>
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold text-muted-foreground">{children}</span>
}

export function RfqNumbersRow({ reached, views, offers, offPlatform, lowestGrossH, showPrices, unanswered, onOpenInquiries }: NumbersRowProps) {
  const t = useTranslations("Portal.Procurement.rfqpage.numbers")
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="rfq-numbers">
      <div className={BOX}>
        <Label>{t("reached_l")}</Label>
        <Figure muted={!reached}>{reached ?? "—"}</Figure>
      </div>
      <div className={BOX}>
        <Label>{t("views_l")}</Label>
        <Figure muted={!views}>{views}</Figure>
      </div>
      <div className={BOX}>
        <Label>{t("offers_l")}</Label>
        <Figure muted={!offers}>{offers}</Figure>
        {offPlatform > 0 && <span className="text-[11px] font-semibold text-muted-foreground">{t("offers_off", { count: offPlatform })}</span>}
      </div>
      <div className={BOX}>
        <Label>{t("lowest")}</Label>
        <Figure muted={!(showPrices && lowestGrossH != null)}>{showPrices && lowestGrossH != null ? <Money value={fromHalalas(lowestGrossH)} /> : "—"}</Figure>
      </div>
      {unanswered > 0 ? (
        <button
          type="button"
          onClick={onOpenInquiries}
          className={cn(BOX, "border-warning/30 bg-warning/5 text-warning hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2")}
        >
          <span className="text-[11px] font-semibold">{t("unanswered_l")}</span>
          <span className="inline-flex items-center gap-1.5 text-base font-black tabular-nums">
            <MessageCircleQuestion size={16} aria-hidden="true" />
            {unanswered}
          </span>
        </button>
      ) : (
        <div className={BOX}>
          <Label>{t("unanswered_l")}</Label>
          <Figure muted>0</Figure>
        </div>
      )}
    </div>
  )
}
