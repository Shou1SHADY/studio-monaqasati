"use client"

// Settings › Team & permissions on a PM 1.0 project (WF-24, RL-01, RL-05,
// RL-07, TM-01). Each person shows their project role, the duties they
// actually hold here (system role ∩ template − removed), who assigned them, and
// the record of who changed or removed them and when. Those who left sit in a
// folded list with their dates and the reason. A project with no manager says
// so in red: only the owner approves on it until one is appointed. Beside it,
// how a person's access here is computed — assignment narrows, never grants.
// Each person also carries his riyal approval limit (seen by holders of money)
// and «no prices» when his system role sees no amounts — both the system's,
// never changed from a project.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, History, Pencil, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { collection, doc } from "firebase/firestore"
import { EyeOff } from "lucide-react"
import { legacyAwareRole, usePermissions } from "@/hooks/usePermissions"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import type { PmAccess } from "@/hooks/usePmAccess"
import { effectiveDuties, mayManageTeam, pmCeiling, PM_ROLE_TEMPLATES, seatActive, seatFromMember, type PmDuty, type PmSeat } from "@/lib/pm/access"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { approvalLimitOf, orderSeats, PM_HANDED_OVER, type SeatLogEntry } from "@/lib/pm/team"
import { resolvePolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_SETTINGS, type ProcurementPolicies } from "@/lib/procurement/types"
import type { TeamGroup } from "@/lib/permissions"
import { AssignSeatDialog, type SeatCandidate } from "./AssignSeatDialog"
import { RemoveSeatDialog } from "./RemoveSeatDialog"

type MemberRow = { id: string; seat: (PmSeat & { why?: string | null; log?: SeatLogEntry[] }) | null; legacy: boolean; addedBy: string | null; byOut: string | null }

