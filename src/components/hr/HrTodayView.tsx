"use client"

// Today (PRD TD-01, ST-05): every role's first page. For a company moving in,
// the build path — computed from the record, never ticked by hand — says what
// is done and what is next; each step opens where it is done. The decision
// groups (TD-02) join as the modules behind them are built.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { CheckCircle2, Circle, Route } from "lucide-react"
import { Panel } from "@/components/module-ui/Panel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { Link } from "@/i18n/routing"
import { HR_EMPLOYEES, HR_SITES } from "@/lib/hr/collections"
import { isOffice, type HrSite } from "@/lib/hr/sites"
import { cn } from "@/lib/utils"
import { hrHref, type HrPortal } from "./HrShell"

type Step = { key: string; done: boolean; href: string }

export function HrTodayView({ access, portal }: { access: HrAccess; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const orgId = access.orgId
  const sitesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, HR_SITES), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: sites } = useCollection(sitesQ)
  const empQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, HR_EMPLOYEES), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: emps } = useCollection(empQ)

  const steps: Step[] = useMemo(() => {
    const live = ((sites ?? []) as unknown as HrSite[]).filter((s) => s.active !== false)
    const settings = access.settings
    return [
      { key: "establishment", done: Boolean(settings.establishment.name && settings.establishment.cr), href: hrHref(portal, "settings") },
      { key: "type", done: Boolean(settings.businessType), href: hrHref(portal, "settings") },
      { key: "policies", done: access.settingsDocExists, href: hrHref(portal, "settings") },
      { key: "sites", done: live.length > 0, href: hrHref(portal, "sites") },
      { key: "supervisors", done: live.length > 0 && live.filter((s) => !isOffice(s.type)).every((s) => Boolean(s.supervisorUserId)), href: hrHref(portal, "sites") },
      { key: "employees", done: (emps ?? []).length > 0, href: hrHref(portal, "sites") },
    ]
  }, [sites, emps, access.settings, access.settingsDocExists, portal])
  const done = steps.filter((s) => s.done).length

  if (!access.allowed("settings.manage")) {
    return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("today.soon")}</p>
  }

  return (
    <Panel title={t("today.build_title")} icon={Route} count={steps.length - done || undefined}>
      <p className="mb-3 text-xs text-muted-foreground">{t("today.build_note", { done, total: steps.length })}</p>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors hover:border-module/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                s.done ? "border-success/20 bg-success/5" : "bg-card"
              )}
            >
              {s.done ? <CheckCircle2 size={17} className="shrink-0 text-success" aria-hidden="true" /> : <Circle size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="text-xs font-bold text-muted-foreground tabular-nums">{i + 1}</span>
              <span className={cn("font-semibold", s.done && "text-muted-foreground")}>{t(`today.step.${s.key}`)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
