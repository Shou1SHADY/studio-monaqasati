"use client"

// The employee file's actions (PRD §5 forms 4, 13, 14, 15, 30; WF-10, WF-11,
// WF-13, WF-14): move · pay change (or a raise asked for, decided as one) ·
// commission · probation and the line manager's view of it · the contract's
// end · record a renewal or a first issue · document numbers · line manager ·
// opening balance · start · link the platform user. Each says its blocking
// facts before saving; each write runs the guard and the blocks again and
// lands in the employee's log.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { docRows, DOC_NUMBER_KEYS, docState, driveDocOf, passportFirst, type DocNumbers, type DocType } from "@/lib/hr/documents"
import {
  assignBlocks,
  contractBlocks,
  contractRenewalDefault,
  displayName,
  lineManagerBlocks,
  lineManagerOptions,
  openingBlocks,
  PAY_CHANGE_KINDS,
  payChangeBlocks,
  PROBATION_RECOMMENDS,
  probationBlocks,
  probationMaxEnd,
  probationViewBlocks,
  raiseRequestBlocks,
  renewalBlocks,
  type EmployeePay,
  type HrEmployee,
  type PayChangeKind,
  type ProbationRecommend,
} from "@/lib/hr/employee"
import { accruedDays } from "@/lib/hr/leave"
import {
  assignEmployee,
  changePay,
  commissionBlocks,
  decideProbation,
  endContract,
  linkUser,
  payWithStep,
  recordCommission,
  recordDocNumbers,
  recordOpeningBalance,
  recordProbationView,
  recordRenewal,
  renewContract,
  setLineManager,
  startWork,
  type HrActor,
} from "@/lib/hr/employee-writes"
import { HR_PAYROLLS } from "@/lib/hr/collections"
import { MANPOWER_REQUESTS, type ManpowerRequest } from "@/lib/hr/manpower"
import type { Payroll } from "@/lib/hr/payroll"
import { fileRequest } from "@/lib/hr/request-writes"
import type { HrRequest } from "@/lib/hr/requests"
import { addDays, monthRange, r2 } from "@/lib/hr/statutory"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { gosiRates, payFromBasic, paySegments, wageOf } from "@/lib/hr/pay"
import { UNASSIGNED_SITE, type HrSite } from "@/lib/hr/sites"
import { TRADES } from "@/lib/hr/trades"
import { HrWriteError } from "@/lib/hr/write-guard"

