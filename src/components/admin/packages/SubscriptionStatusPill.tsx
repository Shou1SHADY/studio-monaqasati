"use client"

import { useTranslations } from "next-intl"
import { StatusPill } from "@/components/module-ui/StatusPill"
import type { SubscriptionStatus } from "@/lib/subscription-status"

/** «اشتراك نشط» / «اشتراك تجريبي» beside a contractor's package (AD-03) — never in place of the verification status, whose
 * «نشط» it would otherwise repeat word for word. */
export function SubscriptionStatusPill({ status }: { status: SubscriptionStatus }) {
  const t = useTranslations("Portal.AdminPackages.detail.subscription")
  return (
    <span data-subscription={status} className="inline-flex">
      <StatusPill tone={status === "trial" ? "violet" : "ok"}>{t(`pill_${status}`)}</StatusPill>
    </span>
  )
}
