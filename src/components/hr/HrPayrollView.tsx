"use client"

// Payroll (PRD §5 "Payroll", WF-06; PY-01…09, AD-01…03): one segment per
// month — the month still running (no lines before it ends: the contract
// estimate and each workplace's closing), the last months' payrolls (a ● when
// one waits for approval) — and the Advances. A payroll is computed live from
// the closed workplaces and the contract; the blocking facts say why it cannot
// be prepared yet; payroll prepares, the HR manager — never the preparer —
// approves and the events go to Finance. A held line waits; the rest goes. The
// lines open on the exceptions, by cost centre. The Mudad file (the month's,
// a supplementary's, the "-R" release file) and the GOSI statement are previewed
// here and uploaded by a person (no platform connection, GV-01); the
// reconciliation reads what Finance did.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { CheckCircle2, FileText, Loader2, Lock, Receipt, RefreshCw, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { SegmentedNav, type Segment } from "@/components/module-ui/SegmentedNav"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { Link } from "@/i18n/routing"
import { mayApprovePayroll } from "@/lib/hr/access"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import { HR_ATTENDANCE, HR_PAYROLLS, HR_VIOLATIONS } from "@/lib/hr/collections"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import {
  computePayroll,
  computeSupplementary,
  contractEstimate,
  daysAfterPayDay,
  gosiCsv,
  gosiStatement,
  mudadFile,
  payrollBlocks,
  payrollOpensOn,
  payrollTotals,
  recordedThrough,
  releaseFile,
  sitesToClose,
  type Payroll,
  type PayrollLine,
  type PayrollState,
  type SupplementaryLine,
} from "@/lib/hr/payroll"
import { approvePayroll, preparePayroll, prepareSupplementary } from "@/lib/hr/payroll-writes"
import type { HrRequest } from "@/lib/hr/requests"
import { HR_SETTINGS } from "@/lib/hr/settings"
import { UNASSIGNED_SITE, type HrSite } from "@/lib/hr/sites"
import type { HrViolation } from "@/lib/hr/violations"
import { addDays, monthRange, r2 } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import { HrAdvancesView } from "./HrAdvancesView"
import { HrPayrollFileDialog, type FilePreview } from "./HrPayrollFiles"
import { HrPayrollLines } from "./HrPayrollLines"
import { CostCentreBar, PayrollEventsPanel, ReconciliationPanel } from "./HrPayrollPanels"
import type { HrPortal } from "./HrShell"

const STATE_TONE: Record<PayrollState, PillTone> = { prepared: "warn", approved: "info", posted: "violet", paid: "ok" }
const ADVANCES = "adv"

const monthOf = (day: string) => day.slice(0, 7)
const prevMonth = (month: string) => monthOf(addDays(`${month}-01`, -1))

/** "August 2026" in the reader's language. */
function monthLabel(month: string, locale: string) {
  const d = new Date(`${month}-01T00:00:00`)
  return Number.isNaN(d.getTime()) ? month : d.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-US", { month: "long", year: "numeric" })
}

/** The establishment's Mudad number (Settings → establishment file, `establishment.mudadNo`) — read from the settings
 * document as stored, defensively: older settings have none, and the normalised settings may not carry the field. */
