"use client"

// A new leave or advance (PRD forms 7 and 8, WF-07, WF-08): the employee
// chooses, the system computes — days without holidays, the balance as of the
// start, the excess unpaid, the sick bands, the instalment and its months —
// and says what blocks or warns BEFORE it is sent (LV-04, AD-02).

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
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
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrMoney, todayDay } from "@/lib/hr/format"
import { LEAVE_RULES, LEAVE_TYPES, type LeaveType } from "@/lib/hr/leave"
import { fileRequest } from "@/lib/hr/request-writes"
import { advanceQuote, leaveQuote, requestNoDisplay, type HrRequest, type HrRequestKind } from "@/lib/hr/requests"
import type { HrSite } from "@/lib/hr/sites"
import { HrWriteError } from "@/lib/hr/write-guard"

export function NewRequestDialog({
  kind,
  onClose,
  access,
  actor,
  emp,
  pay,
  sites,
  existing,
}: {
  kind: HrRequestKind
  onClose: () => void
  access: HrAccess
  actor: HrActor
  emp: HrEmployee
  /** Null when the viewer may not see it — the advance then shows no figures but the amount. */
  pay: EmployeePay | null
  sites: HrSite[]
  existing: HrRequest[]
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [busy, setBusy] = useState(false)
  const [type, setType] = useState<LeaveType>("annual")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [excessUnpaid, setExcessUnpaid] = useState(false)
  const [travel, setTravel] = useState(false)
  const [note, setNote] = useState("")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")

  const mine = existing.filter((r) => r.employeeId === emp.id)
  const others = mine.filter((r) => r.kind === "leave" && r.leave && ["pending", "endorsed", "approved"].includes(r.state)).map((r) => ({ from: r.leave!.from, to: r.leave!.to }))
  const pendingAdvance = mine.some((r) => r.kind === "advance" && ["pending", "endorsed", "finance"].includes(r.state))
  const lq = kind === "leave" ? leaveQuote(emp, { type, from, to, excessUnpaid, travel }, { others }) : null
  const aq =
    kind === "advance"
      ? advanceQuote(pay, { amount: Number(amount), reason }, { policies: access.settings.policies, today, contractEnd: emp.contract?.type === "fixed" ? emp.contract.end : null, pendingAdvance })
      : null
  const blocks: string[] = lq ? lq.blocks : (aq?.blocks ?? []).filter((b) => b !== "no_wage" || Boolean(pay))
  const warnings: string[] = lq ? lq.warnings : (aq?.warnings ?? [])
  const site = sites.find((s) => s.id === emp.siteId)

  const submit = async () => {
    if (!firestore || !access.orgId) return
    setBusy(true)
    try {
      const r = await fileRequest(
        firestore,
        access.ctx,
        access.orgId,
        actor,
        {
          employeeId: emp.id,
          kind,
          leave: kind === "leave" ? { type, from, to, excessUnpaid, travel, note } : undefined,
          advance: kind === "advance" ? { amount: Number(amount), reason } : undefined,
          supervisor: site ? { employeeId: site.supervisorEmployeeId ?? null, userId: site.supervisorUserId ?? null } : null,
        },
        { policies: access.settings.policies, others, pendingAdvance }
      )
      toast({ title: t("req.filed", { no: requestNoDisplay(r.no, locale) }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `req.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(`req.new_${kind}`)}</DialogTitle>
          <DialogDescription dir="auto">{emp.names?.ar}</DialogDescription>
        </DialogHeader>

        {kind === "leave" && lq && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="lv-type">{t("req.leave_type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as LeaveType)} disabled={busy}>
                <SelectTrigger id="lv-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`leave_type.${k}`)}
                      {LEAVE_RULES[k].days ? ` · ${t("file.days", { n: LEAVE_RULES[k].days! })}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lv-from">{t("req.from")}</Label>
                <Input id="lv-from" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lv-to">{t("req.to")}</Label>
                <Input id="lv-to" type="date" dir="ltr" min={from || undefined} value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={travel} onCheckedChange={(c) => setTravel(c === true)} disabled={busy} />
              {t("req.travel")}
            </label>
            {from && to && (
              <div className="rounded-xl border p-3">
                <KeyValueRow label={t("req.days")} value={t("file.days", { n: lq.days })} />
                {LEAVE_RULES[type].fromBalance && <KeyValueRow label={t("req.balance_at_start")} value={t("file.days", { n: lq.balance })} />}
                {LEAVE_RULES[type].fromBalance && <KeyValueRow label={t("req.from_balance")} value={t("file.days", { n: lq.fromBalance })} />}
                {lq.unpaidDays > 0 && <KeyValueRow label={t("req.unpaid_days")} value={t("file.days", { n: lq.unpaidDays })} strong />}
                {lq.sick && <KeyValueRow label={t("req.sick_split")} value={t("req.sick_line", { full: lq.sick.full, q: lq.sick.threeQuarters, zero: lq.sick.unpaid })} />}
              </div>
            )}
            {LEAVE_RULES[type].fromBalance && lq.days > lq.balance && lq.days > 0 && (
              <label className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm">
                <Checkbox className="mt-0.5" checked={excessUnpaid} onCheckedChange={(c) => setExcessUnpaid(c === true)} disabled={busy} />
                {t("req.excess_unpaid", { n: Math.max(0, lq.days - Math.max(0, lq.balance)) })}
              </label>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="lv-note">{t("req.note")}</Label>
              <Textarea id="lv-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
            </div>
          </div>
        )}

        {kind === "advance" && aq && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="av-amount">{t("req.amount")}</Label>
                <Input id="av-amount" type="number" min="0" step="any" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="av-reason">{t("req.reason")}</Label>
                <Input id="av-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
              </div>
            </div>
            {pay && Number(amount) > 0 && (
              <div className="rounded-xl border p-3">
                <KeyValueRow label={t("req.instalment")} value={hrMoney(aq.instalment)} ltr />
                <KeyValueRow label={t("req.months")} value={aq.months} ltr strong />
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("req.advance_note")}</p>
          </div>
        )}

        {warnings.map((w) => (
          <Callout key={w} tone="warn">
            {t(`req.warn.${w}`)}
          </Callout>
        ))}
        <BlockingReasons title={t("req.cannot_send")} reasons={blocks.map((b) => t(`req.block.${b}`))} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || blocks.length > 0 || (kind === "leave" ? !from || !to : !(Number(amount) > 0))}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("req.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
