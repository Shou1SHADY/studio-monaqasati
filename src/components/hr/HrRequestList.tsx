"use client"

// Requests as a list (PRD §5 "Requests", LV-05, WF-07/08, form 11): number,
// person, what is asked, where it stands, and only the actions this viewer
// holds — endorse, approve, decline (a reason is required), cancel before it
// starts. A decision states its facts before it is taken (PRD §5 "blocking
// facts before sending"): a leave — the balance as of its start, the sick days
// used of 120, the endorsement, the riyals unpaid days cost, the ticket; an
// advance — the wage, HR's limit, what is still outstanding, the instalment
// schedule. What blocks disables the button. An amount shows only to those who
// may see pay (RL-03).

import { useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { getDownloadURL, ref } from "firebase/storage"
import { Loader2, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useDoc, useFirestore, useMemoFirebase, useStorage, useUser } from "@/firebase"
import { useEmployeePay } from "@/hooks/useHrPeople"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { Link } from "@/i18n/routing"
import { HR_EMPLOYEES } from "@/lib/hr/collections"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { cancelRequest, decideRequest, endorseRequest, recordReturn } from "@/lib/hr/request-writes"
import { leaveDays, leaveEndAfter, LEAVE_RULES } from "@/lib/hr/leave"
import { wageOf } from "@/lib/hr/pay"
import {
  aboveBalance,
  advanceQuote,
  instalmentSchedule,
  leaveQuote,
  LEAVE_MODES,
  mayCancel,
  requestActions,
  requestNoDisplay,
  sickUsedIn,
  type HrRequest,
  type HrRequestState,
  type LeaveMode,
  type RequestAction,
} from "@/lib/hr/requests"
import { STATUTORY } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import type { HrPortal } from "./HrShell"

export const REQUEST_TONE: Record<HrRequestState, PillTone> = { pending: "warn", endorsed: "info", approved: "ok", declined: "bad", finance: "violet", cancelled: "mute" }

type T = ReturnType<typeof useTranslations<"Portal.HR">>

/** ES-02 — what a request asks, in a line: a leave's type, days and first day; an advance's amount (pay
 * roles and the employee only); the field a data update changes (its value for HR); a correction's day. */
export function describeRequest(t: T, r: HrRequest, locale: string, opts: { money: boolean; value?: boolean }): string {
  if (r.kind === "leave" && r.leave) return t("req.desc.leave", { type: t(`leave_type.${r.leave.type}`), days: r.leave.days, date: hrDate(r.leave.from, locale) })
  if (r.kind === "advance" && r.advance) return opts.money ? t("req.desc.advance", { amount: hrMoney(r.advance.amount) }) : t("req.kind.advance")
  if (r.kind === "data" && r.data) {
    const base = t("req.desc.data", { field: t(`data_field.${r.data.field}`) })
    if (!opts.value) return base
    const v = r.data.field === "iban" && !opts.money ? "•••" : r.data.value
    return `${base}: ${v}${r.data.document ? ` · ${t("req.document_ref", { ref: r.data.document })}` : ""}`
  }
  if (r.kind === "attfix" && r.attfix) return t("req.desc.attfix", { type: t(`req.attfix_type.${r.attfix.type}`), date: hrDate(r.attfix.day, locale) })
  return t(`req.kind.${r.kind}`)
}

type Acting = { r: HrRequest; action: Exclude<RequestAction, "finance"> }

export function HrRequestList({
  access,
  requests,
  portal,
  showEmployee = true,
  empty,
  rowFacts,
}: {
  access: HrAccess
  requests: HrRequest[]
  portal?: HrPortal
  showEmployee?: boolean
  empty: string
  /** Today's facts line under a request (balance and endorsement, wage and instalment — TD-02). */
  rowFacts?: (r: HrRequest) => ReactNode
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile } = usePermissions()
  const { toast } = useToast()
  const today = todayDay()
  const [acting, setActing] = useState<Acting | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const actor = { uid: user?.uid ?? "", name: (profile?.name as string) || null }
  const what = (r: HrRequest) => describeRequest(t, r, locale, { money: access.seesPay(r.employeeId), value: true })

  const [mode, setMode] = useState<LeaveMode | null>(null)
  const over = acting?.action === "approve" ? aboveBalance(acting.r) : 0
  // The facts the decision reads (loaded only while a decision dialog is open).
  const deciding = acting?.action === "approve" && (acting.r.kind === "leave" || acting.r.kind === "advance") ? acting.r : null
  const facts = useDecisionFacts(access, deciding, over > 0 ? mode : null)

  const run = async () => {
    if (!firestore || !acting) return
    const { r, action } = acting
    setBusy(true)
    try {
      if (action === "endorse") await endorseRequest(firestore, access.ctx, r.id, actor, note)
      else if (action === "cancel") await cancelRequest(firestore, access.ctx, r.id, actor, note)
      else {
        const res = await decideRequest(firestore, access.ctx, r.id, actor, action, note, { policies: access.settings.policies, leaveMode: action === "approve" && over > 0 ? mode : null })
        if (res.state === "finance") {
          toast({ title: t("req.to_finance") })
          setActing(null)
          return
        }
      }
      toast({ title: t(`req.done.${action}`) })
      setActing(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `req.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (requests.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>

  const needsNote = acting?.action === "decline" || acting?.action === "cancel"

  return (
    <>
      <ul className="divide-y rounded-xl border">
        {requests.map((r) => {
          const acts = requestActions(access.ctx, r, { today, financeAllowed: false }).filter((a): a is Acting["action"] => a !== "finance")
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-60 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold tabular-nums" dir="ltr">
                    {requestNoDisplay(r.no, locale)}
                  </span>
                  {showEmployee &&
                    (portal ? (
                      <Link href={`/${portal}/hr/people/${r.employeeId}`} className="rounded font-semibold hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                        {r.employeeName}
                      </Link>
                    ) : (
                      <span className="font-semibold" dir="auto">
                        {r.employeeName}
                      </span>
                    ))}
                  <StatusPill tone={REQUEST_TONE[r.state]}>{t(`req.state.${r.state}`)}</StatusPill>
                  {r.deciderLevel === "management" && r.kind !== "attfix" && <StatusPill tone="violet">{t("req.to_management")}</StatusPill>}
                </p>
                <p className="text-xs text-muted-foreground">{what(r)}</p>
                {rowFacts?.(r)}
                {r.kind === "attfix" && r.attfix && (
                  <p className="text-xs text-muted-foreground" dir="auto">
                    “{r.attfix.reason}”
                  </p>
                )}
                {(r.decision?.note || r.finance?.note || r.cancel?.note) && (
                  <p className="text-xs text-muted-foreground" dir="auto">
                    “{r.finance?.note || r.cancel?.note || r.decision?.note}”
                  </p>
                )}
              </div>
              {acts.length > 0 && (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {acts.map((a) => (
                    <Button
                      key={a}
                      size="sm"
                      variant={a === "approve" || a === "endorse" ? "default" : "outline"}
                      onClick={() => {
                        setNote("")
                        setMode(null)
                        setActing({ r, action: a })
                      }}
                    >
                      {t(`req.act.${a}`)}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <Dialog open={acting !== null} onOpenChange={(o) => !o && setActing(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{acting ? t(`req.act.${acting.action}`) : ""}</DialogTitle>
            <DialogDescription>{acting ? `${requestNoDisplay(acting.r.no, locale)} · ${acting.r.employeeName} · ${what(acting.r)}` : ""}</DialogDescription>
          </DialogHeader>
          {acting?.r.kind === "advance" && acting.r.advance?.reason && (
            <p className="text-sm text-muted-foreground" dir="auto">
              {t("me.reason", { text: acting.r.advance.reason })}
            </p>
          )}
          {acting?.r.kind === "attfix" && acting.r.attfix && (
            <div className="rounded-xl border p-3">
              <KeyValueRow label={t("req.attfix.type")} value={t(`req.attfix_type.${acting.r.attfix.type}`)} />
              <KeyValueRow label={t("req.attfix.day")} value={hrDate(acting.r.attfix.day, locale)} />
              <KeyValueRow label={t("req.reason")} value={<span dir="auto">{acting.r.attfix.reason}</span>} />
              {acting.action === "approve" && <p className="pt-2 text-[11px] text-muted-foreground">{t("req.attfix.approve_note")}</p>}
            </div>
          )}
          {acting?.r.kind === "data" && acting.r.data?.file && <OpenDataFile path={acting.r.data.file.path} name={acting.r.data.file.name} />}
          {facts && <FactsView facts={facts} />}
          {acting?.r.kind === "advance" && acting.action === "approve" && acting.r.advance?.overLimit && <p className="text-sm text-muted-foreground">{t("req.over_limit_note")}</p>}
          {acting?.r.leave && over > 0 && (
            // LV-03 — a full annual leave above the balance is never approved: HR chooses.
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">{t("req.mode.title", { n: over })}</legend>
              {LEAVE_MODES.map((m) => (
                <label key={m} className={cn("flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm", mode === m && "border-module bg-module/5")}>
                  <input type="radio" name="leave-mode" className="mt-1" checked={mode === m} onChange={() => setMode(m)} disabled={busy} />
                  <span>
                    <span className="block font-semibold">{t(`req.mode.${m}`)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {m === "balance_only"
                        ? acting.r.leave!.balance > 0
                          ? t("req.mode.balance_only_line", { n: acting.r.leave!.balance, date: hrDate(leaveEndAfter(acting.r.leave!.from, acting.r.leave!.balance), locale) })
                          : t("req.block.no_balance")
                        : facts?.dayRate
                          ? t("req.mode.excess_unpaid_money", { n: over, amount: hrMoney(Math.round(facts.dayRate * over)) })
                          : t("req.mode.excess_unpaid_line", { n: over })}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {facts && <BlockingReasons title={t("req.cannot_approve")} reasons={facts.blocks.map((b) => t(`req.block.${b}`))} />}
          <div className="space-y-1.5">
            <Label htmlFor="req-note">{t(needsNote ? "req.reason_required" : "req.note")}</Label>
            <Textarea id="req-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              onClick={() => void run()}
              disabled={busy || (needsNote && !note.trim()) || (over > 0 && !mode) || Boolean(facts && (facts.loading || facts.blocks.length > 0))}
              variant={acting?.action === "decline" || acting?.action === "cancel" ? "destructive" : "default"}
            >
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {acting?.r.kind === "advance" && acting.action === "approve" && acting.r.advance?.overLimit ? t("req.act.recommend") : acting ? t(`req.act.${acting.action}`) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// The facts a decision reads (leave form, advance form)
// ---------------------------------------------------------------------------

interface DecisionFacts {
  loading: boolean
  rows: Array<{ key: string; label: string; value: string; strong?: boolean }>
  warnings: string[]
  blocks: string[]
  /** wage / 30 — the riyals one unpaid day costs (pay roles only). */
  dayRate: number | null
}

function useDecisionFacts(access: HrAccess, r: HrRequest | null, mode: LeaveMode | null): DecisionFacts | null {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const id = r?.employeeId ?? null
  const ref = useMemoFirebase(() => (firestore && id ? doc(firestore, HR_EMPLOYEES, id) : null), [firestore, id])
  const { data, isLoading } = useDoc(ref)
  const money = Boolean(id && access.seesPay(id))
  const { pay, isLoading: payLoading } = useEmployeePay(id, money)
  if (!r) return null
  const emp = (data as unknown as HrEmployee | null) ?? null
  if (!emp || isLoading || (money && payLoading)) return { loading: true, rows: [], warnings: [], blocks: [], dayRate: null }
  return r.kind === "leave" ? leaveFacts(t, locale, emp, money ? pay : null, r, mode) : advanceFacts(t, access, emp, money ? pay : null, r)
}

function leaveFacts(t: T, locale: string, emp: HrEmployee, pay: EmployeePay | null, r: HrRequest, mode: LeaveMode | null): DecisionFacts {
  const l = r.leave!
  const q = leaveQuote(emp, { type: l.type, from: l.from, to: l.to, mode: mode ?? (l.unpaidDays > 0 && LEAVE_RULES[l.type].fromBalance ? "excess_unpaid" : null) }, { deciding: true })
  const holidays = Math.max(0, Math.round((Date.parse(l.to) - Date.parse(l.from)) / 86_400_000) + 1 - leaveDays(l.from, l.to))
  const wage = pay ? wageOf(pay) : 0
  const dayRate = wage > 0 ? wage / STATUTORY.monthDays : null
  const rows: DecisionFacts["rows"] = []
  if (LEAVE_RULES[l.type].fromBalance) rows.push({ key: "bal", label: t("req.fact.balance_at", { date: hrDate(l.from, locale) }), value: t("file.days", { n: q.balance }), strong: true })
  if (holidays > 0) rows.push({ key: "hol", label: t("req.fact.holidays"), value: t("file.days", { n: holidays }) })
  if (l.type === "sick") rows.push({ key: "sick", label: t("req.fact.sick_used"), value: t("req.fact.of_120", { n: sickUsedIn(emp, l.from) }) })
  rows.push({ key: "end", label: t("req.fact.endorsement"), value: r.endorsement ? t("req.fact.endorsed_by", { name: r.endorsement.byName ?? "—" }) : t("req.fact.no_endorsement") })
  if (q.unpaidDays > 0 && dayRate) rows.push({ key: "unpaid", label: t("req.fact.unpaid_cost", { n: q.unpaidDays }), value: hrMoney(Math.round(dayRate * q.unpaidDays)) })
  if (emp.nationality !== "sa" && l.type === "annual") rows.push({ key: "ticket", label: t("req.fact.ticket"), value: t("req.fact.ticket_due") })
  // Above the balance is chosen with the radio buttons, not listed as a block.
  return { loading: false, rows, warnings: [], blocks: q.blocks.filter((b) => b !== "above_balance"), dayRate }
}

function advanceFacts(t: T, access: HrAccess, emp: HrEmployee, pay: EmployeePay | null, r: HrRequest): DecisionFacts {
  const a = r.advance!
  if (!pay) return { loading: false, rows: [], warnings: [], blocks: [], dayRate: null }
  const q = advanceQuote(pay, { amount: a.amount, reason: a.reason }, { policies: access.settings.policies, today: todayDay(), contractEnd: emp.contract?.type === "fixed" ? emp.contract.end : null })
  const wage = wageOf(pay)
  const s = instalmentSchedule(a.amount, q.instalment)
  const outstanding = pay.advance?.balance ?? 0
  return {
    loading: false,
    rows: [
      { key: "wage", label: t("pay.wage"), value: hrMoney(wage) },
      { key: "limit", label: t("req.fact.hr_limit", { n: access.settings.policies.advanceMaxMonths }), value: hrMoney(wage * access.settings.policies.advanceMaxMonths) },
      { key: "out", label: t("req.fact.outstanding"), value: outstanding > 0 ? hrMoney(outstanding) : t("req.fact.none") },
      { key: "sched", label: t("req.fact.schedule"), value: s.full > 0 ? t("req.fact.schedule_line", { i: hrMoney(s.instalment), n: s.full, last: hrMoney(s.last), amount: hrMoney(a.amount) }) : hrMoney(a.amount), strong: true },
    ],
    warnings: q.warnings.filter((w) => w === "past_contract").map((w) => t(`req.warn.${w}`)),
    blocks: q.blocks.filter((b) => b === "outstanding" || b === "no_wage"),
    dayRate: null,
  }
}

function FactsView({ facts }: { facts: DecisionFacts }) {
  if (facts.loading) return <Loader2 className="mx-auto animate-spin text-muted-foreground" size={18} aria-hidden="true" />
  if (!facts.rows.length && !facts.warnings.length) return null
  return (
    <div className="space-y-2">
      {facts.rows.length > 0 && (
        <div className="rounded-xl border p-3">
          {facts.rows.map((r) => (
            <KeyValueRow key={r.key} label={r.label} value={r.value} strong={r.strong} />
          ))}
        </div>
      )}
      {facts.warnings.map((w) => (
        <Callout key={w} tone="warn">
          {w}
        </Callout>
      ))}
    </div>
  )
}

/** ES-03 — the bank's document behind an IBAN change, opened through a fresh link before deciding. */
function OpenDataFile({ path, name }: { path: string; name: string }) {
  const t = useTranslations("Portal.HR")
  const storage = useStorage()
  const { toast } = useToast()
  const open = async () => {
    if (!storage) return
    try {
      window.open(await getDownloadURL(ref(storage, path)), "_blank", "noopener,noreferrer")
    } catch (err) {
      console.error(err)
      toast({ title: t("files.err_upload"), variant: "destructive" })
    }
  }
  return (
    <Button size="sm" variant="outline" className="self-start" onClick={() => void open()}>
      <Paperclip size={14} className="me-1.5" aria-hidden="true" />
      <span dir="auto">{t("req.open_document", { name })}</span>
    </Button>
  )
}

/** AT-05 — "started today": the return from a leave whose end has passed, recorded on `on`
 * (the sheet's day, or today) by the workplace's supervisor or the HR manager. */
export function ReturnFromLeave({ access, r, actor, on }: { access: HrAccess; r: HrRequest; actor: { uid: string; name: string | null }; on: string }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  if (!access.allowed("leave.return", { site: r.siteId }) || (!r.siteId && !access.ctx.roles.has("manager"))) return null
  const run = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      const { lateDays } = await recordReturn(firestore, access.ctx, r.id, actor, { on })
      toast({ title: lateDays > 0 ? t("ret.done_late", { n: lateDays }) : t("ret.done") })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `ret.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy}>
      {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
      {t("ret.act", { date: hrDate(on, locale) })}
    </Button>
  )
}

/** LV-07 — the employee withdraws his own request while it waits, or his approved leave before it starts
 * (My file); the reason is kept on it and an approved leave's days come back. */
export function CancelOwnRequest({ access, r, actor }: { access: HrAccess; r: HrRequest; actor: { uid: string; name: string | null } }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  if (!mayCancel(access.ctx, r, todayDay())) return null
  const approved = r.state === "approved"
  const run = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await cancelRequest(firestore, access.ctx, r.id, actor, note)
      toast({ title: t(approved ? "req.done.cancel_approved" : "req.done.cancel") })
      setOpen(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `req.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setNote("")
          setOpen(true)
        }}
      >
        {t("req.act.cancel")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("req.act.cancel")}</DialogTitle>
            <DialogDescription>{requestNoDisplay(r.no, locale)}</DialogDescription>
          </DialogHeader>
          {approved && r.leave && r.leave.fromBalance > 0 && <Callout tone="info">{t("req.cancel_restores", { n: r.leave.fromBalance })}</Callout>}
          <div className="space-y-1.5">
            <Label htmlFor={`cancel-${r.id}`}>{t("req.reason_required")}</Label>
            <Textarea id={`cancel-${r.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void run()} disabled={busy || !note.trim()}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("req.act.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
