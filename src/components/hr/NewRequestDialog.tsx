"use client"

// A new request (PRD forms 7, 8, 10, 11; WF-07, WF-08, WF-25): the employee
// chooses, the system computes — days without holidays, the balance as of the
// start, the excess unpaid and what it costs, the sick days used of 120, the
// instalment and its months, who decides — and says what blocks or warns
// BEFORE it is sent (LV-04, AD-02). Only the leave types he is entitled to are
// offered (LV-01). An IBAN change carries the bank's document, uploaded to his
// record's folder (ES-03, EM-07). An attendance correction — "marked absent
// but I was at work" — goes to whoever keeps his workplace's sheet (form 11).

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ref, uploadBytes } from "firebase/storage"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useFirestore, useStorage } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { attachmentBlocks, attachmentPath } from "@/lib/hr/attachments"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrMoney, todayDay } from "@/lib/hr/format"
import { leaveEligibility, LEAVE_RULES, LEAVE_TYPES, type LeaveType } from "@/lib/hr/leave"
import { wageOf } from "@/lib/hr/pay"
import { fileRequest } from "@/lib/hr/request-writes"
import {
  advanceQuote,
  ATTFIX_MISS_PER_MONTH,
  ATTFIX_WINDOW_DAYS,
  attfixBlocks,
  attfixTypesFor,
  attfixUsed,
  DATA_FIELDS,
  dataBlocks,
  leaveQuote,
  requestNoDisplay,
  sickUsedIn,
  type AttfixType,
  type DataField,
  type HrRequest,
  type HrRequestKind,
} from "@/lib/hr/requests"
import type { HrSite } from "@/lib/hr/sites"
import { addDays, STATUTORY } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"

