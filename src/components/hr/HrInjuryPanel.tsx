"use client"

// Work injuries on the employee file (PRD DC-07, WF-15): the register, the
// three-working-day GOSI deadline as a state, recording an injury (the site's
// supervisor or the HR manager) and its report number (government relations).

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Ambulance, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useScopedCollection } from "@/hooks/useScopedCollection"
import { hrPeopleScope, hrScopeAt } from "@/lib/hr/access"
import { HR_INJURIES } from "@/lib/hr/collections"
import type { HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, todayDay } from "@/lib/hr/format"
import { injuryState, recordInjury, recordInjuryReport, type HrInjury } from "@/lib/hr/injuries"
import { HrWriteError } from "@/lib/hr/write-guard"

const TONE = { due: "warn", overdue: "bad", reported: "ok" } as const

export function HrInjuryPanel({ access, actor, emp }: { access: HrAccess; actor: HrActor; emp: HrEmployee }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  // A supervisor reads his own workplaces' injuries only (RL-01): the person's, recorded on this site.
  const { data } = useScopedCollection<HrInjury>(HR_INJURIES, access.orgId, hrScopeAt(hrPeopleScope(access.ctx), emp.siteId), access.ctx.roles.size > 0, [["employeeId", emp.id]])
  const injuries = ((data ?? []) as unknown as HrInjury[]).sort((a, b) => b.on.localeCompare(a.on))
  const [mode, setMode] = useState<{ kind: "record" } | { kind: "report"; inj: HrInjury } | null>(null)
  const [on, setOn] = useState(today)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const mayRecord = access.allowed("injury.record", { site: emp.siteId }) && (Boolean(emp.siteId) || access.allowed("injury.record"))

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
      setMode(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `inj.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  const open = (m: NonNullable<typeof mode>) => {
    setOn(today)
    setText("")
    setMode(m)
  }

  return (
    <Panel
      title={t("inj.title")}
      icon={Ambulance}
      count={injuries.length || undefined}
      actions={
        mayRecord ? (
          <Button size="sm" variant="outline" onClick={() => open({ kind: "record" })}>
            {t("inj.record")}
          </Button>
        ) : null
      }
    >
      {injuries.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t("inj.none")}</p>
      ) : (
        <ul className="divide-y">
          {injuries.map((i) => {
            const st = injuryState(i, today)
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {hrDate(i.on, locale)}
                    <StatusPill tone={TONE[st]}>{t(`inj.state.${st}`, { due: hrDate(i.due, locale) })}</StatusPill>
                  </p>
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {i.description}
                    {i.report && ` · ${t("inj.report_line", { no: i.report.no, on: hrDate(i.report.on, locale) })}`}
                  </p>
                </div>
                {!i.report && access.allowed("injury.report") && (
                  <Button size="sm" onClick={() => open({ kind: "report", inj: i })}>
                    {t("inj.report")}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{mode ? t(mode.kind === "record" ? "inj.record" : "inj.report") : ""}</DialogTitle>
            <DialogDescription dir="auto">{mode?.kind === "record" ? t("inj.record_desc") : emp.names?.ar}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inj-on">{t(mode?.kind === "report" ? "inj.report_on" : "inj.on")}</Label>
              <Input id="inj-on" type="date" dir="ltr" max={today} value={on} onChange={(e) => setOn(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inj-text">{t(mode?.kind === "report" ? "inj.report_no" : "inj.description")}</Label>
              {mode?.kind === "report" ? (
                <Input id="inj-text" dir="ltr" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
              ) : (
                <Textarea id="inj-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy || !text.trim() || !on || !firestore}
              onClick={() =>
                mode?.kind === "report"
                  ? void run(() => recordInjuryReport(firestore!, access.ctx, mode.inj.id, actor, { no: text, on }), "inj.reported_ok")
                  : void run(() => recordInjury(firestore!, access.ctx, access.orgId!, actor, { employeeId: emp.id, on, description: text }), "inj.recorded_ok")
              }
            >
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
