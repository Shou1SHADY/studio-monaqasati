"use client"

// Assign someone to the project, or change a live seat's role and duties
// (WF-24, RL-01, RL-07). The duties offered are the role's template; those
// outside the person's system role are shown but cannot be ticked — an
// assignment narrows, it never grants. `other` is named and starts empty.
// Before saving, the dialog says what the person will actually hold here, what
// the system grants him that this role does not, and that his riyal approval
// limit stays as the system set it. Appointing a manager where there is one
// replaces him in the same step (the owner's).

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { Callout } from "@/components/module-ui/Callout"
import { PM_DUTIES, PM_DUTY_GROUPS, PM_PROJECT_ROLES, PM_ROLE_TEMPLATES, PmAccessError, type PmDuty, type PmKey, type PmProjectRole, type PmSeat } from "@/lib/pm/access"
import { pmMoney, todayDay } from "@/lib/pm/format"
import { assignBlocks, defaultTicked, offFromTicked, replacedManager } from "@/lib/pm/team"
import { assignSeat, PmTeamError, type TeamActor } from "@/lib/pm/team-writes"
import { cn } from "@/lib/utils"
import { FormHint } from "./ContractBits"

export interface SeatCandidate {
  uid: string
  name: string
  groupId: string | null
  ceiling: ReadonlySet<PmKey>
  /** His system role as the team page names it (the default group). */
  systemRole?: string | null
  /** His riyal approval limit from the system: "any" = none, null = approves nothing. */
  limit?: "any" | number | null
}

