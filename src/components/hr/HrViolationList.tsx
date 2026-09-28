"use client"

// Violations and penalties as a list (PRD form 12, WF-09): what happened, the
// state, the step and — for pay roles — the amount; the HR manager decides
// after a hearing, then decides any objection; the employee objects within 15
// days. A new violation is recorded by hand from the employee's file.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { HR_VIOLATIONS } from "@/lib/hr/collections"
import type { EmployeePay } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { wageOf } from "@/lib/hr/pay"
import { VIOLATION_CODES, type ViolationCode } from "@/lib/hr/penalties"
import { decideObjection, decidePenalty, objectPenalty, recordViolation } from "@/lib/hr/violation-writes"
import { applyQuote, historyOf, mayObject, type HrViolation, type ViolationState } from "@/lib/hr/violations"
import { HrWriteError } from "@/lib/hr/write-guard"

export const VIOLATION_TONE: Record<ViolationState, PillTone> = { recorded: "warn", applied: "bad", dismissed: "mute", objected: "violet", upheld: "bad", cancelled: "mute" }

/** The violations a viewer may read: pay roles all of the org's, everyone his own. */
export function useHrViolations(access: HrAccess) {
  const firestore = useFirestore()
  const orgId = access.orgId
  const all = access.allowed("pay.view")
  const q = useMemoFirebase(
    () =>
      firestore && orgId && access.ctx.uid
        ? all
          ? query(collection(firestore, HR_VIOLATIONS), where("organizationId", "==", orgId))
          : query(collection(firestore, HR_VIOLATIONS), where("organizationId", "==", orgId), where("employeeUserId", "==", access.ctx.uid))
        : null,
    [firestore, orgId, all, access.ctx.uid]
  )
  const { data } = useCollection(q)
  return useMemo(() => ((data ?? []) as unknown as HrViolation[]).slice().sort((a, b) => b.on.localeCompare(a.on)), [data])
}

/** What waits for the HR manager: recorded (decide after a hearing) and objected (decide the objection). */
export const violationWaits = (access: HrAccess, v: HrViolation) =>
  access.allowed("penalty.apply") && (v.state === "recorded" || v.state === "objected") && (access.ctx.owner || access.ctx.employeeId !== v.employeeId)

type Acting = { v: HrViolation; mode: "decide" | "objection" | "object" }