export type EmployeeAction = "move" | "pay" | "raise" | "commission" | "probation" | "probation_view" | "contract" | "renew" | "numbers" | "manager" | "link" | "start" | "opening"

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
  employees = [],
  requests = [],
  docType: presetDoc = null,
  requestId = null,
  managerName = null,
  isHrManager = false,
}: {
  action: EmployeeAction
  onClose: () => void
  access: HrAccess
  actor: HrActor
  emp: HrEmployee
  pay: EmployeePay | null
  sites: HrSite[]
  employees?: HrEmployee[]
  requests?: HrRequest[]
  /** The renewal row the dialog was opened from. */
  docType?: string | null
  /** The raise request a pay change decides (EM-04). */
  requestId?: string | null
  managerName?: string | null
  isHrManager?: boolean
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const { busy, run } = useRun(onClose)
  const { orgMembers } = useOrgMembers(access.orgId)
  const raiseReq = requestId ? (requests.find((r) => r.id === requestId && r.kind === "raise") ?? null) : null
  const [siteId, setSiteId] = useState(emp.siteId ?? UNASSIGNED_SITE)
  const [effectiveOn, setEffectiveOn] = useState(raiseReq?.raise?.effectiveOn ?? today)
  const [basic, setBasic] = useState(String(raiseReq?.raise?.basic ?? pay?.basic ?? ""))
  const [reason, setReason] = useState(raiseReq?.raise?.reason ?? "")
  const [kind, setKind] = useState<PayChangeKind>(raiseReq?.raise?.kind ?? "raise")
  const [trade, setTrade] = useState(raiseReq?.raise?.trade ?? emp.trade)
  const [decision, setDecision] = useState<"confirm" | "extend" | "end">("confirm")
  const [extTo, setExtTo] = useState(probationMaxEnd(emp.join))
  const [consentOn, setConsentOn] = useState("")
  const [lastDay, setLastDay] = useState(today < emp.probation.end ? today : emp.probation.end)
  const [openLeave, setOpenLeave] = useState("")
  const [openAdvance, setOpenAdvance] = useState("")
  const [startOn, setStartOn] = useState(emp.join && emp.join <= today ? emp.join : today)
  const held = useMemo(() => docRows(emp, today, access.settings.policies.renewWindowDays).filter((r) => r.type !== "contract"), [emp, today, access.settings.policies.renewWindowDays])
  const [docType, setDocType] = useState<DocType>(((presetDoc && presetDoc !== "contract" ? presetDoc : null) ?? (held.find((r) => r.type === "iqama" && !r.expiry) ?? [...held].sort((a, b) => (b.state === "expired" ? 3 : b.state === "d30" ? 2 : b.state === "d60" ? 1 : 0) - (a.state === "expired" ? 3 : a.state === "d30" ? 2 : a.state === "d60" ? 1 : 0))[0])?.type ?? "passport") as DocType)
  const [expiry, setExpiry] = useState("")
  const [fee, setFee] = useState("")
  const [docNumber, setDocNumber] = useState("")
  const [insuranceToo, setInsuranceToo] = useState(true)
  const [numbers, setNumbers] = useState<DocNumbers>({ ...(emp.docs?.no ?? {}) })
  const [userId, setUserId] = useState(emp.userId ?? "")
  const [managerId, setManagerId] = useState(emp.managerId ?? "")
  const [rating, setRating] = useState<1 | 2 | 3 | null>(null)
  const [recommend, setRecommend] = useState<ProbationRecommend | null>(null)
  const [note, setNote] = useState("")
  const [ctDecision, setCtDecision] = useState<"renew" | "end">("renew")
  const [ctUntil, setCtUntil] = useState(emp.contract?.end ? contractRenewalDefault(emp.contract.end) : "")
  const [mr, setMr] = useState("")
  const [commMonth, setCommMonth] = useState(addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7))
  const [commAmount, setCommAmount] = useState("")
  // EM-04 — the last closed month (its main payroll approved): a change reaches back to it at most.
  const prQ = useMemoFirebase(
    () => (firestore && access.orgId && (action === "pay" || action === "commission") && access.allowed("pay.view") ? query(collection(firestore, HR_PAYROLLS), where("organizationId", "==", access.orgId), where("kind", "==", "main")) : null),
    [firestore, access, action]
  )
  const { data: prData } = useCollection(prQ)
  const lastClosed = ((prData ?? []) as unknown as Payroll[]).filter((p) => p.state !== "prepared").reduce<string | null>((m, p) => (!m || p.month > m ? p.month : m), null)
  // AS-02 — the manpower requests a move may answer: open ones for the place he is moved to.
  const mrQ = useMemoFirebase(() => (firestore && access.orgId && action === "move" ? query(collection(firestore, MANPOWER_REQUESTS), where("organizationId", "==", access.orgId)) : null), [firestore, access.orgId, action])
  const { data: mrData } = useCollection(mrQ)

  let title = ""
  let body: React.ReactNode = null
  let blocks: string[] = []
  let blockPrefix = "err"
  let submit: () => void = () => {}

  if (action === "move") {
    title = emp.siteId ? t("file.act.move") : t("file.act.assign")
    const to = siteId === UNASSIGNED_SITE ? null : siteId
    const target = sites.find((s) => s.id === to) ?? null
    blocks = assignBlocks(emp, to, effectiveOn || null, today, { type: target?.type ?? null })
    blockPrefix = "move.block"
    const answers = ((mrData ?? []) as unknown as ManpowerRequest[]).filter((r) => r.state !== "withdrawn" && target && (r.siteId === target.id || (target.projectId && r.projectId === target.projectId)))
    const sameTrade = (sid: string) => employees.filter((e) => e.siteId === sid && e.trade === emp.trade && e.status !== "left").length
    const future = Boolean(effectiveOn) && effectiveOn > today
    submit = () => void run(() => assignEmployee(firestore!, access.ctx, emp.id, actor, { siteId: to, effectiveOn, manpowerRequestId: answers.some((r) => r.id === mr) ? mr : null }), future ? "file.move_scheduled_ok" : "file.moved", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="mv-site">{t("move.to")}</Label>
          <SearchableSelect
            id="mv-site"
            value={siteId}
            onChange={setSiteId}
            options={[
              { value: UNASSIGNED_SITE, label: t("sites.unassigned") },
              ...sites
                .filter((s) => s.active !== false)
                .map((s) => ({
                  value: s.id,
                  label: [s.name, s.type === "project" && s.endDate ? t("move.ends", { date: hrDate(s.endDate, locale) }) : null, t("move.same_trade", { n: sameTrade(s.id), trade: t(`trade.${emp.trade}` as "trade.mason") })].filter(Boolean).join(" · "),
                })),
            ]}
            placeholder={t("move.to")}
            searchPlaceholder={t("search")}
            noResultsText={t("no_results")}
            disabled={busy}
          />
          {siteId === UNASSIGNED_SITE && emp.siteId && <p className="text-[11px] text-muted-foreground">{t("move.bench_note")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mv-on">{t("move.effective")}</Label>
          <Input id="mv-on" type="date" dir="ltr" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} disabled={busy} />
        </div>
        {answers.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="mv-mr">{t("move.answers")}</Label>
            <Select value={mr || "__hr__"} onValueChange={(x) => setMr(x === "__hr__" ? "" : x)} disabled={busy}>
              <SelectTrigger id="mv-mr">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__hr__">{t("move.hr_decision")}</SelectItem>
                {answers.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {t("move.mr_option", { project: r.projectName, count: r.count, trade: t(`trade.${r.trade}` as "trade.mason"), date: hrDate(r.from, locale) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {future && <Callout tone="info">{t("move.future_note", { date: hrDate(effectiveOn, locale) })}</Callout>}
        <p className="text-xs text-muted-foreground">{target?.type === "project" ? t("move.projects_note") : t("move.cost_note")}</p>
      </div>
    )
  } else if (action === "pay") {
    title = raiseReq ? t("file.decide_raise_title", { no: raiseReq.no }) : t("file.act.pay")
    const n = Number(basic)
    const current = pay?.basic ?? 0
    const res = payChangeBlocks({ basic: n, currentBasic: current, effectiveOn: effectiveOn || null, reason, nationality: emp.nationality, lastClosedMonthStart: lastClosed ? monthRange(lastClosed).start : null, trade: kind === "promotion" ? trade : null })
    blocks = res.blocks
    // Management changes the HR manager's pay, not his record: a promotion's new trade is the HR manager's.
    const mgmtOnly = !access.ctx.owner && !access.ctx.roles.has("manager")
    if (mgmtOnly && kind === "promotion" && trade !== emp.trade) blocks = [...blocks, "trade_by_manager"]
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
    // The company's monthly delta with the employer's GOSI on basic + housing (the prototype's `dco`).
    const g = gosiRates(emp.nationality, emp.join)
    const delta = pay && next ? r2(wageOf(next) - wageOf(pay) + (next.basic + next.housing - pay.basic - pay.housing) * g.employer) : 0
    submit = () =>
      void run(
        () => changePay(firestore!, access.ctx, emp.id, actor, { basic: n, effectiveOn, reason, kind, trade: kind === "promotion" ? trade : null }, { policies: access.settings.policies, requestId: raiseReq?.id ?? null }),
        "file.pay_changed",
        blockPrefix
      )
    body = (
      <div className="space-y-4">
        {isHrManager && mgmtOnly && <Callout tone="info">{t("paychange.mgmt_note")}</Callout>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pc-kind">{t("paychange.kind")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as PayChangeKind)} disabled={busy}>
              <SelectTrigger id="pc-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_CHANGE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`paychange.kinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-basic">{t("paychange.new_basic")}</Label>
            <Input id="pc-basic" type="number" min="0" step="100" dir="ltr" value={basic} onChange={(e) => setBasic(e.target.value)} disabled={busy} />
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
            <KeyValueRow label={t("paychange.company_delta")} value={`${delta >= 0 ? "+" : "−"} ${hrMoney(Math.abs(delta))}`} ltr />
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
  } else if (action === "raise") {
    // EM-04 — asked for: the HR manager on a line manager's word, or for himself (then management decides).
    title = t("file.act.raise")
    const n = Number(basic)
    blocks = raiseRequestBlocks({ basic: n, kind, effectiveOn, reason, trade }, { currentBasic: pay?.basic ?? null, nationality: emp.nationality })
    blockPrefix = "paychange.block"
    const own = access.ctx.employeeId === emp.id
    submit = () =>
      void run(
        () => fileRequest(firestore!, access.ctx, access.orgId as string, actor, { employeeId: emp.id, kind: "raise", raise: { basic: n, kind, effectiveOn, reason, trade: kind === "promotion" ? trade : null } }, { policies: access.settings.policies }),
        "file.raise_filed",
        blockPrefix
      )
    body = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rq-kind">{t("paychange.kind")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as PayChangeKind)} disabled={busy}>
              <SelectTrigger id="rq-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_CHANGE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`paychange.kinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-basic">{t("paychange.new_basic")}</Label>
            <Input id="rq-basic" type="number" min="0" step="100" dir="ltr" value={basic} onChange={(e) => setBasic(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-on">{t("paychange.effective")}</Label>
            <Input id="rq-on" type="date" dir="ltr" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} disabled={busy} />
          </div>
          {kind === "promotion" && (
            <div className="space-y-1.5">
              <Label htmlFor="rq-trade">{t("new.trade")}</Label>
              <SearchableSelect
                id="rq-trade"
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
          <Label htmlFor="rq-why">{t("paychange.reason")}</Label>
          <Input id="rq-why" placeholder={t("file.raise_why_hint")} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
        </div>
        <Callout tone="info">{t(own || isHrManager ? "file.raise_to_management" : "file.raise_note")}</Callout>
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
    const view = emp.probationView
    submit = () => void run(() => decideProbation(firestore!, access.ctx, emp.id, actor, decision, { to: extTo, consentOn: consentOn || null, lastDay }), decision === "end" ? "file.probation_ended" : "file.probation_done", blockPrefix)
    body = (
      <div className="space-y-4">
        {/* EM-05 — the line manager's view, shown at the decision, never blocking it. */}
        {view ? (
          <Callout tone={view.recommend === "confirm" ? "info" : "warn"} title={t("pview.box_title", { name: view.byName || managerName || "—" })}>
            {t(`pview.ratings.${view.rating}`)} · {t(`pview.recs.${view.recommend}`)}
            {view.note && <span className="block" dir="auto">“{view.note}”</span>}
          </Callout>
        ) : (
          <Callout tone="info">{t("pview.none_box")}</Callout>
        )}
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
  } else if (action === "probation_view") {
    title = t("file.act.probation_view")
    blocks = probationViewBlocks(emp, { rating, recommend }, today)
    blockPrefix = "pview.block"
    submit = () => void run(() => recordProbationView(firestore!, access.ctx, emp.id, actor, { rating, recommend, note }), "pview.saved", blockPrefix)
    body = (
      <div className="space-y-4">
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t("pview.rating")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {([3, 2, 1] as const).map((r) => (
              <Button key={r} type="button" variant={rating === r ? "default" : "outline"} aria-pressed={rating === r} onClick={() => setRating(r)} disabled={busy} className="h-auto min-h-11 whitespace-normal py-2">
                {t(`pview.ratings.${r}`)}
              </Button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t("pview.recommend")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {PROBATION_RECOMMENDS.map((r) => (
              <Button key={r} type="button" variant={recommend === r ? "default" : "outline"} aria-pressed={recommend === r} onClick={() => setRecommend(r)} disabled={busy} className="h-auto min-h-11 whitespace-normal py-2">
                {t(`pview.recs.${r}`)}
              </Button>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor="pv-note">{t("pview.note")}</Label>
          <Textarea id="pv-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </div>
        <p className="text-xs text-muted-foreground">{t("pview.ends", { date: hrDate(emp.probation.end, locale) })}</p>
      </div>
    )
  } else if (action === "contract") {
    title = t("ct.title", { date: hrDate(emp.contract?.end, locale) })
    blocks = contractBlocks(emp, ctDecision, ctDecision === "renew" ? ctUntil || null : null)
    blockPrefix = "ct.block"
    submit = () =>
      void run(() => (ctDecision === "renew" ? renewContract(firestore!, access.ctx, emp.id, actor, { until: ctUntil || null }) : endContract(firestore!, access.ctx, emp.id, actor)), ctDecision === "renew" ? "ct.renewed" : "ct.ended", ctDecision === "renew" ? blockPrefix : "exit.block")
    body = (
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {(["renew", "end"] as const).map((k) => (
            <Button key={k} type="button" variant={ctDecision === k ? "default" : "outline"} aria-pressed={ctDecision === k} onClick={() => setCtDecision(k)} disabled={busy} className="h-auto min-h-11 whitespace-normal py-2">
              {t(`ct.${k}`)}
            </Button>
          ))}
        </div>
        {ctDecision === "renew" ? (
          <div className="space-y-1.5">
            <Label htmlFor="ct-until">{t("ct.until")}</Label>
            <Input id="ct-until" type="date" dir="ltr" min={emp.contract?.end ?? undefined} value={ctUntil} onChange={(e) => setCtUntil(e.target.value)} disabled={busy} />
            <p className="text-[11px] text-muted-foreground">{t("ct.qiwa_note")}</p>
          </div>
        ) : (
          <Callout tone="warn">{t("ct.end_note", { date: hrDate(emp.contract?.end, locale) })}</Callout>
        )}
        <p className="text-xs text-muted-foreground">{t("ct.default_note")}</p>
      </div>
    )
  } else if (action === "renew") {
    const row = held.find((r) => r.type === docType)
    const issue = !row?.expiry
    title = issue ? t("renew.title_issue") : t("file.act.renew")
    blocks = renewalBlocks(emp.docs ?? {}, docType, expiry || null, today)
    blockPrefix = "renew.block"
    const numbered = docType === "passport" || docType === "insurance" || docType === "licence"
    submit = () =>
      void run(
        () => recordRenewal(firestore!, access.ctx, emp.id, actor, { type: docType, expiry, fee: fee ? Number(fee) : null, number: numbered ? docNumber || null : null, insuranceToo: docType === "iqama" && insuranceToo }),
        "file.renewed",
        blockPrefix
      )
    body = (
      <div className="space-y-4">
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t("renew.document")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {held.map((r) => (
              <Button key={r.type} type="button" variant={docType === r.type ? "default" : "outline"} aria-pressed={docType === r.type} onClick={() => setDocType(r.type)} disabled={busy} className="h-auto min-h-11 flex-col items-start gap-0.5 whitespace-normal py-2 text-start">
                <span>{t(`doc.${r.type}`)}</span>
                <span className="text-[11px] font-normal opacity-80">
                  {!r.expiry ? (r.pendingDue ? t("file.not_issued") : t("file.doc_missing")) : docState(r.expiry, today) === "expired" ? t("renew.expired_on", { date: hrDate(r.expiry, locale) }) : t("renew.expires_on", { date: hrDate(r.expiry, locale) })}
                </span>
              </Button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="rn-e">{t("renew.expiry")}</Label>
            <Input id="rn-e" type="date" dir="ltr" value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={busy} />
          </div>
          {numbered && (
            <div className="space-y-1.5">
              <Label htmlFor="rn-n">{t("renew.number")}</Label>
              <Input id="rn-n" dir="ltr" value={docNumber} placeholder={emp.docs?.no?.[docType as "passport"] ?? ""} onChange={(e) => setDocNumber(e.target.value)} disabled={busy} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="rn-f">{t("renew.fee")}</Label>
            <Input id="rn-f" type="number" min="0" step="any" dir="ltr" value={fee} onChange={(e) => setFee(e.target.value)} disabled={busy} />
          </div>
        </div>
        {docType === "iqama" && (
          <div className="flex items-start gap-2">
            <Checkbox id="rn-ins" checked={insuranceToo} onCheckedChange={(c) => setInsuranceToo(c === true)} disabled={busy} />
            <Label htmlFor="rn-ins" className="text-sm font-normal leading-snug">
              {t("renew.insurance_too")}
            </Label>
          </div>
        )}
        {docType === "iqama" && passportFirst(emp.docs ?? {}, today) && <Callout tone="block">{t("renew.passport_first_note", { date: hrDate(emp.docs?.passport, locale) })}</Callout>}
        <p className="text-xs text-muted-foreground">{t("renew.note")}</p>
      </div>
    )
  } else if (action === "numbers") {
    title = t("file.act.numbers")
    const changed = DOC_NUMBER_KEYS.some((k) => (numbers[k]?.trim() || null) !== (emp.docs?.no?.[k] ?? null))
    blocks = changed ? [] : ["no_change"]
    blockPrefix = "numbers.block"
    const shown = DOC_NUMBER_KEYS.filter((k) => k !== "licence" || driveDocOf(emp.trade) === "licence")
    submit = () => void run(() => recordDocNumbers(firestore!, access.ctx, emp.id, actor, numbers), "numbers.saved", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`no-${k}`}>{t(`file.no_key.${k}`)}</Label>
              <Input id={`no-${k}`} dir="ltr" value={numbers[k] ?? ""} onChange={(e) => setNumbers((x) => ({ ...x, [k]: e.target.value }))} disabled={busy} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("numbers.note")}</p>
      </div>
    )
  } else if (action === "manager") {
    title = t("file.act.manager")
    const options = lineManagerOptions(emp, employees)
    blocks = lineManagerBlocks(emp, managerId || null, employees)
    blockPrefix = "mgr.block"
    submit = () => void run(() => setLineManager(firestore!, access.ctx, emp.id, actor, managerId || null), "mgr.saved", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="mg-who">{t("mgr.who")}</Label>
          <SearchableSelect
            id="mg-who"
            value={managerId || "__derived__"}
            onChange={(x) => setManagerId(x === "__derived__" ? "" : x)}
            options={[
              { value: "__derived__", label: t("mgr.derived_option") },
              ...options.map((e) => ({ value: e.id, label: `${displayName(e, locale)} · ${t(`trade.${e.trade}` as "trade.mason")}`, group: e.siteId && e.siteId === emp.siteId ? t("mgr.same_place") : t("mgr.elsewhere") })),
            ]}
            placeholder={t("mgr.who")}
            searchPlaceholder={t("search")}
            noResultsText={t("no_results")}
            disabled={busy}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("mgr.note", { name: managerName ?? t("file.line_manager_mgmt") })}</p>
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
        <p className="text-[11px] text-muted-foreground">{t("file.signed_as", { name: actor.name || "—", date: hrDate(today, locale) })}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || blocks.length > 0 || !firestore}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {action === "contract" && ctDecision === "end" ? t("ct.confirm_end") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