export function PmTeamPanel({
  projectId,
  project,
  access,
}: {
  projectId: string
  project: { organizationId?: string; projectManagerId?: string | null; projectManagerName?: string | null }
  access: PmAccess
}) {
  const t = useTranslations("Portal.PM")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { groups, profile } = usePermissions()
  const { orgMembers } = useOrgMembers(project.organizationId)
  const today = todayDay()

  const membersQuery = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, "members") : null), [firestore, projectId])
  const { data: members } = useCollection(membersQuery)

  const [assignOpen, setAssignOpen] = useState(false)
  const [editing, setEditing] = useState<PmSeat | null>(null)
  const [removing, setRemoving] = useState<PmSeat | null>(null)

  const nameOf = (uid: string) => {
    const m = orgMembers.find((x) => x.id === uid)
    return (m?.name as string) || (m?.email as string) || uid
  }
  const ceilingOf = useMemo(() => {
    const byId = new Map(groups.map((g) => [g.id, g.permissions as string[]]))
    return (uid: string) => {
      const m = orgMembers.find((x) => x.id === uid) as Record<string, unknown> | undefined
      return pmCeiling({ owner: legacyAwareRole(m) === "owner", permissions: byId.get((m?.defaultGroupId as string) ?? "") ?? [] })
    }
  }, [groups, orgMembers])
  const groupOf = (uid: string) => ((orgMembers.find((x) => x.id === uid)?.defaultGroupId as string | undefined) ?? null)
  const settingsRef = useMemoFirebase(() => (firestore && project.organizationId ? doc(firestore, PROCUREMENT_SETTINGS, project.organizationId) : null), [firestore, project.organizationId])
  const { data: procSettings } = useDoc(settingsRef)
  const managerLimit = resolvePolicies(procSettings as Partial<ProcurementPolicies> | null).managerApprovalLimit
  const limitOf = (uid: string) => {
    const m = orgMembers.find((x) => x.id === uid) as Record<string, unknown> | undefined
    const g = groups.find((x) => x.id === ((m?.defaultGroupId as string) ?? ""))
    return approvalLimitOf({ owner: legacyAwareRole(m) === "owner", permissions: (g?.permissions as string[] | undefined) ?? [] }, managerLimit)
  }
  const systemRoleOf = (uid: string) => {
    const g = groups.find((x) => x.id === groupOf(uid)) as TeamGroup | undefined
    return g ? (g.key ? tShared(`team_group_${g.key}` as "team_group_viewer") : g.name) : null
  }
  const money = access.has("money")
  const limitPill = (uid: string) => {
    const l = limitOf(uid)
    if (!money || l === null) return null
    return <StatusPill tone="mute">{t("team.limit_pill", { limit: l === "any" ? t("team.limit_none") : pmMoney(l) })}</StatusPill>
  }
  const noPrices = (uid: string) =>
    ceilingOf(uid).has("money") ? null : (
      <StatusPill tone="info">
        <EyeOff size={11} className="me-1 inline" aria-hidden="true" />
        {t("team.no_prices")}
      </StatusPill>
    )

  const rows: MemberRow[] = useMemo(() => {
    const list = (members ?? []).map((m) => {
      const seat = seatFromMember(m as Record<string, unknown>, m.id)
      const str = (v: unknown) => (typeof v === "string" && v ? v : null)
      return { id: m.id, seat: seat ? { ...seat, why: (m.why as string) ?? null, log: (m.log as SeatLogEntry[]) ?? [] } : null, legacy: !seat, addedBy: str(m.addedBy), byOut: str(m.byOut) }
    })
    const seated = orderSeats(list.filter((r) => r.seat).map((r) => ({ ...r.seat!, _row: r })), today).map((s) => s._row)
    return [...seated, ...list.filter((r) => !r.seat)]
  }, [members, today])

  const liveIds = new Set(rows.filter((r) => r.seat && seatActive(r.seat, today)).map((r) => r.id))
  const canManage = mayManageTeam(access.ctx, false)
  const admin = access.ctx.ceiling.has("admin")
  const candidates: SeatCandidate[] = orgMembers
    .filter((m) => !liveIds.has(m.id) && legacyAwareRole(m) !== "owner")
    .map((m) => ({ uid: m.id, name: nameOf(m.id), groupId: groupOf(m.id), ceiling: ceilingOf(m.id), systemRole: systemRoleOf(m.id), limit: limitOf(m.id) }))
  const candidateFor = (uid: string): SeatCandidate[] => [{ uid, name: nameOf(uid), groupId: groupOf(uid), ceiling: ceilingOf(uid), systemRole: systemRoleOf(uid), limit: limitOf(uid) }]
  const actor = { uid: user?.uid ?? "", name: (profile?.name as string) || user?.email || null }

  const logLine = (e: SeatLogEntry) => {
    const who = e.byName || nameOf(e.by)
    const when = pmDate(e.at?.slice(0, 10), locale)
    if (e.act === "remove") return t("team.log_remove", { who, when, date: pmDate(e.to, locale) })
    if (e.act === "duties") return t("team.log_duties", { who, when, role: e.role ? t(`role.${e.role}`) : "—", count: e.off?.length ?? 0 })
    return t("team.log_assign", { who, when, role: e.role ? t(`role.${e.role}`) : "—" })
  }

  const seated = rows.filter((r) => r.seat)
  const liveRows = seated.filter((r) => seatActive(r.seat!, today))
  const leftRows = seated.filter((r) => !seatActive(r.seat!, today))
  const legacyRows = rows.filter((r) => !r.seat)
  const assignedBy = (r: MemberRow) => {
    const first = r.seat?.log?.find((e) => e.act === "assign")
    if (first) return first.byName || nameOf(first.by)
    return r.addedBy ? nameOf(r.addedBy) : null
  }
  const lastDutyChange = (r: MemberRow) => [...(r.seat?.log ?? [])].reverse().find((e) => e.act === "duties")

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel
        className="lg:col-span-2"
        title={
          <span className="inline-flex items-center gap-2">
            {t("team.title")}
            <StatusPill tone={project.projectManagerId ? "mute" : "bad"}>
              <span dir="ltr">{liveIds.size}</span>
            </StatusPill>
          </span>
        }
        icon={Users}
        actions={
          canManage && !access.ctx.archived ? (
            <Button size="sm" onClick={() => setAssignOpen(true)}>
              <UserPlus size={15} className="me-1.5" aria-hidden="true" />
              {t("team.assign")}
            </Button>
          ) : null
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">{t("team.sub")}</p>
        {!project.projectManagerId && !access.ctx.archived && (
          <Callout tone="block" className="mb-4" title={t("team.no_pm_title")}>
            {t("team.no_pm_note")}
          </Callout>
        )}
        <ul className="space-y-2">
          {liveRows.map((r) => {
            const s = r.seat!
            const name = nameOf(r.id)
            const duties = effectiveDuties(ceilingOf(r.id), s) ?? []
            const removed = (s.off ?? []).filter((d) => PM_ROLE_TEMPLATES[s.role].includes(d))
            const mayTouch = canManage && !access.ctx.archived
            const by = assignedBy(r)
            const change = lastDutyChange(r)
            return (
              <li key={r.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <span className="truncate" dir="auto">
                        {name}
                      </span>
                      <StatusPill tone={s.role === "pm" ? "module" : "mute"}>{s.role === "other" && s.roleName ? s.roleName : t(`role.${s.role}`)}</StatusPill>
                      {s.role === "other" && <StatusPill tone="mute">{t("team.custom_role")}</StatusPill>}
                      {r.id === user?.uid && <StatusPill tone="info">{t("team.you")}</StatusPill>}
                      {limitPill(r.id)}
                      {noPrices(r.id)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("team.since", { date: pmDate(s.from, locale) })}
                      {by && ` · ${t("team.assigned_by", { name: by })}`}
                    </p>
                  </div>
                  {mayTouch && (
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                        <Pencil size={14} className="me-1" aria-hidden="true" />
                        {t("team.duties_btn")}
                      </Button>
                      {(s.role !== "pm" || admin) && (
                        <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => setRemoving(s)}>
                          <UserMinus size={14} className="me-1" aria-hidden="true" />
                          {t("team.remove_btn")}
                        </Button>
                      )}
                      {s.role === "pm" && !admin && <span className="text-xs text-muted-foreground">{t("team.pm_owner_changes")}</span>}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {duties.length === 0 ? (
                    <span className="text-xs font-semibold text-warning">{t("team.read_only_here")}</span>
                  ) : (
                    duties.map((d) => (
                      <span key={d} className="rounded-full bg-module/10 px-2 py-0.5 text-[11px] font-bold text-module">
                        {t(`duty.${d}`)}
                      </span>
                    ))
                  )}
                </div>
                {removed.length > 0 && (
                  <p className="mt-1.5 text-xs text-warning">
                    {t("team.removed_duties", { list: removed.map((d) => t(`duty.${d}`)).join("، ") })}
                    {change && ` · ${change.byName || nameOf(change.by)}`}
                  </p>
                )}
                {(s.log?.length ?? 0) > 0 && (
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="flex min-h-8 cursor-pointer items-center gap-1 font-semibold">
                      <History size={13} aria-hidden="true" />
                      {t("team.log", { count: s.log!.length })}
                    </summary>
                    <ul className="mt-1 space-y-0.5 ps-5">
                      {[...s.log!].reverse().map((e, i) => (
                        <li key={`${e.at}-${i}`}>{logLine(e)}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            )
          })}
          {legacyRows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" dir="auto">
                  {nameOf(r.id)}
                </p>
                <p className="text-xs text-muted-foreground">{t("team.legacy_note")}</p>
              </div>
              {canManage && !access.ctx.archived && (
                <Button size="sm" variant="outline" onClick={() => setEditing({ uid: r.id, role: "site", off: [] })}>
                  {t("team.give_role")}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {liveRows.length === 0 && legacyRows.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{t("team.nobody")}</p>}
        <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">{t("team.governance_note")}</p>
        {leftRows.length > 0 && (
          <details className="mt-3 rounded-xl border">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold">
              <History size={14} aria-hidden="true" />
              {t("team.left_title")}
              <StatusPill tone="mute">
                <span dir="ltr">{leftRows.length}</span>
              </StatusPill>
            </summary>
            <ul className="divide-y border-t">
              {leftRows.map((r) => {
                const s = r.seat!
                return (
                  <li key={r.id} className="px-3 py-2">
                    <p className="text-sm font-semibold" dir="auto">
                      {nameOf(r.id)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.role === "other" && s.roleName ? s.roleName : t(`role.${s.role}`)} · {pmDate(s.from, locale)} — {pmDate(s.to, locale)}
                      {s.why && ` · ${s.why === PM_HANDED_OVER ? t("team.pm_handed_over") : s.why}`}
                      {r.byOut && ` · ${nameOf(r.byOut)}`}
                    </p>
                  </li>
                )
              })}
            </ul>
          </details>
        )}
      </Panel>
      <PermHelp
        cut={liveRows
          .map((r) => ({ name: nameOf(r.id), off: (r.seat!.off ?? []).filter((d) => PM_ROLE_TEMPLATES[r.seat!.role].includes(d)) }))
          .filter((x) => x.off.length > 0)}
      />

      <AssignSeatDialog
        open={assignOpen || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAssignOpen(false)
            setEditing(null)
          }
        }}
        projectId={projectId}
        projectManagerId={project.projectManagerId ?? null}
        projectManagerName={project.projectManagerName ?? (project.projectManagerId ? nameOf(project.projectManagerId) : null)}
        access={access}
        actor={actor}
        candidates={editing ? candidateFor(editing.uid) : candidates}
        seat={editing && rows.find((r) => r.id === editing.uid)?.seat ? editing : null}
        fixedUid={editing?.uid ?? null}
      />
      {removing && (
        <RemoveSeatDialog open onOpenChange={(o) => !o && setRemoving(null)} projectId={projectId} access={access} actor={actor} seat={removing} name={nameOf(removing.uid)} />
      )}
    </div>
  )
}

function PermHelp({ cut }: { cut: Array<{ name: string; off: PmDuty[] }> }) {
  const t = useTranslations("Portal.PM")
  const step = (title: string, body: string) => (
    <li className="flex gap-2.5">
      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
    </li>
  )
  return (
    <Panel title={t("team.help.title")} icon={ShieldCheck} className="self-start">
      <ul className="space-y-3">
        {step(t("team.help.s1"), t("team.help.s1_note"))}
        {step(t("team.help.s2"), t("team.help.s2_note"))}
        {step(t("team.help.s3"), t("team.help.s3_note"))}
      </ul>
      <Callout tone="info" className="mt-3" title={t("team.help.rule")}>
        {t("team.help.rule_note")}
      </Callout>
      {cut.length > 0 && (
        <Callout tone="warn" className="mt-2.5">
          {t("team.help.cut", { count: cut.length, list: cut.map((c) => `${c.name} (${c.off.map((d) => t(`duty.${d}`)).join("، ")})`).join(" · ") })}
        </Callout>
      )}
    </Panel>
  )
}

/** File › Contract details: the project's team at a glance (the prototype's
 * fileTeam) — role here, the system role, the riyal approval limit (holders of
 * money) and «no prices» for a person whose system role sees no amounts. */
export function PmTeamRoster({ projectId, project, access }: { projectId: string; project: { organizationId?: string; projectManagerId?: string | null }; access: PmAccess }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { groups } = usePermissions()
  const { orgMembers } = useOrgMembers(project.organizationId)
  const today = todayDay()
  const membersQuery = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, "members") : null), [firestore, projectId])
  const { data: members } = useCollection(membersQuery)
  const settingsRef = useMemoFirebase(() => (firestore && project.organizationId ? doc(firestore, PROCUREMENT_SETTINGS, project.organizationId) : null), [firestore, project.organizationId])
  const { data: procSettings } = useDoc(settingsRef)
  const managerLimit = resolvePolicies(procSettings as Partial<ProcurementPolicies> | null).managerApprovalLimit
  const money = access.has("money")

  const people = useMemo(() => {
    const seats = (members ?? []).map((m) => seatFromMember(m as Record<string, unknown>, m.id)).filter((s): s is PmSeat => Boolean(s && seatActive(s, today)))
    return orderSeats(seats, today).map((s) => {
      const m = orgMembers.find((x) => x.id === s.uid) as Record<string, unknown> | undefined
      const perms = (groups.find((g) => g.id === ((m?.defaultGroupId as string) ?? ""))?.permissions as string[] | undefined) ?? []
      const owner = legacyAwareRole(m) === "owner"
      return {
        seat: s,
        name: (m?.name as string) || (m?.email as string) || s.uid,
        limit: approvalLimitOf({ owner, permissions: perms }, managerLimit),
        prices: pmCeiling({ owner, permissions: perms }).has("money"),
      }
    })
  }, [members, orgMembers, groups, managerLimit, today])

  return (
    <Panel title={t("team.roster_title")} icon={Users}>
      <p className="mb-2 text-xs text-muted-foreground">{t("team.roster_sub")}</p>
      {people.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">{t("team.nobody")}</p>
      ) : (
        <ul className="divide-y">
          {people.map((p) => (
            <li key={p.seat.uid} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" dir="auto">
                  {p.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.seat.role === "other" && p.seat.roleName ? p.seat.roleName : t(`role.${p.seat.role}`)}
                  {p.seat.uid === project.projectManagerId && ` · ${t("team.manager_here")}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {money && p.limit !== null && <StatusPill tone="mute">{t("team.limit_pill", { limit: p.limit === "any" ? t("team.limit_none") : pmMoney(p.limit) })}</StatusPill>}
                {!p.prices && (
                  <StatusPill tone="info">
                    <EyeOff size={11} className="me-1 inline" aria-hidden="true" />
                    {t("team.no_prices")}
                  </StatusPill>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