function useMudadNo(access: HrAccess): string | null {
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore && access.orgId ? doc(firestore, HR_SETTINGS, access.orgId) : null), [firestore, access.orgId])
  const { data } = useDoc(ref)
  const fromDoc = (data as { establishment?: { mudadNo?: unknown } } | null)?.establishment?.mudadNo
  const fromSettings = (access.settings.establishment as { mudadNo?: unknown } | undefined)?.mudadNo
  const v = typeof fromSettings === "string" && fromSettings.trim() ? fromSettings : fromDoc
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export function HrPayrollView({ access, portal }: { access: HrAccess; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const orgId = access.orgId
  const current = monthOf(today)
  const recent = [prevMonth(current), prevMonth(prevMonth(current)), prevMonth(prevMonth(prevMonth(current)))]
  const [seg, setSeg] = useState<string>(recent[0])

  const { employees, sites, siteName } = useHrPeople(access)
  const pays = useOrgPay(orgId, true)
  const { requests } = useHrRequests(access)
  // Every payroll of the company — the segments' markers, the month's supplementaries and the previous month's lines.
  const allQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, HR_PAYROLLS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: allData } = useCollection(allQ)
  const payrolls = useMemo(() => ((allData ?? []) as unknown as Payroll[]).slice().sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true })), [allData])
  const waiting = (m: string) => payrolls.some((p) => p.month === m && p.state === "prepared")

  const months = [...(recent.includes(seg) || seg === current || seg === ADVANCES ? [] : [seg]), ...recent].sort().reverse()
  const segments: Segment[] = [
    { id: current, label: t("payroll.seg.running", { month: monthLabel(current, locale) }), count: waiting(current) ? "!" : undefined, tone: "warn" },
    ...months.map((m) => ({ id: m, label: monthLabel(m, locale), count: waiting(m) ? ("!" as const) : undefined, tone: "warn" as const })),
    { id: ADVANCES, label: t("payroll.seg.advances"), count: requests.filter((r) => r.kind === "advance" && (r.state === "pending" || r.state === "endorsed")).length || undefined, tone: "warn" },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <SegmentedNav segments={segments} active={seg} onSelect={setSeg} ariaLabel={t("payroll.seg.aria")} />
        </div>
        <Input
          type="month"
          dir="ltr"
          aria-label={t("payroll.seg.other")}
          value={seg === ADVANCES ? "" : seg}
          max={current}
          onChange={(e) => e.target.value && setSeg(e.target.value)}
          className="h-9 w-40"
        />
      </div>
      {seg === ADVANCES ? (
        <HrAdvancesView access={access} portal={portal} employees={employees} pays={pays} requests={requests} today={today} />
      ) : (
        <PayrollMonth key={seg} access={access} portal={portal} month={seg} today={today} employees={employees} sites={sites} siteName={siteName} pays={pays} requests={requests} payrolls={payrolls} />
      )}
    </div>
  )
}

