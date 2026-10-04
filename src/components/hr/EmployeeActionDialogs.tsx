"use client"

// The employee file's actions (PRD §5 forms 4, 13, 14, 15; WF-10, WF-11,
// WF-13, WF-14): move · pay change · probation · record a renewal · link the
// platform user. Each says its blocking facts before saving; each write runs
// the guard and the blocks again and lands in the employee's log.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { DOC_TYPES, type DocType } from "@/lib/hr/documents"
import { assignBlocks, openingBlocks, payChangeBlocks, probationBlocks, probationMaxEnd, renewalBlocks, type EmployeePay, type HrEmployee } from "@/lib/hr/employee"
import { accruedDays } from "@/lib/hr/leave"
import { assignEmployee, changePay, commissionBlocks, decideProbation, linkUser, payWithStep, recordCommission, recordOpeningBalance, recordRenewal, startWork, type HrActor } from "@/lib/hr/employee-writes"
import { HR_PAYROLLS } from "@/lib/hr/collections"
import type { Payroll } from "@/lib/hr/payroll"
import { addDays, monthRange, r2 } from "@/lib/hr/statutory"
import { hrMoney, todayDay } from "@/lib/hr/format"
import { payFromBasic, paySegments, wageOf } from "@/lib/hr/pay"
import { UNASSIGNED_SITE, type HrSite } from "@/lib/hr/sites"
import { TRADES } from "@/lib/hr/trades"
import { HrWriteError } from "@/lib/hr/write-guard"

export type EmployeeAction = "move" | "pay" | "commission" | "probation" | "renew" | "link" | "start" | "opening"

