"use client"

// Settings › Team & permissions on a PM 1.0 project (WF-24, RL-01, RL-05,
// RL-07, TM-01). Each person shows their project role, the duties they
// actually hold here (system role ∩ template − removed), and the record of who
// assigned, changed or removed them and when. Someone who left stays listed,
// greyed, with the date and the reason. A project with no manager says so in
// red: only the owner approves on it until one is appointed.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { History, Pencil, UserMinus, UserPlus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { collection } from "firebase/firestore"
import { legacyAwareRole, usePermissions } from "@/hooks/usePermissions"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import type { PmAccess } from "@/hooks/usePmAccess"
import { effectiveDuties, mayManageTeam, pmCeiling, PM_ROLE_TEMPLATES, seatActive, seatFromMember, type PmSeat } from "@/lib/pm/access"
import { pmDate, todayDay } from "@/lib/pm/format"
import { orderSeats, type SeatLogEntry } from "@/lib/pm/team"
import { AssignSeatDialog, type SeatCandidate } from "./AssignSeatDialog"
import { RemoveSeatDialog } from "./RemoveSeatDialog"

type MemberRow = { id: string; seat: (PmSeat & { why?: string | null; log?: SeatLogEntry[] }) | null; legacy: boolean }

export function PmTeamPanel({
  projectId,
  project,
  access,
}: {
  projectId: string
  project: { organizationId?: string; projectManagerId?: string | null }
  access: PmAccess
}) {
  const t = useTranslations("Portal.PM")
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

  const rows: MemberRow[] = useMemo(() => {
    const list = (members ?? []).map((m) => {
      const seat = seatFromMember(m as Record<string, unknown>, m.id)
      return { id: m.id, seat: seat ? { ...seat, why: (m.why as string) ?? null, log: (m.log as SeatLogEntry[]) ?? [] } : null, legacy: !seat }
    })
    const seated = orderSeats(list.filter((r) => r.seat).map((r) => ({ ...r.seat!, _row: r })), today).map((s) => s._row)
    return [...seated, ...list.filter((r) => !r.seat)]
  }, [members, today])

  const liveIds = new Set(rows.filter((r) => r.seat && seatActive(r.seat, today)).map((r) => r.id))
  const canManage = mayManageTeam(access.ctx, false)
  const admin = access.ctx.ceiling.has("admin")
  const candidates: SeatCandidate[] = orgMembers
    .filter((m) => !liveIds.has(m.id) && legacyAwareRole(m) !== "owner")
    .map((m) => ({ uid: m.id, name: nameOf(m.id), groupId: groupOf(m.id), ceiling: ceilingOf(m.id) }))
  const candidateFor = (uid: string): SeatCandidate[] => [{ uid, name: nameOf(uid), groupId: groupOf(uid), ceiling: ceilingOf(uid) }]
  const actor = { uid: user?.uid ?? "", name: (profile?.name as string) || user?.email || null }

  const logLine = (e: SeatLogEntry) => {
    const who = e.byName || nameOf(e.by)
    const when = pmDate(e.at?.slice(0, 10), locale)
    if (e.act === "remove") return t("team.log_remove", { who, when, date: pmDate(e.to, locale) })
    if (e.act === "duties") return t("team.log_duties", { who, when, role: e.role ? t(`role.${e.role}`) : "—", count: e.off?.length ?? 0 })
    return t("team.log_assign", { who, when, role: e.role ? t(`role.${e.role}`) : "—" })
  }

  return (
    <Panel
      title={t("team.title")}
      icon={Users}
      count={liveIds.size}
      actions={
        canManage && !access.ctx.archived ? (
          <Button size="sm" onClick={() => setAssignOpen(true)}>
            <UserPlus size={15} className="me-1.5" aria-hidden="true" />
            {t("team.assign")}
          </Button>
        ) : null
      }
    >
      {!project.projectManagerId && !access.ctx.archived && (
        <Callout tone="block" className="mb-4" title={t("team.no_pm_title")}>
          {t("team.no_pm_note")}
        </Callout>
      )}
      <ul className="space-y-2">
        {rows.map((r) => {
          const name = nameOf(r.id)
          if (!r.seat) {
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{name}</p>
                  <p className="text-xs text-muted-foreground">{t("team.legacy_note")}</p>
                </div>
                {canManage && !access.ctx.archived && (
                  <Button size="sm" variant="outline" onClick={() => setEditing({ uid: r.id, role: "site", off: [] })}>
                    {t("team.give_role")}
                  </Button>
                )}
              </li>
            )
          }
          const s = r.seat
          const live = seatActive(s, today)
          const duties = live ? effectiveDuties(ceilingOf(r.id), s) ?? [] : []
          const removed = (s.off ?? []).filter((d) => PM_ROLE_TEMPLATES[s.role].includes(d))
          const mayTouch = canManage && !access.ctx.archived && live && (s.role !== "pm" || admin)
          return (
            <li key={r.id} className={live ? "rounded-xl border p-3" : "rounded-xl border bg-muted/40 p-3 opacity-75"}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{name}</span>
                    <StatusPill tone={s.role === "pm" ? "module" : "mute"}>{s.role === "other" && s.roleName ? s.roleName : t(`role.${s.role}`)}</StatusPill>
                    {!live && <StatusPill tone="bad">{t("team.left")}</StatusPill>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {live ? t("team.since", { date: pmDate(s.from, locale) }) : t("team.left_on", { date: pmDate(s.to, locale), why: s.why || "—" })}
                  </p>
                </div>
                {mayTouch && (
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)} aria-label={t("team.edit_title")}>
                      <Pencil size={14} aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => setRemoving(s)} aria-label={t("team.remove")}>
                      <UserMinus size={14} aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>
              {live && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {duties.length === 0 ? (
                    <span className="text-xs font-semibold text-destructive">{t("team.no_duties")}</span>
                  ) : (
                    duties.map((d) => (
                      <span key={d} className="rounded-full bg-module/10 px-2 py-0.5 text-[11px] font-bold text-module">
                        {t(`duty.${d}`)}
                      </span>
                    ))
                  )}
                  {removed.length > 0 && <span className="text-[11px] text-muted-foreground">{t("team.removed_duties", { list: removed.map((d) => t(`duty.${d}`)).join("، ") })}</span>}
                </div>
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
      </ul>

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
        access={access}
        actor={actor}
        candidates={editing ? candidateFor(editing.uid) : candidates}
        seat={editing && rows.find((r) => r.id === editing.uid)?.seat ? editing : null}
        fixedUid={editing?.uid ?? null}
      />
      {removing && (
        <RemoveSeatDialog open onOpenChange={(o) => !o && setRemoving(null)} projectId={projectId} access={access} actor={actor} seat={removing} name={nameOf(removing.uid)} />
      )}
    </Panel>
  )
}