export function HrViolationList({ access, actor, violations, all, pay, showEmployee = true, empty }: { access: HrAccess; actor: HrActor; violations: HrViolation[]; all: HrViolation[]; pay?: EmployeePay | null; showEmployee?: boolean; empty: string }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [acting, setActing] = useState<Acting | null>(null)
  const [hearingOn, setHearingOn] = useState("")
  const [hearingNote, setHearingNote] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (!firestore) return
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
      setActing(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `vio.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  const quote = acting?.mode === "decide" ? applyQuote(acting.v, { hearingOn: hearingOn || null, today, wage: pay ? wageOf(pay) : 1, history: historyOf(all, acting.v.employeeId, acting.v.id) }) : null

  if (violations.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>

  return (
    <>
      <ul className="divide-y rounded-xl border">
        {violations.map((v) => {
          const own = access.ctx.employeeId === v.employeeId
          const acts: Acting["mode"][] = []
          if (violationWaits(access, v)) acts.push(v.state === "recorded" ? "decide" : "objection")
          if (own && mayObject(v, today)) acts.push("object")
          return (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-60 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">{t(`violation.${v.code}`)}</span>
                  {showEmployee && (
                    <span className="font-semibold text-muted-foreground" dir="auto">
                      {v.employeeName}
                    </span>
                  )}
                  <StatusPill tone={VIOLATION_TONE[v.state]}>{t(`vio.state.${v.state}`)}</StatusPill>
                </p>
                <p className="text-xs text-muted-foreground">
                  {hrDate(v.on, locale)} · {t(`vio.source.${v.source}`)}
                  {v.step != null && ` · ${t("vio.step", { n: v.step + 1 })}`}
                  {v.stepKind && ` · ${t(`vio.kind.${v.stepKind}`)}`}
                  {(v.amount ?? 0) > 0 && access.seesPay(v.employeeId) && ` · ${hrMoney(v.amount)}`}
                </p>
                {v.objection && (
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {t("vio.objection_text", { text: v.objection.text })}
                  </p>
                )}
              </div>
              {acts.map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant={a === "object" ? "outline" : "default"}
                  onClick={() => {
                    setHearingOn("")
                    setHearingNote("")
                    setNote("")
                    setActing({ v, mode: a })
                  }}
                >
                  {t(`vio.act.${a}`)}
                </Button>
              ))}
            </li>
          )
        })}
      </ul>

      <Dialog open={acting !== null} onOpenChange={(o) => !o && setActing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{acting ? t(`vio.act.${acting.mode}`) : ""}</DialogTitle>
            <DialogDescription>{acting ? `${t(`violation.${acting.v.code}`)} · ${acting.v.employeeName} · ${hrDate(acting.v.on, locale)}` : ""}</DialogDescription>
          </DialogHeader>
          {acting?.mode === "decide" && quote && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="vio-hearing">{t("vio.hearing_on")}</Label>
                  <Input id="vio-hearing" type="date" dir="ltr" min={acting.v.on} max={today} value={hearingOn} onChange={(e) => setHearingOn(e.target.value)} disabled={busy} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vio-hnote">{t("vio.hearing_note")}</Label>
                  <Input id="vio-hnote" value={hearingNote} onChange={(e) => setHearingNote(e.target.value)} disabled={busy} />
                </div>
              </div>
              <div className="rounded-xl border p-3">
                <KeyValueRow label={t("vio.step_label")} value={t("vio.step", { n: quote.step + 1 })} />
                <KeyValueRow label={t("vio.penalty")} value={t(`vio.kind.${quote.stepKind}`)} />
                {pay && quote.amount > 0 && <KeyValueRow label={t("vio.amount")} value={hrMoney(quote.amount)} ltr strong />}
              </div>
              <p className="text-xs text-muted-foreground">{t("vio.cap_note")}</p>
              <BlockingReasons title={t("vio.cannot_apply")} reasons={quote.blocks.filter((b) => b !== "no_wage" || Boolean(pay)).map((b) => t(`vio.block.${b}`))} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="vio-note">{t(acting?.mode === "object" ? "vio.object_text" : "vio.note")}</Label>
            <Textarea id="vio-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            {acting?.mode === "decide" && (
              <>
                <Button variant="outline" disabled={busy || !note.trim()} onClick={() => void run(() => decidePenalty(firestore!, access.ctx, acting.v.id, actor, { verdict: "dismiss", note }, { history: [] }), "vio.done.dismissed")}>
                  {t("vio.dismiss")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || Boolean(quote?.blocks.length)}
                  onClick={() => void run(() => decidePenalty(firestore!, access.ctx, acting.v.id, actor, { verdict: "apply", hearingOn, hearingNote, note }, { history: historyOf(all, acting.v.employeeId, acting.v.id) }), "vio.done.applied")}
                >
                  {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                  {t("vio.apply")}
                </Button>
              </>
            )}
            {acting?.mode === "objection" && (
              <>
                <Button variant="outline" disabled={busy || !note.trim()} onClick={() => void run(() => decideObjection(firestore!, access.ctx, acting.v.id, actor, "cancel", note), "vio.done.cancelled")}>
                  {t("vio.cancel_penalty")}
                </Button>
                <Button variant="destructive" disabled={busy || !note.trim()} onClick={() => void run(() => decideObjection(firestore!, access.ctx, acting.v.id, actor, "uphold", note), "vio.done.upheld")}>
                  {t("vio.uphold")}
                </Button>
              </>
            )}
            {acting?.mode === "object" && (
              <Button disabled={busy || !note.trim()} onClick={() => void run(() => objectPenalty(firestore!, access.ctx, acting.v.id, actor, note), "vio.done.objected")}>
                {t("vio.act.object")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Record a violation by hand (the HR manager, or the site's supervisor). */
export function RecordViolationDialog({ access, actor, employeeId, onClose }: { access: HrAccess; actor: HrActor; employeeId: string; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [code, setCode] = useState<ViolationCode>("late15")
  const [on, setOn] = useState(today)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!firestore || !access.orgId) return
    setBusy(true)
    try {
      await recordViolation(firestore, access.ctx, access.orgId, actor, { employeeId, code, on, note })
      toast({ title: t("vio.done.recorded") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `vio.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("vio.record")}</DialogTitle>
          <DialogDescription>{t("vio.record_desc")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rv-code">{t("vio.code")}</Label>
            <Select value={code} onValueChange={(x) => setCode(x as ViolationCode)} disabled={busy}>
              <SelectTrigger id="rv-code">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIOLATION_CODES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`violation.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-on">{t("vio.on")}</Label>
            <Input id="rv-on" type="date" dir="ltr" max={today} value={on} onChange={(e) => setOn(e.target.value)} disabled={busy} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rv-note">{t("vio.note")}</Label>
          <Textarea id="rv-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !on}>
            {t("vio.record")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
