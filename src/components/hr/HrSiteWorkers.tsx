"use client"

// The workplace's injury register (PRD DC-07, WF-15 step 1): each injury with
// its GOSI deadline — reporting it is government relations' (DC-07), so here
// it is information. The people, and recording an injury or a violation on
// another day, are on the site page's people table (HrSitePanel). Limited to
// whoever runs the place (the guard and the rules both check the site).

import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Ambulance } from "lucide-react"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { HR_INJURIES } from "@/lib/hr/collections"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, todayDay } from "@/lib/hr/format"
import { injuryState, type HrInjury } from "@/lib/hr/injuries"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"

const TONE = { due: "warn", overdue: "bad", reported: "ok" } as const

export function HrSiteWorkers({ access, siteId }: { access: HrAccess; siteId: string; actor?: HrActor }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const site = siteId === UNASSIGNED_SITE ? null : siteId
  const mayInjury = Boolean(site) && access.allowed("injury.record", { site })
  const injQ = useMemoFirebase(
    () => (firestore && access.orgId && site && access.ctx.roles.size > 0 ? query(collection(firestore, HR_INJURIES), where("organizationId", "==", access.orgId), where("siteId", "==", site)) : null),
    [firestore, access.orgId, site, access.ctx.roles.size]
  )
  const { data: injData } = useCollection(injQ)
  const injuries = ((injData ?? []) as unknown as HrInjury[]).slice().sort((a, b) => b.on.localeCompare(a.on))

  // The place is his to see: he runs it, records its attendance, or is management.
  const seesPlace = mayInjury || (Boolean(site) && (access.allowed("violation.record", { site }) || access.allowed("attendance.record", { site }))) || access.ctx.roles.has("management")
  if (!site || !seesPlace || (!mayInjury && injuries.length === 0)) return null

  return (
    <Panel title={t("siteppl.injuries")} icon={Ambulance} count={injuries.length || undefined}>
      {injuries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("inj.none")}</p>
      ) : (
        <ul className="divide-y">
          {injuries.map((i) => {
            const st = injuryState(i, today)
            return (
              <li key={i.id} className="space-y-0.5 py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span dir="auto">{i.employeeName}</span>
                  <span className="text-muted-foreground">{hrDate(i.on, locale)}</span>
                  <StatusPill tone={TONE[st]}>{t(`inj.state.${st}`, { due: hrDate(i.due, locale) })}</StatusPill>
                </p>
                <p className="text-xs text-muted-foreground" dir="auto">
                  {i.description}
                  {i.report && ` · ${t("inj.report_line", { no: i.report.no, on: hrDate(i.report.on, locale) })}`}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
