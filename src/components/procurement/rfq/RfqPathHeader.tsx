"use client"

// The RFQ's path (RFQ-01, FLW-03, prototype `rfqLife`): three groups in the colour of the role that owns them — the request
// (its owner, blue), Procurement (teal-green), supply and receiving (green) — the segment the page stands in marked.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check } from "lucide-react"
import { fmtDayLong, displayNeedRef } from "@/lib/procurement/format"
import { stepClasses, type PageStage, type PathModel, type StepClass } from "@/lib/procurement/rfq-path"
import { cn } from "@/lib/utils"

const GROUP = {
  request: "border-role-requester/30 bg-role-requester-light text-role-requester-ink",
  procurement: "border-role-buyer/30 bg-role-buyer-light text-role-buyer-ink",
  supply: "border-role-receiver/30 bg-role-receiver-light text-role-receiver-ink",
} as const

function Step({ n, state, label, value, sub }: { n: number; state: StepClass; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <li className={cn("flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5", state === "on" && "bg-background/70", state === "can" && "bg-background/50")} data-step-state={state || "idle"}>
      <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-black", state === "done" ? "border-current bg-current/10" : state ? "border-current" : "border-current/40 opacity-60")} aria-hidden="true">
        {state === "done" ? <Check size={11} /> : n}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold opacity-80">{label}</span>
        <span className="block truncate text-xs font-black" dir="auto">
          {value}
        </span>
        {sub && <span className="block text-[11px] font-medium opacity-80">{sub}</span>}
      </span>
    </li>
  )
}

export function RfqPathHeader({ path, stage }: { path: PathModel; stage: PageStage }) {
  const t = useTranslations("Portal.Procurement.rfqpage.path")
  const locale = useLocale()
  const day = (d: string | null) => fmtDayLong(d, locale, false)
  const steps = stepClasses(path, stage)
  const r = path.request
  const refs = r.refs.map((x) => displayNeedRef(x, locale))
  const award = path.award

  const offersValue =
    path.offers.closed && path.offers.closedOn
      ? t(path.offers.closedEarly ? "offers_closed_early" : "offers_closed", { count: path.offers.count, date: day(path.offers.closedOn) })
      : t("offers_open", { count: path.offers.count, date: day(path.offers.until) })

  let awardValue: ReactNode = t("award_wait")
  let awardSub: ReactNode = null
  if (award.kind === "cancelled") awardValue = t("award_cancelled", { reason: award.reason || "—" })
  else if (award.kind === "awarded") awardValue = award.early ? t("award_done_early") : t("award_done")
  else if (award.kind === "can") {
    awardValue = t("award_can")
    if (award.before) awardSub = t("award_early", { date: day(award.before) })
  } else if (award.kind === "comparing") {
    awardValue = award.by ? t("award_before", { date: day(award.by) }) : t("award_can")
    if (award.daysLeft != null) awardSub = award.daysLeft < 0 ? t("award_late") : award.daysLeft === 0 ? t("award_today") : award.daysLeft === 1 ? t("award_tomorrow") : t("award_in_days", { days: award.daysLeft })
  }

  return (
    <nav aria-label={t("aria")} className="grid gap-2 lg:grid-cols-3">
      <section aria-current={path.current === "request"} className={cn("rounded-xl border p-3", GROUP.request, path.current === "request" && "ring-2 ring-role-requester/50")}>
        <h2 className="text-[11px] font-black">{t("request")}</h2>
        {refs.length ? (
          <div className="mt-1 space-y-0.5">
            <p className="text-sm font-black" dir="auto">
              <bdi>{refs[0]}</bdi>
              {refs.length > 1 && <span className="ms-1 text-xs opacity-80">+{refs.length - 1}</span>}
            </p>
            <p className="text-xs font-semibold" dir="auto">
              {r.source ? t(`src_${r.source}`) : ""}
              {r.source && r.requester ? " · " : ""}
              {r.requester}
            </p>
          </div>
        ) : (
          <div className="mt-1 space-y-0.5">
            <p className="text-sm font-black">{t("direct")}</p>
            <p className="text-xs font-semibold">{t("no_request")}</p>
          </div>
        )}
        <p className="mt-1 text-xs font-semibold">{r.needBy ? t("need_by", { date: day(r.needBy) }) : t("need_none")}</p>
      </section>

      <section aria-current={path.current === "procurement"} className={cn("rounded-xl border p-3", GROUP.procurement, path.current === "procurement" && "ring-2 ring-role-buyer/50")}>
        <h2 className="text-[11px] font-black">{t("procurement")}</h2>
        <ol className="mt-1 space-y-0.5">
          <Step n={1} state={steps.published} label={t("published")} value={path.published ? day(path.published) : "—"} />
          <Step n={2} state={steps.offers} label={t("offers")} value={offersValue} />
          <Step n={3} state={steps.award} label={t("award")} value={awardValue} sub={awardSub} />
        </ol>
      </section>

      <section aria-current={path.current === "supply"} className={cn("rounded-xl border p-3", GROUP.supply, path.current === "supply" && "ring-2 ring-role-receiver/50")}>
        <h2 className="text-[11px] font-black">{t("supply")}</h2>
        <ol className="mt-1 space-y-0.5">
          <Step n={4} state={steps.orders} label={t("orders")} value={path.orders ? t("orders_n", { count: path.orders }) : "—"} />
          <Step n={5} state={steps.receipt} label={t("receipt")} value={path.receipt ? t("receipt_n", { done: path.receipt.done, total: path.receipt.total }) : "—"} />
        </ol>
      </section>
    </nav>
  )
}
