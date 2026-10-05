"use client"

// My file (PRD ES-00…06, WF-23; the prototype's later VIEWS.me): every user on
// the record — the HR manager and management included — sees himself here and
// only himself. The head greets him with his number, trade, place and line
// manager, four tiles (leave balance with its formula · last salary · the
// document nearest its end · this month's attendance) and his quick actions,
// each disabled with its reason. Five segments: Home (needs your attention ·
// my day · requests in progress · last salary), my requests, attendance and
// leave, my pay, documents and details. He never edits his record: a change
// is a request. What he reads of attendance and of an unpaid payroll comes from
// the projections written for him (lib/hr/me.ts) — never a document that holds
// other people's facts.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { CalendarClock, CircleUser, FileText, HandCoins, Loader2, PencilLine, Plane } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useEmployeePay, useHrPeople } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { usePermissions } from "@/hooks/usePermissions"
import type { HrAccess } from "@/hooks/useHrAccess"
import { HR_EMPLOYEES, HR_PAYSLIPS } from "@/lib/hr/collections"
import { displayName, statusOn, type EmployeePay, type HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import {
  attentionItems,
  isAssumed,
  myActions,
  myDocuments,
  myLeaveFacts,
  myLineManager,
  monthName,
  mySlips,
  nearestOf,
  onLeaveToday,
  roleHolders,
  staffRoles,
  type HolderKey,
  type MemberLite,
  type MyAction,
  type MyAttendance,
  type MyDoc,
  type MyLeaveFacts,
  type MySlip,
  type PayslipDoc,
  type SlipProjection,
} from "@/lib/hr/me"
import { requestHolder, type DataField, type HrRequest, type HrRequestKind } from "@/lib/hr/requests"
import type { HrSite } from "@/lib/hr/sites"
import { cn } from "@/lib/utils"
import { NewLetterDialog } from "./HrLetterDialogs"
import { STATUS_TONE } from "./HrPeopleView"
import { useHrViolations } from "./HrViolationList"
import { HrMyAttendance } from "./HrMyAttendance"
import { HrMyDocs } from "./HrMyDocs"
import { HrMyHome } from "./HrMyHome"
import { HrMyPay } from "./HrMyPay"
import { HrMyRequests } from "./HrMyRequests"
import { NewRequestDialog } from "./NewRequestDialog"
import type { HrViolation } from "@/lib/hr/violations"

export type MySeg = "home" | "requests" | "leave" | "pay" | "docs"

/** Everything the segments read — one load, one shape. */
export interface MyFileCtx {
  access: HrAccess
  actor: HrActor
  emp: HrEmployee
  /** His pay as in force today, with the projected payroll line (`slip`). Null when none is recorded. */
  pay: (EmployeePay & { slip?: SlipProjection | null }) | null
  payKnown: boolean
  site: HrSite | null
  siteName: (id: string | null | undefined) => string | null
  requests: HrRequest[]
  violations: HrViolation[]
  slips: MySlip[]
  att: MyAttendance | null
  today: string
  leave: MyLeaveFacts
  docs: MyDoc[]
  holders: Record<HolderKey, string | null>
  lineManager: { userId: string | null; name: string | null } | null
  memberName: (uid: string | null | undefined) => string | null
  /** Who holds a request now, by name (ES-02). */
  holderOf: (r: HrRequest) => string | null
  assumed: boolean
  onLeave: boolean
  ask: (kind: HrRequestKind | "letter", field?: DataField) => void
  go: (seg: MySeg) => void
}

const ACTION_ICON: Record<MyAction, typeof Plane> = { leave: Plane, advance: HandCoins, letter: FileText, attfix: CalendarClock, data: PencilLine }

export function HrMyFile({ access, actor }: { access: HrAccess; actor: HrActor }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const today = todayDay()
  const id = access.ctx.employeeId
  const empRef = useMemoFirebase(() => (firestore && id ? doc(firestore, HR_EMPLOYEES, id) : null), [firestore, id])
  const { data: empData, isLoading } = useDoc(empRef)
  const emp = (empData as unknown as (HrEmployee & { att?: MyAttendance | null }) | null) ?? null
  const { pay: payNow, isLoading: payLoading } = useEmployeePay(id, Boolean(id))
  const pay = payNow as MyFileCtx["pay"]
  // Staff read their colleagues (the line manager named on the card); an employee reads only himself.
  const { employees: people, sites, siteName } = useHrPeople(access, access.ctx.roles.size > 0)
  const { requests: all } = useHrRequests(access)
  const requests = useMemo(() => all.filter((r) => r.employeeId === id), [all, id])
  const violations = useHrViolations(access).filter((v) => v.employeeId === id)
  const { orgMembers } = useOrgMembers(access.orgId)
  const { groups } = usePermissions()
  const psQ = useMemoFirebase(
    () => (firestore && access.orgId && access.ctx.uid ? query(collection(firestore, HR_PAYSLIPS), where("organizationId", "==", access.orgId), where("employeeUserId", "==", access.ctx.uid)) : null),
    [firestore, access.orgId, access.ctx.uid]
  )
  const { data: psData } = useCollection(psQ)
  const [seg, setSeg] = useState<MySeg>("home")
  const [asking, setAsking] = useState<{ kind: HrRequestKind; field?: DataField } | null>(null)
  const [letter, setLetter] = useState(false)

  if (isLoading) {
    return (
      <div className="flex justify-center p-16">
        <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
      </div>
    )
  }
  if (!emp || !emp.names) return <Callout tone="info">{t("me.no_record")}</Callout>

  const members = orgMembers as unknown as MemberLite[]
  const memberName = (uid: string | null | undefined) => {
    const m = members.find((x) => x.id === uid)
    return m ? m.name || m.email || null : null
  }
  const site = sites.find((s) => s.id === emp.siteId) ?? null
  const holders = roleHolders(members, groups as unknown as Array<{ id: string; permissions?: string[] }>)
  const lineManager = myLineManager(emp, site, people, members)
  const holderOf = (r: HrRequest) => {
    const h = requestHolder(r)
    if (!h) return null
    if (h.role === "line_manager" || h.role === "supervisor") return memberName(h.userId) ?? t(`me.holder.${h.role}`)
    const name = h.role === "hr" ? holders.manager : h.role === "management" ? holders.management : holders.finance
    const who = name ?? t(`me.holder.${h.role}`)
    return r.kind === "data" && h.role === "hr" ? t("me.holder.after_document", { name: who }) : who
  }
  const ctxData: MyFileCtx = {
    access,
    actor,
    emp,
    pay,
    payKnown: !payLoading,
    site,
    siteName,
    requests,
    violations,
    slips: mySlips((psData ?? []) as unknown as PayslipDoc[], pay?.slip ?? null, pay?.ibanState ?? null),
    att: emp.att ?? null,
    today,
    leave: myLeaveFacts(emp, today),
    docs: myDocuments(emp, today, access.settings.policies.renewWindowDays),
    holders,
    lineManager,
    memberName,
    holderOf,
    assumed: isAssumed(emp.siteId, site),
    onLeave: onLeaveToday(requests, today),
    ask: (kind, field) => (kind === "letter" ? setLetter(true) : setAsking({ kind, field })),
    go: setSeg,
  }
  const attention = attentionItems({
    emp,
    pay,
    payKnown: !payLoading,
    violations,
    requests,
    today,
    renewWindowDays: access.settings.policies.renewWindowDays,
  })
  const pending = requests.filter((r) => ["pending", "endorsed", "finance"].includes(r.state)).length
  const actions = myActions({ emp, pay, requests, today })
  const roles = staffRoles(access.ctx.roles)

  return (
    <div className="space-y-5">
      <MyHero ctx={ctxData} roles={roles.map((r) => t(`me.role.${r}`))} />
      {actions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label={t("me.actions")}>
          {actions.map((a) => {
            const Icon = ACTION_ICON[a.key]
            return (
              <Button
                key={a.key}
                variant="outline"
                className="h-auto min-h-11 justify-start gap-2 whitespace-normal py-2 text-start"
                disabled={a.blocked !== null}
                title={a.blocked ? t(`me.act_block.${a.blocked}`) : undefined}
                onClick={() => ctxData.ask(a.key === "letter" ? "letter" : (a.key as HrRequestKind))}
              >
                <Icon size={16} className="shrink-0 text-module" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-semibold">{t(`me.act.${a.key}`)}</span>
                  {a.blocked && <span className="block text-[11px] font-normal text-muted-foreground">{t(`me.act_block.${a.blocked}`)}</span>}
                </span>
              </Button>
            )
          })}
        </div>
      )}

      <SegmentedNav
        segments={(["home", "requests", "leave", "pay", "docs"] as const).map((s) => ({
          id: s,
          label: t(`me.seg.${s}`),
          count: s === "home" ? attention.length || undefined : s === "requests" ? pending || undefined : undefined,
          tone: s === "home" ? (attention.some((a) => a.tone === "red") ? ("bad" as const) : ("warn" as const)) : s === "requests" ? ("warn" as const) : undefined,
        }))}
        active={seg}
        onSelect={(s) => setSeg(s as MySeg)}
        ariaLabel={t("me.segments")}
      />

      {seg === "home" && <HrMyHome ctx={ctxData} attention={attention} />}
      {seg === "requests" && <HrMyRequests ctx={ctxData} />}
      {seg === "leave" && <HrMyAttendance ctx={ctxData} />}
      {seg === "pay" && <HrMyPay ctx={ctxData} />}
      {seg === "docs" && <HrMyDocs ctx={ctxData} />}

      {letter && <NewLetterDialog access={access} actor={actor} emp={emp} pay={pay} onClose={() => setLetter(false)} />}
      {asking && (
        <NewRequestDialog
          kind={asking.kind}
          initialField={asking.field}
          onClose={() => setAsking(null)}
          access={access}
          actor={actor}
          emp={emp}
          pay={pay}
          sites={sites}
          existing={requests}
          deciders={{ hr: holders.manager, finance: holders.finance, sheet: site?.supervisorUserId ? memberName(site.supervisorUserId) : null }}
        />
      )}
    </div>
  )
}