function PayrollMonth({
  access,
  portal,
  month,
  today,
  employees,
  sites,
  siteName: nameOf,
  pays,
  requests,
  payrolls,
}: {
  access: HrAccess
  portal: HrPortal
  month: string
  today: string
  employees: HrEmployee[]
  sites: HrSite[]
  siteName: (id: string | null | undefined) => string | null
  pays: Map<string, EmployeePay>
  requests: HrRequest[]
  payrolls: Payroll[]
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile } = usePermissions()
  const { toast } = useToast()
  const orgId = access.orgId
  const actor = { uid: user?.uid ?? "", name: (profile?.name as string) || null }
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const mudadNo = useMudadNo(access)
  const siteName = (id: string | null) => (id && id !== UNASSIGNED_SITE ? (nameOf(id) ?? id) : t("sites.unassigned"))
  const tradeOf = (id: string) => {
    const e = employees.find((x) => x.id === id)
    return e?.trade ? t(`trade.${e.trade}` as "trade.mason") : null
  }

  const attQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, HR_ATTENDANCE), where("organizationId", "==", orgId), where("month", "==", month)) : null), [firestore, orgId, month])
  const { data: attData } = useCollection(attQ)
  const vioQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, HR_VIOLATIONS), where("organizationId", "==", orgId), where("deductMonth", "==", month)) : null), [firestore, orgId, month])
  const { data: vioData } = useCollection(vioQ)
  const attendance = useMemo(() => (attData ?? []) as unknown as WorkplaceMonth[], [attData])
  const violations = useMemo(() => (vioData ?? []) as unknown as HrViolation[], [vioData])
  const saved = payrolls.find((p) => p.key === month) ?? null
  // PY-04 — the month's supplementaries (-D, -D2…): each approved one is sent; what arrives after goes to the next.
  const sups = payrolls.filter((p) => p.month === month && p.kind === "supplementary")
  const openSup = sups.find((s) => s.state === "prepared") ?? null
  const previous = payrolls.find((p) => p.key === prevMonth(month))?.lines ?? null
  const running = today <= monthRange(month).end

  const live = useMemo(() => computePayroll({ month, employees, pays, sites, attendance, requests, previous, violations }), [month, employees, pays, sites, attendance, requests, previous, violations])
  const { blocks, unclosed } = payrollBlocks({ month, today, sites, employees, attendance, missingPay: live.missingPay, state: saved?.state ?? null })
  const frozen = Boolean(saved && saved.state !== "prepared")
  const lines: PayrollLine[] = frozen && saved ? saved.lines : live.lines
  const totals = payrollTotals(lines)
  const stale = saved?.state === "prepared" && payrollTotals(saved.lines).net !== payrollTotals(live.lines).net
  const supLines = useMemo(() => computeSupplementary({ month, employees, pays, sites, main: saved, done: sups, violations }), [month, employees, pays, sites, saved, sups, violations])
  const supNet = (ls: SupplementaryLine[]) => r2(ls.reduce((s, l) => s + l.net, 0))
  const supStale = openSup !== null && supNet(openSup.supplementary ?? []) !== supNet(supLines)
  const toClose = sitesToClose(month, sites, employees, attendance)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (!firestore || !orgId) return
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok as "payroll.prepared_ok") })
    } catch (err) {
      console.error(err)
      toast({ title: t((err instanceof HrWriteError ? (err.blocks[0] ? `payroll.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save") as "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  const prepare = () => run(() => preparePayroll(firestore!, access.ctx, orgId!, month, actor, { lines: live.lines, sitesToClose: toClose, missingPay: live.missingPay }), "payroll.prepared_ok")
  const mayApprove = (p: Payroll | null) => Boolean(p && p.state === "prepared" && (access.ctx.owner || mayApprovePayroll(access.ctx, p.prepared.by)))
  const name = (id: string) => employees.find((e) => e.id === id)?.names?.ar ?? id
  const blockText = (b: string) =>
    b === "unclosed"
      ? t("payroll.block.unclosed_list", { sites: unclosed.map((id) => siteName(id)).join("، ") })
      : b === "no_pay"
        ? t("payroll.block.no_pay_list", { names: live.missingPay.map(name).join("، ") })
        : t(`payroll.block.${b}` as "payroll.block.not_over")
  const payrollName = (p: Pick<Payroll, "month" | "kind" | "key">) =>
    p.kind === "supplementary" ? t("payroll.name_sup", { month: monthLabel(p.month, locale), key: p.key }) : t("payroll.name", { month: monthLabel(p.month, locale) })
  const openMudad = (p: Payroll) => setPreview({ kind: "mudad", title: t("payroll.file.mudad_title", { name: payrollName(p) }), file: mudadFile(p, pays, mudadNo), establishment: mudadNo })
  const openRelease = (p: Payroll) => {
    const f = releaseFile(p, pays, mudadNo)
    if (f) setPreview({ kind: "mudad", title: t("payroll.file.release_title", { name: payrollName(p) }), file: f, establishment: mudadNo })
  }
  const openGosi = (p: Payroll) =>
    setPreview({ kind: "gosi", title: t("payroll.file.gosi_title", { name: payrollName(p) }), statement: gosiStatement(p.lines, pays), name: `gosi-${p.month}.csv`, csv: gosiCsv(p.lines, pays), subscription: access.settings.establishment?.gosi ?? null })

  // PY-02 — the month still running: no lines, the contract estimate, each workplace's closing.
  if (running && !saved) {
    return (
      <Panel title={t("payroll.name", { month: monthLabel(month, locale) })} icon={Receipt} actions={<StatusPill tone="mute">{t("payroll.state.collecting")}</StatusPill>} bodyClassName="space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Kpi label={t("payroll.collecting.estimate")} value={hrMoney(contractEstimate(employees, pays, month))} />
          <Kpi label={t("payroll.collecting.recorded")} value={hrDate(recordedThrough(attendance, toClose), locale)} />
          <Kpi label={t("payroll.collecting.opens")} value={hrDate(payrollOpensOn(month), locale)} />
        </div>
        <Callout tone="info">{t("payroll.collecting.note")}</Callout>
        <div className="space-y-2">
          <p className="text-sm font-bold">{t("payroll.collecting.sites")}</p>
          {toClose.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("payroll.collecting.no_sites")}</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {toClose.map((id) => {
                const closed = attendance.some((a) => a.siteId === id && a.closed)
                return (
                  <li key={id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <Link href={`/${portal}/hr/sites/${id}`} className="rounded font-semibold hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                      {siteName(id)}
                    </Link>
                    <StatusPill tone={closed ? "ok" : "mute"}>{t(closed ? "payroll.collecting.closed" : "payroll.collecting.open")}</StatusPill>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {access.allowed("payroll.prepare") && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled>
              <Lock size={15} className="me-1.5" aria-hidden="true" />
              {t("payroll.collecting.open_payroll", { month: monthLabel(month, locale) })}
            </Button>
            <span className="text-xs text-muted-foreground">{t("payroll.collecting.blocked", { reasons: blocks.map(blockText).join(" · ") })}</span>
          </div>
        )}
      </Panel>
    )
  }

  const returnedIds = Object.keys(saved?.returned ?? {})
  const late = saved?.paid?.date ? daysAfterPayDay(month, access.settings.policies.payDay, saved.paid.date) : 0
  const ibanState = (id: string) => {
    if (saved?.paidHeld?.[id]) return t("payroll.flow.iban.repaid", { date: hrDate(saved.paidHeld[id].date, locale) })
    const s = pays.get(id)?.ibanState
    return t(s === "returned" ? "payroll.flow.iban.returned" : s === "fixed" ? "payroll.flow.iban.fixed" : "payroll.flow.iban.ok")
  }
  const release = saved ? releaseFile(saved, pays) : null

  return (
    <div className="space-y-5">
      <Panel
        title={t("payroll.name", { month: monthLabel(month, locale) })}
        icon={Receipt}
        actions={
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {saved ? <StatusPill tone={STATE_TONE[saved.state]}>{t(`payroll.state.${saved.state}`)}</StatusPill> : <StatusPill tone="mute">{t("payroll.state.none")}</StatusPill>}
            {t("payroll.lines_count", { n: lines.length })}
            {totals.heldCount > 0 && ` · ${t("payroll.held_count", { n: totals.heldCount })}`}
          </span>
        }
        bodyClassName="space-y-4"
      >
        {saved && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              {t("payroll.prepared_by", { name: saved.prepared.byName || "—", at: hrDate(saved.prepared.at, locale) })}
              {saved.approved && ` · ${t("payroll.approved_by", { name: saved.approved.byName || "—", at: hrDate(saved.approved.at, locale) })}`}
            </p>
            {saved.state === "approved" && <p>{t("payroll.flow.sent")}</p>}
            {(saved.state === "posted" || saved.state === "paid") && saved.posted && <p>{t("payroll.flow.posted", { date: hrDate(saved.posted.at, locale) })}</p>}
            {saved.state === "paid" && (
              <p className="flex flex-wrap items-center gap-2">
                {t("payroll.flow.paid", { date: hrDate(saved.paid?.date ?? saved.paid?.at, locale) })}
                {late > 0 && <StatusPill tone="warn">{t("payroll.flow.late", { n: late })}</StatusPill>}
              </p>
            )}
          </div>
        )}
        {returnedIds.length > 0 && (
          <Callout tone="block" title={t("payroll.flow.returned_title", { n: returnedIds.length })}>
            <ul className="space-y-0.5">
              {returnedIds.map((id) => (
                <li key={id}>
                  <span dir="auto" className="font-semibold">
                    {saved?.lines.find((l) => l.employeeId === id)?.name ?? name(id)}
                  </span>{" "}
                  · {hrDate(saved?.returned?.[id]?.date, locale)} · {saved?.returned?.[id]?.reason ?? "—"} — {ibanState(id)}
                </li>
              ))}
            </ul>
          </Callout>
        )}

        {!frozen && (
          <BlockingReasons title={t("payroll.cannot_prepare")} reasons={blocks.map(blockText)} />
        )}
        {!frozen && unclosed.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {unclosed.map((id) => (
              <Button key={id} asChild size="sm" variant="outline">
                <Link href={`/${portal}/hr/sites/${id}`}>{siteName(id)}</Link>
              </Button>
            ))}
          </div>
        )}
        {stale && <Callout tone="warn">{t("payroll.stale")}</Callout>}
        {!frozen && saved && totals.heldCount > 0 && <Callout tone="warn">{t("payroll.held_note", { n: totals.heldCount })}</Callout>}

        <div className="flex flex-wrap items-center gap-2">
          {!frozen && access.allowed("payroll.prepare") && (
            <Button onClick={() => void prepare()} disabled={busy || blocks.length > 0}>
              {busy ? <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" /> : <RefreshCw size={15} className="me-1.5" aria-hidden="true" />}
              {t(saved ? "payroll.recompute" : "payroll.prepare")}
            </Button>
          )}
          {mayApprove(saved) && !stale && (
            <>
              <Button onClick={() => setConfirm(month)} disabled={busy}>
                <CheckCircle2 size={15} className="me-1.5" aria-hidden="true" />
                {t("payroll.approve_send")}
              </Button>
              <span className="text-xs text-muted-foreground">{t("payroll.after_approve")}</span>
            </>
          )}
          {saved?.state === "prepared" && !mayApprove(saved) && access.allowed("payroll.approve") && <p className="text-xs text-muted-foreground">{t("payroll.not_preparer")}</p>}
          {saved?.state === "prepared" && !access.allowed("payroll.approve") && access.allowed("payroll.prepare") && <p className="text-xs text-muted-foreground">{t("payroll.approval_is_manager")}</p>}
          {frozen && saved && (
            <>
              <Button variant="outline" onClick={() => openMudad(saved)}>
                <FileText size={15} className="me-1.5" aria-hidden="true" />
                {t("payroll.mudad")}
              </Button>
              <Button variant="outline" onClick={() => openGosi(saved)}>
                <ShieldCheck size={15} className="me-1.5" aria-hidden="true" />
                {t("payroll.gosi")}
              </Button>
              {release && (
                <Button variant="outline" onClick={() => openRelease(saved)}>
                  <FileText size={15} className="me-1.5" aria-hidden="true" />
                  {t("payroll.release", { n: release.rows.length })}
                </Button>
              )}
              <span className="text-xs text-muted-foreground">{t("payroll.files_note")}</span>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Kpi label={t("payroll.k.people")} value={String(totals.people)} />
          <Kpi label={t("payroll.k.gross")} value={hrMoney(totals.gross)} />
          <Kpi label={t("payroll.k.deductions")} value={hrMoney(totals.deductions)} tone="text-destructive" />
          <Kpi label={t("payroll.k.gosi")} value={hrMoney(totals.gosiEmployee + totals.gosiEmployer)} />
          <Kpi label={t("payroll.k.advances")} value={hrMoney(totals.advances)} />
          <Kpi label={t("payroll.k.net")} value={hrMoney(totals.net)} tone="text-success" />
          <Kpi label={t("payroll.k.held", { n: totals.heldCount })} value={hrMoney(totals.heldNet)} tone={totals.heldCount ? "text-warning" : undefined} />
        </div>
      </Panel>

      {lines.length > 0 && <CostCentreBar lines={lines} siteName={siteName} />}

      <HrPayrollLines lines={lines} portal={portal} siteName={siteName} tradeOf={tradeOf} returned={saved?.returned} />

      {frozen && saved && orgId && <ReconciliationPanel payroll={saved} today={today} orgId={orgId} employees={employees} pays={pays} />}
      {lines.length > 0 && <PayrollEventsPanel payroll={frozen && saved ? saved : { key: month, month, kind: "main", lines }} siteName={siteName} />}

      {frozen && (sups.length > 0 || supLines.length > 0) && (
        <Panel title={t("payroll.sup_list_title")} icon={Receipt} count={sups.length + (openSup || !supLines.length ? 0 : 1)}>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("payroll.sup_desc")}</p>
            {sups.map((s) => (
              <div key={s.key} className="space-y-2 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold" dir="ltr">
                    {s.key}
                  </span>
                  <StatusPill tone={STATE_TONE[s.state]}>{t(`payroll.state.${s.state}`)}</StatusPill>
                  <span className="ms-auto text-sm font-bold tabular-nums" dir="ltr">
                    {hrMoney(supNet(s.supplementary ?? []))}
                  </span>
                </div>
                <SupLines lines={s.supplementary ?? []} />
                {s === openSup && supStale && <Callout tone="warn">{t("payroll.stale")}</Callout>}
                {s === openSup && (
                  <div className="flex flex-wrap gap-2">
                    {access.allowed("payroll.prepare") && supLines.length > 0 && (
                      <Button variant="outline" disabled={busy} onClick={() => void run(() => prepareSupplementary(firestore!, access.ctx, orgId!, month, actor, supLines), "payroll.prepared_ok")}>
                        {t("payroll.recompute")}
                      </Button>
                    )}
                    {mayApprove(s) && !supStale && (
                      <Button disabled={busy} onClick={() => setConfirm(s.key)}>
                        {t("payroll.approve_send")}
                      </Button>
                    )}
                  </div>
                )}
                {s.state !== "prepared" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openMudad(s)}>
                      <FileText size={14} className="me-1.5" aria-hidden="true" />
                      {t("payroll.mudad")}
                    </Button>
                    {releaseFile(s, pays) && (
                      <Button size="sm" variant="outline" onClick={() => openRelease(s)}>
                        <FileText size={14} className="me-1.5" aria-hidden="true" />
                        {t("payroll.release", { n: releaseFile(s, pays)?.rows.length ?? 0 })}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!openSup && supLines.length > 0 && (
              <div className="space-y-2 rounded-xl border border-dashed p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{t("payroll.sup_next")}</span>
                  <StatusPill tone="mute">{t("payroll.state.none")}</StatusPill>
                  <span className="ms-auto text-sm font-bold tabular-nums" dir="ltr">
                    {hrMoney(supNet(supLines))}
                  </span>
                </div>
                <SupLines lines={supLines} />
                {access.allowed("payroll.prepare") && (
                  <Button variant="outline" disabled={busy} onClick={() => void run(() => prepareSupplementary(firestore!, access.ctx, orgId!, month, actor, supLines), "payroll.prepared_ok")}>
                    {t("payroll.prepare")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </Panel>
      )}

      <HrPayrollFileDialog preview={preview} onClose={() => setPreview(null)} />

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("payroll.confirm_title", { key: confirm ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("payroll.confirm_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && void run(() => approvePayroll(firestore!, access.ctx, orgId!, confirm, actor), "payroll.approved_ok")}>{t("payroll.approve_send")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-black tabular-nums", tone)}>
        <bdi dir="ltr">{value}</bdi>
      </p>
    </div>
  )
}

/** A supplementary's lines: each person, what the line is made of, and its net. */
function SupLines({ lines }: { lines: SupplementaryLine[] }) {
  const t = useTranslations("Portal.HR")
  return (
    <ul className="divide-y rounded-xl border">
      {lines.map((l) => (
        <li key={l.employeeId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <span dir="auto" className={cn(l.held && "text-warning")}>
            {l.name}
            {l.held && ` · ${t("payroll.w.held")}`}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {l.retro !== 0 && <span>{t("payroll.sup_item.retro", { amount: hrMoney(l.retro) })}</span>}
            {(l.commission ?? 0) !== 0 && <span>{t("payroll.sup_item.commission", { amount: hrMoney(l.commission) })}</span>}
            {(l.refunds ?? 0) !== 0 && <span>{t("payroll.sup_item.refund", { amount: hrMoney(l.refunds) })}</span>}
            <span className="font-bold tabular-nums text-foreground" dir="ltr">
              {hrMoney(l.net)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