export function AssignSeatDialog({
  open,
  onOpenChange,
  projectId,
  projectManagerId,
  projectManagerName,
  access,
  actor,
  candidates,
  seat,
  fixedUid,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectManagerId: string | null
  /** The current manager's name, for the "replaces him" warning. */
  projectManagerName?: string | null
  access: PmAccess
  actor: TeamActor
  /** People who may be seated; with `seat`, just that person. */
  candidates: SeatCandidate[]
  /** The live seat being changed; absent for a new assignment. */
  seat?: PmSeat | null
  /** A new assignment for one known person (a member seated before PM 1.0). */
  fixedUid?: string | null
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [uid, setUid] = useState<string>("")
  const [role, setRole] = useState<PmProjectRole>("site")
  const [roleName, setRoleName] = useState("")
  const [ticked, setTicked] = useState<PmDuty[]>([])
  const [from, setFrom] = useState(todayDay())
  const [busy, setBusy] = useState(false)
  const today = todayDay()

  useEffect(() => {
    if (!open) return
    if (seat) {
      setUid(seat.uid)
      setRole(seat.role)
      setRoleName(seat.roleName ?? "")
      setTicked(PM_ROLE_TEMPLATES[seat.role].filter((d) => !(seat.off ?? []).includes(d)))
    } else {
      setUid(fixedUid ?? "")
      setRole("site")
      setRoleName("")
      setTicked(defaultTicked("site"))
    }
    setFrom(todayDay())
  }, [open, seat, fixedUid])

  const person = candidates.find((c) => c.uid === uid) ?? null
  const admin = access.ctx.ceiling.has("admin")
  const template = PM_ROLE_TEMPLATES[role]
  const within = (d: PmDuty) => Boolean(person?.ceiling.has(d))
  const effective = ticked.filter((d) => template.includes(d) && within(d))
  const offered = template.filter(within)
  const removedHere = offered.filter((d) => !effective.includes(d))
  const notHere = PM_DUTIES.filter((d) => within(d) && !template.includes(d))
  const replacing = person ? replacedManager({ uid: person.uid, role, projectManagerId }) : null
  const limitText = (l: SeatCandidate["limit"]) => (l === "any" ? t("team.limit_none") : typeof l === "number" ? pmMoney(l) : t("team.limit_no_approval"))

  const pickRole = (r: PmProjectRole) => {
    setRole(r)
    setTicked(seat && r === seat.role ? PM_ROLE_TEMPLATES[r].filter((d) => !(seat.off ?? []).includes(d)) : defaultTicked(r))
  }
  const toggle = (d: PmDuty) => setTicked((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))

  const blocks = useMemo(
    () => assignBlocks({ uid: uid || null, role, roleName, current: seat ?? null, projectManagerId, admin, from: seat ? null : from, today }),
    [uid, role, roleName, seat, projectManagerId, admin, from, today]
  )

  const save = async () => {
    if (!firestore || !person || blocks.length) return
    setBusy(true)
    try {
      await assignSeat(firestore, access.ctx, projectId, actor, {
        uid: person.uid,
        name: person.name,
        role,
        roleName: role === "other" ? roleName : null,
        off: offFromTicked(role, effective),
        groupId: person.groupId,
        from: seat ? null : from,
      })
      toast({ title: t(seat ? "team.saved" : "team.assigned", { name: person.name }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmTeamError && err.blocks[0] ? `team.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(seat ? "team.edit_title" : "team.assign_title")}</DialogTitle>
          <DialogDescription>{t("team.assign_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!seat && !fixedUid && (
            <div className="space-y-1.5">
              <Label htmlFor="seat-person">{t("team.person")}</Label>
              <Select value={uid} onValueChange={setUid} disabled={busy}>
                <SelectTrigger id="seat-person">
                  <SelectValue placeholder={t("team.pick_person")} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">{t("team.no_candidates")}</div>
                  ) : (
                    candidates.map((c) => (
                      <SelectItem key={c.uid} value={c.uid}>
                        <span dir="auto">{c.name}</span>
                        <span className="ms-1.5 text-xs text-muted-foreground">
                          {[c.systemRole, c.limit === null || c.limit === undefined ? t("team.limit_no_approval") : t("team.limit_to", { limit: limitText(c.limit) })].filter(Boolean).join(" · ")}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormHint>{t("team.users_hint")}</FormHint>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="seat-role">{t("team.role")}</Label>
            <Select value={role} onValueChange={(v) => pickRole(v as PmProjectRole)} disabled={busy}>
              <SelectTrigger id="seat-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PM_PROJECT_ROLES.map((r) => (
                  <SelectItem key={r} value={r} disabled={r === "pm" && !admin}>
                    {t(`role.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormHint>{t(`team.role_hint.${role}`)}</FormHint>
          </div>
          {role === "other" && (
            <div className="space-y-1.5">
              <Label htmlFor="seat-role-name">
                {t("team.role_name")} <span className="text-destructive">*</span>
              </Label>
              <Input id="seat-role-name" value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder={t("team.role_name_ph")} disabled={busy} dir="auto" />
              <FormHint>{t("team.role_name_hint")}</FormHint>
              <Callout tone="info" className="mt-1.5">
                {t("team.other_starts_empty")}
              </Callout>
            </div>
          )}
          {role === "pm" && projectManagerId && (!person || replacing) && (
            <Callout tone="warn">
              {t("team.pm_replace_warn", { name: projectManagerName || "—" })}
              {!admin && ` ${t("team.pm_replace_owner")}`}
            </Callout>
          )}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{t("team.duties")}</legend>
            {!person && <p className="text-xs text-muted-foreground">{t("team.pick_person_first")}</p>}
            {PM_DUTY_GROUPS.map((g) => {
              const offered = g.duties.filter((d) => template.includes(d))
              if (!offered.length) return null
              return (
                <div key={g.key} className="space-y-1.5">
                  <p className="text-xs font-bold text-muted-foreground">{t(`duty_group.${g.key}`)}</p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {offered.map((d) => {
                      const allowedHere = within(d)
                      const on = allowedHere && ticked.includes(d)
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          disabled={!allowedHere || busy}
                          onClick={() => toggle(d)}
                          title={allowedHere ? undefined : t("team.outside_ceiling")}
                          className={cn(
                            "flex min-h-11 items-center gap-2.5 rounded-lg border px-3 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                            on ? "border-module/40 bg-module/5 font-semibold" : "hover:border-module/40"
                          )}
                        >
                          <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded border", on ? "border-module bg-module text-white" : "border-input")}>
                            {on && <Check size={13} aria-hidden="true" />}
                          </span>
                          <span className="min-w-0">{t(`duty.${d}`)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {person && template.some((d) => !within(d)) && <p className="text-xs text-muted-foreground">{t("team.ceiling_note")}</p>}
            {person && <FormHint>{t(role === "other" ? "team.duties_hint_other" : "team.duties_hint")}</FormHint>}
          </fieldset>
          {person && (
            <Callout tone={effective.length ? "info" : "warn"} title={t("team.will_have")}>
              <span className="block">{effective.length ? effective.map((d) => t(`duty.${d}`)).join(" · ") : t("team.will_have_none")}</span>
              {removedHere.length > 0 && <span className="mt-1 block text-warning">{t("team.removed_here", { list: removedHere.map((d) => t(`duty.${d}`)).join(" · ") })}</span>}
              {notHere.length > 0 && <span className="mt-1 block text-xs">{t("team.not_here", { list: notHere.map((d) => t(`duty.${d}`)).join(" · ") })}</span>}
              <span className="mt-1 block text-xs">{t("team.limit_stays", { limit: limitText(person.limit ?? null) })}</span>
            </Callout>
          )}
          {person && role === "pm" && (person.limit === null || person.limit === undefined) && <Callout tone="block">{t("team.pm_no_limit", { name: person.name })}</Callout>}
          {!seat && (
            <div className="space-y-1.5">
              <Label htmlFor="seat-from">{t("team.from")}</Label>
              <Input id="seat-from" type="date" dir="ltr" max={today} value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("team.opens_at_once")}</p>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "no_person" || !seat).map((b) => t(`team.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0 || !person}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t(seat ? "team.save" : "team.assign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