/** «mhero» — the greeting, his number · trade · place · manager, the staff chip, and the four tiles. */
function MyHero({ ctx, roles }: { ctx: MyFileCtx; roles: string[] }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const { emp, today, leave } = ctx
  const status = statusOn(emp, today)
  const first = displayName(emp, locale).replace(/^(م\.|أ\.|د\.)\s*/, "").split(" ")[0]
  const lastSlip = ctx.slips.find((s) => s.kind === "main") ?? null
  const nearest = nearestOf(ctx.docs)
  const month = today.slice(0, 7)
  const cur = ctx.att?.m?.[month] ?? null
  const tile = (label: string, value: React.ReactNode, sub?: React.ReactNode, bad = false) => (
    <div className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className={cn("mt-1 truncate text-lg font-black tabular-nums sm:text-xl", bad ? "text-destructive" : "text-foreground")}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-labelledby="me-hello">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-module/10 text-module" aria-hidden="true">
          <CircleUser size={26} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="me-hello" className="text-lg font-black" dir="auto">
              {t("me.hello", { name: first })}
            </h2>
            <StatusPill tone={STATUS_TONE[status]}>{t(`status.${status}`)}</StatusPill>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-bold tabular-nums text-module" dir="ltr">
              #{empNo(emp.no)}
            </span>
            <span>· {t(`trade.${emp.trade}` as "trade.mason")}</span>
            <span>· {ctx.siteName(emp.siteId) ?? t("sites.unassigned")}</span>
            <span>· {t("me.manager_line", { name: ctx.lineManager?.name ?? t("me.holder.management") })}</span>
          </p>
          {roles.length > 0 && <StatusPill tone="info">{t("me.staff_chip", { roles: roles.join("، ") })}</StatusPill>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tile(t("me.tile.leave"), t("file.days", { n: leave.balance }), t("me.tile.leave_sub", { accrued: leave.accrued, taken: leave.taken }), leave.balance < 0)}
        {tile(
          t("me.tile.salary"),
          lastSlip ? <span dir="ltr">{hrMoney(lastSlip.line.net)}</span> : "—",
          lastSlip ? (lastSlip.state === "paid" ? t("me.tile.salary_paid", { month: monthName(lastSlip.month, locale), date: hrDate(lastSlip.paidOn, locale) }) : t(`me.slip_state.${lastSlip.state}`)) : null
        )}
        {tile(
          t("me.tile.document"),
          nearest ? `${t(`doc.${nearest.type}`)}` : "—",
          nearest ? `${hrDate(nearest.expiry, locale)} · ${nearest.left != null && nearest.left < 0 ? t("me.expired_ago", { n: -nearest.left }) : t("file.days_left", { n: nearest.left ?? 0 })}` : null,
          Boolean(nearest && nearest.left != null && nearest.left < 0)
        )}
        {tile(
          t("me.tile.attendance", { month: monthName(month, locale) }),
          ctx.assumed && !cur ? t("file.att_assumed_short") : t("file.days", { n: (cur?.present ?? 0) + (cur?.declared ?? 0) }),
          t("me.tile.attendance_sub", { absent: cur?.absent ?? 0, ot: cur?.ot ?? 0 })
        )}
      </div>
    </section>
  )
}
