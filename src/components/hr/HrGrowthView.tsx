"use client"

// The growth tab (the prototype's VIEWS.grow): Performance and Training, each behind its own switch (ST-02) —
// the segments show only what is on, and training opens when performance is off. The tab's label follows the
// switches too (`perfLabelKey`).

import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import type { HrAccess } from "@/hooks/useHrAccess"
import { growthSegment } from "@/hooks/useHrGrowthKpis"
import { usePathname, useRouter } from "@/i18n/routing"
import type { HrActor } from "@/lib/hr/employee-writes"
import { HrPerformanceView } from "./HrPerformanceView"
import { HrTrainingView } from "./HrTrainingView"
import type { HrPortal } from "./HrShell"

export function HrGrowthView({ access, portal, actor }: { access: HrAccess; portal: HrPortal; actor: HrActor }) {
  const t = useTranslations("Portal.HR")
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const features = access.settings.features
  const seg = growthSegment(features, params?.get("seg") ?? null)
  const segments = (["perf", "train"] as const).filter((s) => features.includes(s)).map((s) => ({ id: s, label: t(`grow.seg.${s}`) }))
  return (
    <div className="space-y-5">
      {segments.length > 1 && <SegmentedNav segments={segments} active={seg} onSelect={(s) => router.replace(`${pathname}?seg=${s}`)} ariaLabel={t("grow.segments")} />}
      {seg === "train" ? <HrTrainingView access={access} portal={portal} actor={actor} sessionParam={params?.get("session") ?? null} /> : <HrPerformanceView access={access} portal={portal} actor={actor} />}
    </div>
  )
}
