"use client"

// The numbers under the path (RFQ-02, G-03): how many suppliers it reached, how many times it was opened, the offers (and how
// many came from outside the platform), the lowest COMPLETE offer — the one figure every other screen shows — and the
// questions still unanswered, which open the Inquiries tab.

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

function Stat({ children, label, className }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-xl border bg-card px-3 py-2", className)}>
      {label && <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>}
      <span className="text-sm font-black text-foreground">{children}</span>
    </div>
  )
}

export function RfqNumbersRow({ reached, views, offers, offPlatform, lowestGrossH, showPrices, unanswered, onOpenInquiries }: NumbersRowProps) {
  const t = useTranslations("Portal.Procurement.rfqpage.numbers")
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="rfq-numbers">
      <Stat>{reached != null ? t("reached", { count: reached }) : t("reached_unknown")}</Stat>
      <Stat>{t("views", { count: views })}</Stat>
      <Stat>
        {t("offers", { count: offers })}
        {offPlatform > 0 && <span className="block text-[11px] font-semibold text-muted-foreground">{t("offers_off", { count: offPlatform })}</span>}
      </Stat>
      <Stat label={t("lowest")}>{showPrices && lowestGrossH != null ? <Money value={fromHalalas(lowestGrossH)} /> : "—"}</Stat>
      {unanswered > 0 ? (
        <button
          type="button"
          onClick={onOpenInquiries}
          className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-start text-sm font-black text-warning hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <MessageCircleQuestion size={16} aria-hidden="true" />
          {t("unanswered", { count: unanswered })}
        </button>
      ) : (
        <Stat className="text-muted-foreground">{t("no_questions")}</Stat>
      )}
    </div>
  )
}
