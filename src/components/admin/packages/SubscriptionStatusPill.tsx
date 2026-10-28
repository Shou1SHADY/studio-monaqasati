"use client"

import { useTranslations } from "next-intl"
import { StatusPill } from "@/components/module-ui/StatusPill"
import type { SubscriptionPhase } from "@/lib/subscription-status"

/** «اشتراك نشط» / «اشتراك تجريبي» beside a contractor's package (AD-03) — never in place of the verification status, whose
 * «نشط» it would otherwise repeat word for word. */
export function SubscriptionStatusPill({ status, daysLeft }: { status: SubscriptionPhase; daysLeft?: number | null }) {
  const t = useTranslations("Portal.AdminPackages.detail.subscription")
  return (
    <span data-subscription={status} className="inline-flex">
      <StatusPill tone={status === "expired" ? "bad" : status === "trial" ? "violet" : "ok"}>
        {t(`pill_${status}`)}
        {status === "trial" && daysLeft != null ? ` · ${t("days_left", { count: daysLeft })}` : ""}
      </StatusPill>
    </span>
  )
}