function useRun(onDone: () => void) {
  const t = useTranslations("Portal.HR")
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, okKey: string, blockPrefix: string) => {
    setBusy(true)
    try {
      await fn()
      toast({ title: t(okKey) })
      onDone()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `${blockPrefix}.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

export function EmployeeActionDialog({
  action,
  onClose,
  access,
  actor,
  emp,
  pay,
  sites,
}: {
  action: EmployeeAction
  onClose: () => void
  access: HrAccess
  actor: HrActor
  emp: HrEmployee
  pay: EmployeePay | null
  sites: HrSite[]
}) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const today = todayDay()
  const { busy, run } = useRun(onClose)
  const { orgMembers } = useOrgMembers(access.orgId)
  const [siteId, setSiteId] = useState(emp.siteId ?? UNASSIGNED_SITE)
  const [effectiveOn, setEffectiveOn] = useState(today)
  const [basic, setBasic] = useState(String(pay?.basic ?? ""))
  const [reason, setReason] = useState("")
  const [kind, setKind] = useState<"raise" | "promotion" | "correction">("raise")
  const [trade, setTrade] = useState(emp.trade)
  const [decision, setDecision] = useState<"confirm" | "extend" | "end">("confirm")
  const [extTo, setExtTo] = useState(probationMaxEnd(emp.join))
  const [consentOn, setConsentOn] = useState("")
  const [lastDay, setLastDay] = useState(today < emp.probation.end ? today : emp.probation.end)
  const [openLeave, setOpenLeave] = useState("")
  const [openAdvance, setOpenAdvance] = useState("")
  const [startOn, setStartOn] = useState(emp.join && emp.join <= today ? emp.join : today)
  const [docType, setDocType] = useState<DocType>("iqama")
  const [expiry, setExpiry] = useState("")
  const [fee, setFee] = useState("")
  const [userId, setUserId] = useState(emp.userId ?? "")
  const [commMonth, setCommMonth] = useState(addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7))
  const [commAmount, setCommAmount] = useState("")
  // EM-04 — the last closed month (its main payroll approved): a change reaches back to it at most.
  const prQ = useMemoFirebase(
    () => (firestore && access.orgId && (action === "pay" || action === "commission") && access.allowed("pay.view") ? query(collection(firestore, HR_PAYROLLS), where("organizationId", "==", access.orgId), where("kind", "==", "main")) : null),
    [firestore, access, action]
  )
  const { data: prData } = useCollection(prQ)
  const lastClosed = ((prData ?? []) as unknown as Payroll[]).filter((p) => p.state !== "prepared").reduce<string | null>((m, p) => (!m || p.month > m ? p.month : m), null)

  let title = ""
  let body: React.ReactNode = null
  let blocks: string[] = []
  let blockPrefix = "err"
  let submit: () => void = () => {}

  if (action === "move") {
    title = t("file.act.move")
    const to = siteId === UNASSIGNED_SITE ? null : siteId
    blocks = assignBlocks(emp, to, effectiveOn || null, today)
    blockPrefix = "move.block"
    submit = () => void run(() => assignEmployee(firestore!, access.ctx, emp.id, actor, { siteId: to, effectiveOn }), "file.moved", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="mv-site">{t("move.to")}</Label>
          <SearchableSelect
            id="mv-site"
            value={siteId}
            onChange={setSiteId}
            options={[{ value: UNASSIGNED_SITE, label: t("sites.unassigned") }, ...sites.filter((s) => s.active !== false).map((s) => ({ value: s.id, label: s.name }))]}
            placeholder={t("move.to")}
            searchPlaceholder={t("search")}
            noResultsText={t("no_results")}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mv-on">{t("move.effective")}</Label>
          <Input id="mv-on" type="date" dir="ltr" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} disabled={busy} />
        </div>
        <p className="text-xs text-muted-foreground">{t("move.cost_note")}</p>
      </div>
    )
  } else if (action === "pay") {
    title = t("file.act.pay")
    const n = Number(basic)
    const current = pay?.basic ?? 0
    const res = payChangeBlocks({ basic: n, currentBasic: current, effectiveOn: effectiveOn || null, reason, nationality: emp.nationality, lastClosedMonthStart: lastClosed ? monthRange(lastClosed).start : null, trade: kind === "promotion" ? trade : null })
    blocks = res.blocks
    blockPrefix = "paychange.block"
    const next = n > 0 ? payFromBasic(n, access.settings.policies) : null
    // What the save will do (the write reads the closed months again): from a future day it waits; inside
    // the last closed month the difference goes to that month's supplementary; otherwise it is in force.
    const future = Boolean(effectiveOn) && effectiveOn > today
    const retroPreview =
      pay && next && lastClosed && effectiveOn && effectiveOn.slice(0, 7) === lastClosed && !res.blocks.length
        ? (() => {
            const { steps } = payWithStep(pay, next, effectiveOn, today)
            const monthWage = (p: EmployeePay) => paySegments(p, emp.join, lastClosed, emp.lastDay).reduce((s, x) => s + (wageOf(x.pay) * x.days) / 30, 0)
            return r2(monthWage({ ...pay, steps }) - monthWage(pay))
          })()
        : 0
    submit = () => void run(() => changePay(firestore!, access.ctx, emp.id, actor, { basic: n, effectiveOn, reason, kind, trade: kind === "promotion" ? trade : null }, { policies: access.settings.policies }), "file.pay_changed", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pc-kind">{t("paychange.kind")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)} disabled={busy}>
              <SelectTrigger id="pc-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["raise", "promotion", "correction"] as const).map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`paychange.kinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-basic">{t("paychange.new_basic")}</Label>
            <Input id="pc-basic" type="number" min="0" step="any" dir="ltr" value={basic} onChange={(e) => setBasic(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-on">{t("paychange.effective")}</Label>
            <Input id="pc-on" type="date" dir="ltr" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} disabled={busy} />
          </div>
          {kind === "promotion" && (
            <div className="space-y-1.5">
              <Label htmlFor="pc-trade">{t("new.trade")}</Label>
              <SearchableSelect
                id="pc-trade"
                value={trade}
                onChange={setTrade}
                options={TRADES.map((x) => ({ value: x.key, label: t(`trade.${x.key}` as "trade.mason") }))}
                placeholder={t("new.pick_trade")}
                searchPlaceholder={t("search")}
                noResultsText={t("no_results")}
                disabled={busy}
              />
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-why">{t("paychange.reason")}</Label>
          <Input id="pc-why" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
        </div>
        {pay && next && (
          <div className="rounded-xl border p-3">
            <KeyValueRow label={t("paychange.from")} value={hrMoney(wageOf(pay))} ltr />
            <KeyValueRow label={t("paychange.to")} value={hrMoney(wageOf(next))} ltr strong />
          </div>
        )}
        {res.warnings.map((w) => (
          <Callout key={w} tone="warn">
            {t(`paychange.warn.${w}`)}
          </Callout>
        ))}
        {future && <Callout tone="info">{t("paychange.scheduled", { on: effectiveOn })}</Callout>}
        {retroPreview !== 0 && <Callout tone="info">{t("paychange.retro_preview", { amount: hrMoney(retroPreview), month: lastClosed ?? "" })}</Callout>}
        <p className="text-xs text-muted-foreground">{t("paychange.retro_note")}</p>
      </div>
    )
  } else if (action === "commission") {
    title = t("file.act.commission")
    const amount = Number(commAmount)
    blocks = commissionBlocks({ month: commMonth, amount, reason }, today)
    blockPrefix = "commission.block"
    const late = Boolean(lastClosed) && commMonth <= (lastClosed ?? "")
    submit = () => void run(() => recordCommission(firestore!, access.ctx, emp.id, actor, { month: commMonth, amount, reason }), "file.commission_recorded", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cm-month">{t("commission.month")}</Label>
            <Input id="cm-month" type="month" dir="ltr" max={today.slice(0, 7)} value={commMonth} onChange={(e) => setCommMonth(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-amount">{t("commission.amount")}</Label>
            <Input id="cm-amount" type="number" min="0" step="any" dir="ltr" value={commAmount} onChange={(e) => setCommAmount(e.target.value)} disabled={busy} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-ref">{t("commission.reference")}</Label>
          <Input id="cm-ref" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
        </div>
        {late && <Callout tone="info">{t("commission.late", { month: commMonth })}</Callout>}
        <p className="text-xs text-muted-foreground">{t("commission.note")}</p>
      </div>
    )
  } else if (action === "probation") {
    title = t("file.act.probation")
    blocks = probationBlocks(emp, decision, { to: extTo, consentOn: consentOn || null }, today)
    if (decision === "end" && !lastDay) blocks.push("no_last_day")
    else if (decision === "end" && (lastDay > emp.probation.end || lastDay < emp.join)) blocks.push("probation_over")
    blockPrefix = "probation.block"
    submit = () => void run(() => decideProbation(firestore!, access.ctx, emp.id, actor, decision, { to: extTo, consentOn: consentOn || null, lastDay }), decision === "end" ? "file.probation_ended" : "file.probation_done", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pb-d">{t("probation.decision")}</Label>
          <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)} disabled={busy}>
            <SelectTrigger id="pb-d">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["confirm", "extend", "end"] as const).map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`probation.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {decision === "extend" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pb-to">{t("probation.to")}</Label>
              <Input id="pb-to" type="date" dir="ltr" max={probationMaxEnd(emp.join)} value={extTo} onChange={(e) => setExtTo(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-c">{t("probation.consent")}</Label>
              <Input id="pb-c" type="date" dir="ltr" value={consentOn} onChange={(e) => setConsentOn(e.target.value)} disabled={busy} />
            </div>
          </div>
        )}
        {decision === "end" && (
          <div className="space-y-1.5">
            <Label htmlFor="pb-last">{t("probation.last_day")}</Label>
            <Input id="pb-last" type="date" dir="ltr" min={emp.join} max={emp.probation.end} value={lastDay} onChange={(e) => setLastDay(e.target.value)} disabled={busy} />
          </div>
        )}
        {decision === "end" && <Callout tone="warn">{t("probation.end_note")}</Callout>}
      </div>
    )
  } else if (action === "renew") {
    title = t("file.act.renew")
    blocks = renewalBlocks(emp.docs ?? {}, docType, expiry || null, today)
    blockPrefix = "renew.block"
    submit = () => void run(() => recordRenewal(firestore!, access.ctx, emp.id, actor, { type: docType, expiry, fee: fee ? Number(fee) : null }), "file.renewed", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="rn-t">{t("renew.document")}</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as DocType)} disabled={busy}>
              <SelectTrigger id="rn-t">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`doc.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rn-e">{t("renew.expiry")}</Label>
            <Input id="rn-e" type="date" dir="ltr" value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rn-f">{t("renew.fee")}</Label>
            <Input id="rn-f" type="number" min="0" step="any" dir="ltr" value={fee} onChange={(e) => setFee(e.target.value)} disabled={busy} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("renew.note")}</p>
      </div>
    )
  } else if (action === "opening") {
    title = t("file.act.opening")
    const lb = Number(openLeave)
    const adv = Number(openAdvance || 0)
    const max = Math.floor(accruedDays(emp.join, today))
    blocks = openLeave === "" ? ["bad_leave"] : openingBlocks(emp, { leave: lb, advance: adv }, pay, today)
    blockPrefix = "opening.block"
    submit = () => void run(() => recordOpeningBalance(firestore!, access.ctx, emp.id, actor, { leave: lb, advance: adv }), "file.opening_done", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="op-lv">{t("opening.leave")}</Label>
            <Input id="op-lv" type="number" min="0" max={max} step="1" dir="ltr" value={openLeave} onChange={(e) => setOpenLeave(e.target.value)} disabled={busy} />
            <p className="text-[11px] text-muted-foreground">{t("opening.max", { n: max })}</p>
          </div>
          {access.seesPay(emp.id) && (
            <div className="space-y-1.5">
              <Label htmlFor="op-adv">{t("opening.advance")}</Label>
              <Input id="op-adv" type="number" min="0" step="any" dir="ltr" value={openAdvance} onChange={(e) => setOpenAdvance(e.target.value)} disabled={busy} />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("opening.note")}</p>
      </div>
    )
  } else if (action === "start") {
    title = t("file.act.start")
    blocks = emp.status !== "expected" ? ["not_expected"] : !startOn ? ["no_date"] : startOn > today ? ["future"] : []
    blockPrefix = "start.block"
    submit = () => void run(() => startWork(firestore!, access.ctx, emp.id, actor, { on: startOn || null }), "file.started", blockPrefix)
    body = (
      <div className="space-y-2">
        <Label htmlFor="st-on">{t("start.on")}</Label>
        <Input id="st-on" type="date" dir="ltr" max={today} value={startOn} onChange={(e) => setStartOn(e.target.value)} disabled={busy} />
        <p className="text-xs text-muted-foreground">{t("start.note")}</p>
      </div>
    )
  } else {
    title = t("file.act.link")
    submit = () => void run(() => linkUser(firestore!, access.ctx, emp.id, actor, userId || null), "file.linked", "err")
    body = (
      <div className="space-y-2">
        <Label htmlFor="lk-u">{t("link.user")}</Label>
        <SearchableSelect
          id="lk-u"
          value={userId}
          onChange={setUserId}
          options={orgMembers.map((m) => ({ value: m.id, label: (m.name as string) || (m.email as string) || m.id }))}
          placeholder={t("link.pick")}
          searchPlaceholder={t("search")}
          noResultsText={t("no_results")}
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">{t("link.note")}</p>
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription dir="auto">{emp.names?.ar}</DialogDescription>
        </DialogHeader>
        {body}
        <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`${blockPrefix}.${b}`))} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || blocks.length > 0 || !firestore}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
