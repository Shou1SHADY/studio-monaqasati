"use client"

// End of service on the employee file (PRD WF-16; EX-01…06): the HR manager
// starts it — reason, last day, notice — and Inventory is asked to clear the
// custody; the settlement is computed from the record (never typed) and can be
// approved only once Inventory has cleared; government relations ticks the
// platform exit tasks; the service certificate comes from the card.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { Loader2, LogOut, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { HR_EXITS, HR_SETTLEMENTS } from "@/lib/hr/collections"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { EXIT_REASONS, EXIT_TASKS, exitBlocks, exitId, settlementQuote, type ExitReason } from "@/lib/hr/eos"
import { approveSettlement, setExitTask, startExit, type HrExit, type HrSettlement } from "@/lib/hr/exit-writes"
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { leaveBalance } from "@/lib/hr/leave"
import { wageOf } from "@/lib/hr/pay"
import type { HrSite } from "@/lib/hr/sites"
import { HrWriteError } from "@/lib/hr/write-guard"

function useRun() {
  const t = useTranslations("Portal.HR")
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok: string, then?: () => void) => {
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
      then?.()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `exit.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

export function StartExitDialog({ access, actor, emp, onClose }: { access: HrAccess; actor: HrActor; emp: HrEmployee; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { busy, run } = useRun()
  const [reason, setReason] = useState<ExitReason | "">("")
  const [lastDay, setLastDay] = useState("")
  const [noticeOn, setNoticeOn] = useState(todayDay())
  const [art77, setArt77] = useState(false)
  const [note, setNote] = useState("")
  const blocks = exitBlocks(emp, { reason: reason || null, lastDay: lastDay || null })
  const termination = reason === "termination_notice" || reason === "termination_pay"
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("exit.start")}</DialogTitle>
          <DialogDescription dir="auto">{emp.names?.ar}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ex-reason">{t("exit.reason")}</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as ExitReason)} disabled={busy}>
              <SelectTrigger id="ex-reason">
                <SelectValue placeholder={t("exit.pick_reason")} />
              </SelectTrigger>
              <SelectContent>
                {EXIT_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`exit.reasons.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ex-notice">{t("exit.notice_on")}</Label>
              <Input id="ex-notice" type="date" dir="ltr" value={noticeOn} onChange={(e) => setNoticeOn(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-last">{t("exit.last_day")}</Label>
              <Input id="ex-last" type="date" dir="ltr" value={lastDay} onChange={(e) => setLastDay(e.target.value)} disabled={busy} />
            </div>
          </div>
          {termination && (
            <label className="flex items-start gap-2 rounded-xl border p-3 text-sm">
              <Checkbox className="mt-0.5" checked={art77} onCheckedChange={(c) => setArt77(c === true)} disabled={busy} />
              {t("exit.art77")}
            </label>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ex-note">{t("req.note")}</Label>
            <Textarea id="ex-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <Callout tone="info">{t("exit.custody_note")}</Callout>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`exit.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={busy || blocks.length > 0 || !firestore}
            onClick={() => void run(() => startExit(firestore!, access.ctx, access.orgId!, actor, emp.id, { reason: reason || null, lastDay, noticeOn, art77, note }), "exit.started", onClose)}
          >
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("exit.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function HrExitPanel({ access, actor, emp, pay, sites }: { access: HrAccess; actor: HrActor; emp: HrEmployee; pay: EmployeePay | null; sites: HrSite[] }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { busy, run } = useRun()
  const id = access.orgId ? exitId(access.orgId, emp.id) : null
  const money = access.seesPay(emp.id)
  const exRef = useMemoFirebase(() => (firestore && id && (emp.status === "leaving" || emp.status === "left") ? doc(firestore, HR_EXITS, id) : null), [firestore, id, emp.status])
  const { data: exData } = useDoc(exRef)
  const x = (exData as unknown as HrExit | null) ?? null
  const stRef = useMemoFirebase(() => (firestore && id && money && x && x.state !== "leaving" ? doc(firestore, HR_SETTLEMENTS, id) : null), [firestore, id, money, x])
  const { data: stData } = useDoc(stRef)
  const st = (stData as unknown as HrSettlement | null) ?? null
  const [ticket, setTicket] = useState("")
  const [months, setMonths] = useState("")
  if (!x) return null

  const cleared = x.custody?.state === "cleared"
  const preview =
    money && pay && x.state === "leaving"
      ? settlementQuote(
          {
            wage: wageOf(pay),
            join: emp.join,
            lastDay: x.lastDay,
            reason: x.reason,
            leaveTaken: emp.leaveTaken ?? 0,
            openingLeave: emp.openingLeave ?? 0,
            art77: x.art77,
            fixedRemainingMonths: months ? Number(months) : null,
            ticket: Number(ticket) || 0,
            advanceBalance: pay.advance?.balance ?? 0,
            custodyShortfall: x.custody?.shortfall ?? 0,
          },
          leaveBalance
        )
      : null
  const shown = st ?? preview
  const mayApprove = x.state === "leaving" && access.allowed("exit.manage") && (access.ctx.owner || access.ctx.employeeId !== emp.id)

  const certificate = () => {
    const w = window.open("", "_blank", "width=720,height=900")
    if (!w) return
    const dir = locale === "ar" ? "rtl" : "ltr"
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string)
    const body = t("exit.cert_body", {
      name: emp.names?.ar ?? "",
      id: emp.idNo ?? "—",
      trade: t(`trade.${emp.trade}` as "trade.mason"),
      join: hrDate(emp.join, locale),
      last: hrDate(x.lastDay, locale),
      gender: emp.gender,
    })
    w.document.write(
      `<!doctype html><html dir="${dir}" lang="${locale}"><head><meta charset="utf-8"><title>${esc(t("exit.cert_title"))}</title><style>body{font-family:system-ui,sans-serif;padding:48px;line-height:1.9}h1{font-size:22px;line-height:1.6}p{font-size:15px}.org{color:#555}</style></head><body><p class="org">${esc(access.settings.establishment.name ?? "")}</p><h1>${esc(t("exit.cert_title"))}</h1><p>${esc(body)}</p><p>${esc(t("exit.cert_close", { gender: emp.gender }))}</p><p class="org">${esc(hrDate(todayDay(), locale))} · ${esc(empNo(emp.no))}</p></body></html>`
    )
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <Panel
      title={t("exit.title")}
      icon={LogOut}
      actions={
        x.state !== "leaving" ? (
          <Button size="sm" variant="outline" onClick={certificate}>
            <Printer size={14} className="me-1.5" aria-hidden="true" />
            {t("exit.certificate")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={x.state === "paid" ? "ok" : x.state === "settled" ? "info" : "warn"}>{t(`exit.state.${x.state}`)}</StatusPill>
          <StatusPill tone={cleared ? "ok" : "warn"}>{t(cleared ? "exit.custody_cleared" : "exit.custody_requested")}</StatusPill>
        </div>
        <div>
          <KeyValueRow label={t("exit.reason")} value={t(`exit.reasons.${x.reason}`)} />
          <KeyValueRow label={t("exit.notice_on")} value={hrDate(x.noticeOn, locale)} />
          <KeyValueRow label={t("exit.last_day")} value={hrDate(x.lastDay, locale)} />
          {cleared && <KeyValueRow label={t("exit.custody_by")} value={`${x.custody.byName || "—"} · ${hrDate(x.custody.at, locale)}`} />}
          {cleared && (x.custody.shortfall ?? 0) > 0 && money && <KeyValueRow label={t("exit.shortfall")} value={hrMoney(x.custody.shortfall)} ltr />}
          {x.custody.note && <KeyValueRow label={t("req.note")} value={x.custody.note} />}
        </div>

        {shown && (
          <div className="rounded-xl border p-3">
            <p className="mb-1 text-xs font-bold text-muted-foreground">{t(st ? "exit.settlement" : "exit.settlement_preview")}</p>
            <KeyValueRow label={t("exit.s.gratuity", { years: shown.years })} value={hrMoney(shown.gratuity)} ltr />
            <KeyValueRow label={t("exit.s.leave", { days: shown.leaveDays })} value={hrMoney(shown.leaveCash)} ltr />
            <KeyValueRow label={t("exit.s.last", { days: shown.lastMonthDays })} value={hrMoney(shown.lastPay)} ltr />
            {shown.noticePay > 0 && <KeyValueRow label={t("exit.s.notice")} value={hrMoney(shown.noticePay)} ltr />}
            {shown.art77 > 0 && <KeyValueRow label={t("exit.s.art77")} value={hrMoney(shown.art77)} ltr />}
            {shown.ticket > 0 && <KeyValueRow label={t("exit.s.ticket")} value={hrMoney(shown.ticket)} ltr />}
            {shown.advance > 0 && <KeyValueRow label={t("exit.s.advance")} value={`− ${hrMoney(shown.advance)}`} ltr />}
            {shown.custody > 0 && <KeyValueRow label={t("exit.s.custody")} value={`− ${hrMoney(shown.custody)}`} ltr />}
            <KeyValueRow label={t("exit.s.net")} value={hrMoney(shown.net)} ltr strong />
          </div>
        )}

        {mayApprove && (
          <div className="space-y-2">
            {money && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ex-ticket">{t("exit.ticket")}</Label>
                  <Input id="ex-ticket" type="number" min="0" step="any" dir="ltr" value={ticket} onChange={(e) => setTicket(e.target.value)} disabled={busy} />
                </div>
                {x.art77 && emp.contract?.type === "fixed" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="ex-months">{t("exit.fixed_months")}</Label>
                    <Input id="ex-months" type="number" min="0" step="1" dir="ltr" value={months} onChange={(e) => setMonths(e.target.value)} disabled={busy} />
                  </div>
                )}
              </div>
            )}
            {!cleared && <Callout tone="block">{t("exit.block.custody")}</Callout>}
            <div className="flex justify-end">
              <Button
                disabled={busy || !cleared || !firestore}
                onClick={() => void run(() => approveSettlement(firestore!, access.ctx, access.orgId!, actor, x.id ?? id!, { ticket: Number(ticket) || 0, fixedRemainingMonths: months ? Number(months) : null, sites }), "exit.approved")}
              >
                {t("exit.approve")}
              </Button>
            </div>
          </div>
        )}

        {x.state !== "leaving" && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold text-muted-foreground">{t("exit.tasks")}</p>
            {EXIT_TASKS.filter((k) => k !== "finalExit" || emp.nationality !== "sa").map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={Boolean(x.tasks?.[k])}
                  disabled={busy || !access.allowed("platform.tasks") || !firestore}
                  onCheckedChange={(c) => void run(() => setExitTask(firestore!, access.ctx, actor, id!, k, c === true), "exit.task_saved")}
                />
                {t(`exit.task.${k}`)}
                {x.tasks?.[k] && <span className="text-xs text-muted-foreground">· {x.tasks[k]?.byName}</span>}
              </label>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}
