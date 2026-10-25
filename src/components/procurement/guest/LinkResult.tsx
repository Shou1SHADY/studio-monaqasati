"use client"

import { useLocale, useTranslations } from "next-intl"
import { Check, Clock, X } from "lucide-react"
import { fmtDay } from "./link-format"
import type { LinkRfqView, VisitorResult } from "./link-types"
import { cn } from "@/lib/utils"

const CANCEL_WHY = ["need", "price", "spec", "reissue"] as const

// HIS result once the request is decided (LNK-11), in the prototype's four words: awarded to him — with the order's link when
// it exists —, not awarded, still under review, cancelled with its reason.
export function LinkResult({ result, rfq }: { result: VisitorResult; rfq: Pick<LinkRfqView, "closedAt" | "closeAt" | "closedEarly"> }) {
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const closed = fmtDay((rfq.closedAt || rfq.closeAt || "").slice(0, 10), locale)
  const tone = result.kind === "awarded" ? "ok" : result.kind === "review" ? "wait" : "no"
  const why = result.cancelCode ? (CANCEL_WHY as readonly string[]).includes(result.cancelCode) ? t(`cancel_why_${result.cancelCode}`) : t("cancel_why_other") : ""
  const title = result.kind === "awarded" ? t("result_awarded") : result.kind === "lost" ? t("result_lost") : result.kind === "cancelled" ? t("result_cancelled") : t("result_review")
  const sub =
    result.kind === "awarded"
      ? t("result_awarded_sub")
      : result.kind === "lost"
        ? rfq.closedEarly
          ? t("result_lost_early", { date: closed })
          : t("result_lost_sub", { date: closed })
        : result.kind === "cancelled"
          ? why
          : t("result_review_sub")
  const Icon = tone === "ok" ? Check : tone === "wait" ? Clock : X
  return (
    <section className="space-y-2 rounded-md border bg-card p-5 text-center" aria-labelledby="link-result-title" data-result={result.kind}>
      <span className={cn("mx-auto flex h-11 w-11 items-center justify-center rounded-full", tone === "ok" ? "bg-success/10 text-success" : tone === "wait" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")} aria-hidden="true">
        <Icon size={22} />
      </span>
      <h2 id="link-result-title" className="text-lg font-black text-foreground">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{sub}</p>
      {result.kind === "awarded" && result.orderUrl && (
        <a href={result.orderUrl} className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {result.poNumber ? t("result_awarded_cta", { no: result.poNumber }) : t("result_awarded_open")}
        </a>
      )}
    </section>
  )
}
