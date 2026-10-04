"use client"

// The workplace's people, for whoever runs the place (PRD DC-07, PN-01, WF-09
// step 1, WF-15 step 1; the prototype's supervisor sheet and drawer): a work
// injury or a violation on another day is recorded HERE — a supervisor has no
// People tab, so the employee file's panels never reach him. Limited to his own
// workplaces (the guard and the rules both check the site). Below, the place's
// injury register with each GOSI deadline — reporting it is government
// relations' (DC-07), so here it is information.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Ambulance, Flag, Loader2, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrPeople } from "@/hooks/useHrPeople"
import { HR_INJURIES } from "@/lib/hr/collections"
import { displayName, type HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { empNo, hrDate, todayDay } from "@/lib/hr/format"
import { injuryState, recordInjury, type HrInjury } from "@/lib/hr/injuries"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
import { HrWriteError } from "@/lib/hr/write-guard"
import { RecordViolationDialog } from "./HrViolationList"

const TONE = { due: "warn", overdue: "bad", reported: "ok" } as const

export function HrSiteWorkers({ access, siteId, actor }: { access: HrAccess; siteId: string; actor: HrActor }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const { employees } = useHrPeople(access.orgId)
  const people = useMemo(() => employees.filter((e) => (e.siteId || UNASSIGNED_SITE) === siteId && e.status !== "left" && e.status !== "expected"), [employees, siteId])
  const site = siteId === UNASSIGNED_SITE ? null : siteId
  const mayInjury = Boolean(site) && access.allowed("injury.record", { site })
  const mayViolation = Boolean(site) && access.allowed("violation.record", { site })
  const injQ = useMemoFirebase(
    () => (firestore && access.orgId && site && access.ctx.roles.size > 0 ? query(collection(firestore, HR_INJURIES), where("organizationId", "==", access.orgId), where("siteId", "==", site)) : null),
    [firestore, access.orgId, site, access.ctx.roles.size]
  )
  const { data: injData } = useCollection(injQ)
  const injuries = ((injData ?? []) as unknown as HrInjury[]).slice().sort((a, b) => b.on.localeCompare(a.on))

  const [injuring, setInjuring] = useState<HrEmployee | null>(null)
  const [violating, setViolating] = useState<HrEmployee | null>(null)
  const [on, setOn] = useState(today)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  // The place is his to see: he runs it, records its attendance, or is management.
  const seesPlace = mayInjury || mayViolation || (Boolean(site) && access.allowed("attendance.record", { site })) || access.ctx.roles.has("management")
  if (!site || !seesPlace || (!mayInjury && !mayViolation && injuries.length === 0)) return null

  const saveInjury = async () => {
    if (!firestore || !access.orgId || !injuring) return
    setBusy(true)
    try {
      await recordInjury(firestore, access.ctx, access.orgId, actor, { employeeId: injuring.id, on, description: text })
      toast({ title: t("inj.recorded_ok") })
      setInjuring(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `inj.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {(mayInjury || mayViolation) && (
        <Panel title={t("siteppl.title")} icon={UsersRound} count={people.length || undefined} bodyClassName="p-0">
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("siteppl.note")}</p>
          {people.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">{t("siteppl.none")}</p>
          ) : (
            <ul className="divide-y">
              {people.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block font-semibold" dir="auto">
                      {e.names ? displayName(e, locale) : "—"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      <span dir="ltr">{empNo(e.no)}</span> · {t(`trade.${e.trade}` as "trade.mason")}
                    </span>
                  </span>
                  {mayInjury && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOn(today)
                        setText("")
                        setInjuring(e)
                      }}
                    >
                      <Ambulance size={14} className="me-1.5" aria-hidden="true" />
                      {t("siteppl.injury")}
                    </Button>
                  )}
                  {mayViolation && (
                    <Button size="sm" variant="outline" onClick={() => setViolating(e)}>
                      <Flag size={14} className="me-1.5" aria-hidden="true" />
                      {t("siteppl.violation")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

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

      <Dialog open={injuring !== null} onOpenChange={(o) => !o && setInjuring(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inj.record")}</DialogTitle>
            <DialogDescription dir="auto">
              {injuring?.names ? displayName(injuring, locale) : ""} — {t("inj.record_desc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sw-inj-on">{t("inj.on")}</Label>
              <Input id="sw-inj-on" type="date" dir="ltr" max={today} value={on} onChange={(e) => setOn(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-inj-text">{t("inj.description")}</Label>
              <Textarea id="sw-inj-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInjuring(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button disabled={busy || !text.trim() || !on || !firestore} onClick={() => void saveInjury()}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {violating && <RecordViolationDialog access={access} actor={actor} employeeId={violating.id} onClose={() => setViolating(null)} />}
    </div>
  )
}