export function NewRequestDialog({
  kind,
  onClose,
  access,
  actor,
  emp,
  pay,
  sites,
  existing,
  initialField,
  deciders,
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
  /** A data update opened from "needs your attention" — the field it is about. */
  initialField?: DataField
  /** Who decides, by name (ES-02): the HR manager, Finance above his limit, the sheet's keeper. */
  deciders?: { hr?: string | null; finance?: string | null; sheet?: string | null }
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const today = todayDay()
  const punch = access.settings.features.includes("punch")
  const [busy, setBusy] = useState(false)
  const [type, setType] = useState<LeaveType>("annual")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [note, setNote] = useState("")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [field, setField] = useState<DataField>(initialField ?? "iban")
  const [value, setValue] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [fixType, setFixType] = useState<AttfixType>(attfixTypesFor(punch)[0])
  const [fixDay, setFixDay] = useState(addDays(today, -1))

  const mine = existing.filter((r) => r.employeeId === emp.id)
  const others = mine.filter((r) => r.kind === "leave" && r.leave && ["pending", "endorsed", "approved"].includes(r.state)).map((r) => ({ from: r.leave!.from, to: r.leave!.to }))
  const pendingAdvance = mine.some((r) => r.kind === "advance" && ["pending", "endorsed", "finance"].includes(r.state))
  // LV-01 — only the types he is entitled to as of the start (women only, two years for Hajj, Hajj once).
  const types = LEAVE_TYPES.filter((k) => !leaveEligibility(k, emp, from || today))
  const leaveType = types.includes(type) ? type : (types[0] ?? "annual")
  const lq = kind === "leave" ? leaveQuote(emp, { type: leaveType, from, to }, { others }) : null
  const aq =
    kind === "advance"
      ? advanceQuote(pay, { amount: Number(amount), reason }, { policies: access.settings.policies, today, contractEnd: emp.contract?.type === "fixed" ? emp.contract.end : null, pendingAdvance })
      : null
  const wage = pay ? wageOf(pay) : 0
  const filePath = file ? attachmentPath(emp.organizationId, emp.id, file.name, 0) : null
  const fileMeta = file && filePath ? { path: filePath, name: file.name, size: file.size, contentType: file.type } : null
  const blocks: string[] =
    kind === "leave"
      ? (lq?.blocks ?? [])
      : kind === "data"
        ? [...dataBlocks({ field, value, file: fileMeta }), ...(field === "iban" && fileMeta ? attachmentBlocks({ kind: "bank", ...fileMeta }) : [])]
        : kind === "attfix"
          ? attfixBlocks({ type: fixType, day: fixDay, reason }, { today, punch, mine })
          : (aq?.blocks ?? []).filter((b) => b !== "no_wage" || Boolean(pay))
  const warnings: string[] = lq ? lq.warnings : (aq?.warnings ?? [])
  const site = sites.find((s) => s.id === emp.siteId)
  const outstanding = pay?.advance && pay.advance.balance > 0 ? pay.advance : null
  const used = attfixUsed(mine, today.slice(0, 7))

  const submit = async () => {
    if (!firestore || !access.orgId) return
    setBusy(true)
    try {
      let dataFile = null
      if (kind === "data" && field === "iban" && file) {
        // EM-07 — into his record's folder; the HR manager's approval files it on the record.
        if (!storage) throw new HrWriteError("blocked", ["no_document"])
        const path = attachmentPath(emp.organizationId, emp.id, file.name, Date.now())
        await uploadBytes(ref(storage, path), file, { contentType: file.type })
        dataFile = { path, name: file.name, size: file.size, contentType: file.type }
      }
      const r = await fileRequest(
        firestore,
        access.ctx,
        access.orgId,
        actor,
        {
          employeeId: emp.id,
          kind,
          leave: kind === "leave" ? { type: leaveType, from, to, note } : undefined,
          advance: kind === "advance" ? { amount: Number(amount), reason } : undefined,
          data: kind === "data" ? { field, value, file: dataFile } : undefined,
          attfix: kind === "attfix" ? { type: fixType, day: fixDay, reason } : undefined,
          supervisor: site ? { employeeId: site.supervisorEmployeeId ?? null, userId: site.supervisorUserId ?? null } : null,
        },
        { policies: access.settings.policies, others, pendingAdvance, punch, mine }
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

  const ready = kind === "leave" ? Boolean(from && to) : kind === "advance" ? Number(amount) > 0 : kind === "attfix" ? Boolean(fixDay && reason.trim()) : Boolean(value.trim())

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(`req.new_${kind}`)}</DialogTitle>
          <DialogDescription dir="auto">
            {kind === "attfix" ? t("req.attfix.sub", { name: deciders?.sheet || t("me.holder.hr") }) : emp.names?.ar}
          </DialogDescription>
        </DialogHeader>

        {kind === "leave" && lq && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="lv-type">{t("req.leave_type")}</Label>
              <Select value={leaveType} onValueChange={(v) => setType(v as LeaveType)} disabled={busy}>
                <SelectTrigger id="lv-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map((k) => (
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
            {from && to && (
              <div className="rounded-xl border p-3">
                <KeyValueRow label={t("req.days")} value={t("file.days", { n: lq.days })} />
                {LEAVE_RULES[leaveType].fromBalance && <KeyValueRow label={t("req.balance_at_start")} value={t("file.days", { n: lq.balance })} />}
                {LEAVE_RULES[leaveType].fromBalance && <KeyValueRow label={t("req.from_balance")} value={t("file.days", { n: lq.fromBalance })} />}
                {lq.unpaidDays > 0 && <KeyValueRow label={t("req.unpaid_days")} value={t("file.days", { n: lq.unpaidDays })} strong />}
                {(lq.unpaidDays > 0 || lq.excess > 0) && wage > 0 && (
                  // LV-02 — the effect in riyals, before sending.
                  <KeyValueRow label={t("req.effect")} value={t("req.effect_line", { amount: hrMoney(Math.round((wage / STATUTORY.monthDays) * (lq.unpaidDays || lq.excess))) })} ltr />
                )}
                {lq.sick && <KeyValueRow label={t("req.sick_split")} value={t("req.sick_line", { full: lq.sick.full, q: lq.sick.threeQuarters, zero: lq.sick.unpaid })} />}
                {leaveType === "sick" && <KeyValueRow label={t("req.fact.sick_used")} value={t("req.fact.of_120", { n: sickUsedIn(emp, from) })} />}
              </div>
            )}
            {emp.nationality !== "sa" && leaveType === "annual" && <Callout tone="info">{t("req.ticket_due")}</Callout>}
            <div className="space-y-1.5">
              <Label htmlFor="lv-note">{t("req.note")}</Label>
              <Textarea id="lv-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
            </div>
          </div>
        )}

        {kind === "data" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="du-field">{t("req.data_field")}</Label>
              <Select value={field} onValueChange={(v) => setField(v as DataField)} disabled={busy}>
                <SelectTrigger id="du-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_FIELDS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`data_field.${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="du-value">{t("req.new_value")}</Label>
              <Input id="du-value" dir={field === "iban" || field === "mobile" ? "ltr" : "auto"} placeholder={field === "iban" ? "SA…" : undefined} value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
              {field === "iban" && <p className="text-[11px] text-muted-foreground">{t("req.iban_hint")}</p>}
            </div>
            {field === "iban" && (
              <div className="space-y-1.5">
                <Callout tone="warn">{t("req.bank_document_note")}</Callout>
                <Label htmlFor="du-file">{t("req.bank_document")}</Label>
                <Input id="du-file" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("req.data_note")}</p>
          </div>
        )}

        {kind === "attfix" && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">{t("req.attfix.type")}</legend>
              {attfixTypesFor(punch).map((k) => (
                <label key={k} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm", fixType === k && "border-module bg-module/5")}>
                  <input type="radio" name="attfix-type" checked={fixType === k} onChange={() => setFixType(k)} disabled={busy} />
                  <span>{t(`req.attfix_type.${k}`)}</span>
                </label>
              ))}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="af-day">{t("req.attfix.day")}</Label>
                <Input id="af-day" type="date" dir="ltr" min={addDays(today, -ATTFIX_WINDOW_DAYS)} max={today} value={fixDay} onChange={(e) => setFixDay(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="af-why">{t("req.reason")}</Label>
                <Input id="af-why" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
              </div>
            </div>
            {punch && <p className="text-xs text-muted-foreground">{t("req.attfix.cap_line", { used, max: ATTFIX_MISS_PER_MONTH })}</p>}
            <p className="text-xs text-muted-foreground">{t("req.attfix.note", { n: ATTFIX_WINDOW_DAYS })}</p>
          </div>
        )}

        {kind === "advance" && aq && (
          <div className="space-y-4">
            {pay && wage > 0 && <KeyValueRow label={t("pay.wage")} value={hrMoney(wage)} ltr />}
            {outstanding && (
              // AD-02 — no second advance: the balance and the instalment, before he types anything.
              <Callout tone="block">{t("req.outstanding_line", { balance: hrMoney(outstanding.balance), instalment: hrMoney(outstanding.instalment) })}</Callout>
            )}
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
                <KeyValueRow label={t("req.who_decides")} value={aq.overLimit ? t("req.decider_finance", { name: deciders?.finance || t("me.holder.finance") }) : deciders?.hr || t("me.holder.hr")} />
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("req.advance_note")}</p>
          </div>
        )}

        {warnings.map((w) => (
          // LV-04 — said in red before sending: it will not be approved for travel; it is still filed.
          <Callout key={w} tone={w === "travel_docs" ? "block" : "warn"}>
            {t(`req.warn.${w}`, { n: lq?.excess ?? 0 })}
          </Callout>
        ))}
        <BlockingReasons title={t("req.cannot_send")} reasons={blocks.filter((b) => b !== "outstanding" || !outstanding).map((b) => t(`req.block.${b}`, { max: ATTFIX_MISS_PER_MONTH, n: ATTFIX_WINDOW_DAYS }))} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || blocks.length > 0 || !ready}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("req.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
