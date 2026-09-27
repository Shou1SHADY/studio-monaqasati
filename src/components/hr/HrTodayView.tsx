"use client"

// Today (PRD TD-01, ST-05): every role's first page. For a company moving in,
// the build path — computed from the record, never ticked by hand — says what
// is done and what is next; each step opens where it is done. The decision
// groups (TD-02) join as the modules behind them are built.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Ambulance, CalendarClock, CheckCircle2, Circle, CircleAlert, ClipboardCheck, FileWarning, Hourglass, Inbox, Landmark, Lock, OctagonAlert, Route, UserCheck, Wallet, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrRequests } from "@/hooks/useHrRequests"
import { useHrToday } from "@/hooks/useHrToday"
import { usePermissions } from "@/hooks/usePermissions"
import { Link } from "@/i18n/routing"
import { HR_EMPLOYEES, HR_SITES } from "@/lib/hr/collections"
import { hrDate, todayDay } from "@/lib/hr/format"
import { todayItems, type TodayGroup, type TodayItem } from "@/lib/hr/today"
import { requestActions } from "@/lib/hr/requests"
import { isOffice, type HrSite } from "@/lib/hr/sites"
import { cn } from "@/lib/utils"
import { HrRequestList } from "./HrRequestList"
import { HrViolationList, useHrViolations, violationWaits } from "./HrViolationList"
import { hrHref, type HrPortal } from "./HrShell"

type Step = { key: string; done: boolean; href: string }

export function HrTodayView({ access, portal }: { access: HrAccess; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
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
      { key: "employees", done: (emps ?? []).length > 0, href: hrHref(portal, "people") },
    ]
  }, [sites, emps, access.settings, access.settingsDocExists, portal])
  const done = steps.filter((s) => s.done).length
  // TD-02 — what waits for this viewer's hand (cancelling is not a decision).
  const { requests } = useHrRequests(access)
  const today = todayDay()
  const waiting = useMemo(() => requests.filter((r) => requestActions(access.ctx, r, { today, financeAllowed: false }).some((a) => a !== "cancel")), [requests, access.ctx, today])

  const { user } = useUser()
  const { profile } = usePermissions()
  const actor = { uid: user?.uid ?? "", name: (profile?.name as string) || null }
  const violations = useHrViolations(access)
  const vWaiting = useMemo(() => violations.filter((v) => violationWaits(access, v)), [violations, access])

  const world = useHrToday(access, today)
  const items = useMemo(
    () => todayItems({ ctx: access.ctx, today, renewWindowDays: access.settings.policies.renewWindowDays, ...world }),
    [access.ctx, today, access.settings.policies.renewWindowDays, world]
  )
  const [more, setMore] = useState<Record<string, boolean>>({})
  const group = (g: Exclude<TodayGroup, "requests">) => items.filter((x) => x.group === g)
  const shown = <T,>(key: string, list: T[]) => (more[key] ? list : list.slice(0, 3))
  const moreButton = (key: string, n: number) =>
    n > 3 && !more[key] ? (
      <Button variant="ghost" size="sm" className="w-full" onClick={() => setMore((m) => ({ ...m, [key]: true }))}>
        {t("today.show_more", { n: n - 3 })}
      </Button>
    ) : null
  const row = (x: TodayItem) => (
    <DecisionRow
      key={x.key}
      severity={x.severity}
      icon={KIND_ICON[x.kind] ?? CircleAlert}
      title={t(`today.k.${x.kind}`, itemParams(x, t, locale))}
      detail={x.source ? <SourceBadge module={x.source} label={t(`today.src.${x.source}`)} /> : undefined}
      action={
        x.action && x.href ? (
          <Button asChild size="sm" variant={x.severity === "red" ? "default" : "outline"}>
            <Link href={`/${portal}/hr/${x.href}`}>{t(`today.a.${x.action}`)}</Link>
          </Button>
        ) : undefined
      }
    />
  )
  const panel = (g: Exclude<TodayGroup, "requests">, icon: typeof Inbox) => {
    const list = group(g)
    return (
      <Panel key={g} title={t(`today.g.${g}`)} icon={icon} count={list.length || undefined} bodyClassName="p-0">
        {list.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t(`today.none.${g}`)}</p>
        ) : (
          <>
            <ul className="divide-y">{shown(g, list).map(row)}</ul>
            {moreButton(g, list.length)}
          </>
        )}
      </Panel>
    )
  }

  const decisions = (
    <div className="space-y-6">
      {panel("blocking", OctagonAlert)}
      {panel("other", Hourglass)}
      <Panel title={t("today.g.requests")} icon={Inbox} count={waiting.length + vWaiting.length || undefined}>
        <div className="space-y-3">
          <HrRequestList access={access} requests={shown("req", waiting)} portal={portal} empty={t("today.nothing_waiting")} />
          {moreButton("req", waiting.length)}
          {vWaiting.length > 0 && <HrViolationList access={access} actor={actor} violations={shown("vio", vWaiting)} all={violations} empty="" />}
          {moreButton("vio", vWaiting.length)}
        </div>
      </Panel>
      {panel("due", CalendarClock)}
    </div>
  )

  if (!access.allowed("settings.manage")) return decisions

  return (
    <div className="space-y-6">
      {decisions}
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
    </div>
  )
}

const KIND_ICON: Record<string, LucideIcon> = {
  iqama_on_site: FileWarning,
  close_month: Lock,
  injury_overdue: Ambulance,
  injury_due: Ambulance,
  iban_fix: Wallet,
  iban_approve: Wallet,
  payroll_prepare: Landmark,
  payroll_approve: Landmark,
  sheet_today: ClipboardCheck,
  wait_custody: Hourglass,
  wait_settlement: Hourglass,
  wait_post: Hourglass,
  wait_pay: Hourglass,
  wait_advance: Hourglass,
  doc_due: FileWarning,
  iqama_clock: FileWarning,
  probation_end: UserCheck,
  contract_end: CalendarClock,
}

/** Dates in the reader's language; a document type by its name. */
function itemParams(x: TodayItem, t: ReturnType<typeof useTranslations>, locale: string): Record<string, string | number> {
  const out: Record<string, string | number> = { ...x.params }
  for (const k of ["date", "due"]) if (typeof out[k] === "string") out[k] = hrDate(out[k] as string, locale)
  if (typeof out.doc === "string") out.doc = t(`doc.${out.doc}` as "doc.iqama")
  return out
}

