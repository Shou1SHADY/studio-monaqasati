"use client"

// Requests as a list (PRD §5 "Requests", LV-05, WF-07/08): number, person,
// what is asked, where it stands, and only the actions this viewer holds —
// endorse, approve, decline (a reason is required), cancel before it starts.
// An advance's amount shows only to those who may see pay.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useFirestore, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { Link } from "@/i18n/routing"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { cancelRequest, decideRequest, endorseRequest, recordReturn } from "@/lib/hr/request-writes"
import { leaveEndAfter } from "@/lib/hr/leave"
import { aboveBalance, LEAVE_MODES, mayCancel, requestActions, requestNoDisplay, type HrRequest, type HrRequestState, type LeaveMode, type RequestAction } from "@/lib/hr/requests"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import type { HrPortal } from "./HrShell"

export const REQUEST_TONE: Record<HrRequestState, PillTone> = { pending: "warn", endorsed: "info", approved: "ok", declined: "bad", finance: "violet", cancelled: "mute" }

type Acting = { r: HrRequest; action: Exclude<RequestAction, "finance"> }

export function HrRequestList({ access, requests, portal, showEmployee = true, empty, facts }: { access: HrAccess; requests: HrRequest[]; portal?: HrPortal; showEmployee?: boolean; empty: string; /** A line of facts under each row (the employee file: filed, with whom, decided by). */ facts?: (r: HrRequest) => string }) {
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

  const what = (r: HrRequest) => {
    if (r.kind === "leave" && r.leave) return `${t(`leave_type.${r.leave.type}`)} · ${hrDate(r.leave.from, locale)} → ${hrDate(r.leave.to, locale)} · ${t("file.days", { n: r.leave.days })}`
    if (r.kind === "advance" && r.advance) return `${t("req.kind.advance")}${access.seesPay(r.employeeId) ? ` · ${hrMoney(r.advance.amount)}` : ""}`
    if (r.kind === "data" && r.data) return `${t("req.kind.data")} · ${t(`data_field.${r.data.field}`)}: ${r.data.field === "iban" && !access.seesPay(r.employeeId) ? "•••" : r.data.value}${r.data.document ? ` · ${t("req.document_ref", { ref: r.data.document })}` : ""}`
    return t(`req.kind.${r.kind}`)
  }

  const [mode, setMode] = useState<LeaveMode | null>(null)
  const over = acting?.action === "approve" ? aboveBalance(acting.r) : 0

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
                  {r.deciderLevel === "management" && <StatusPill tone="violet">{t("req.to_management")}</StatusPill>}
                </p>
                <p className="text-xs text-muted-foreground">{what(r)}</p>
                {facts && <p className="text-[11px] text-muted-foreground">{facts(r)}</p>}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{acting ? t(`req.act.${acting.action}`) : ""}</DialogTitle>
            <DialogDescription>{acting ? `${requestNoDisplay(acting.r.no, locale)} · ${acting.r.employeeName} · ${what(acting.r)}` : ""}</DialogDescription>
          </DialogHeader>
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
                        : t("req.mode.excess_unpaid_line", { n: over })}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="req-note">{t(needsNote ? "req.reason_required" : "req.note")}</Label>
            <Textarea id="req-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void run()} disabled={busy || (needsNote && !note.trim()) || (over > 0 && !mode)} variant={acting?.action === "decline" || acting?.action === "cancel" ? "destructive" : "default"}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {acting ? t(`req.act.${acting.action}`) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

/** LV-07 — the employee withdraws his own request while it waits (My file); the reason is kept on it. */
export function CancelOwnRequest({ access, r, actor }: { access: HrAccess; r: HrRequest; actor: { uid: string; name: string | null } }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  if (!mayCancel(access.ctx, r, todayDay())) return null
  const run = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await cancelRequest(firestore, access.ctx, r.id, actor, note)
      toast({ title: t("req.done.cancel") })
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
