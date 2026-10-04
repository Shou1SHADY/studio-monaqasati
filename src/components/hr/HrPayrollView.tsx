"use client"

// Payroll (PRD §5 "Payroll", WF-06; PY-01…08): the month is computed live from
// the closed workplaces and the contract; the blocking facts say why it cannot
// be prepared yet; payroll prepares, the HR manager — never the preparer —
// approves and the events go to Finance. A held line waits; the rest goes.
// The Mudad file and the GOSI statement are produced here and uploaded by a
// person (no platform connection, GV-01).

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { CheckCircle2, Download, Loader2, Receipt, RefreshCw } from "lucide-react"
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
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import {
  computePayroll,
  computeSupplementary,
  gosiCsv,
  lineWarnings,
  mudadCsv,
  payrollBlocks,
  payrollId,
  payrollTotals,
  sitesToClose,
  type Payroll,
  type PayrollLine,
  type PayrollState,
  type SupplementaryLine,
} from "@/lib/hr/payroll"
import { approvePayroll, preparePayroll, prepareSupplementary } from "@/lib/hr/payroll-writes"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
import type { HrViolation } from "@/lib/hr/violations"
import { addDays, r2 } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import type { HrPortal } from "./HrShell"

const STATE_TONE: Record<PayrollState, PillTone> = { prepared: "warn", approved: "info", posted: "violet", paid: "ok" }
type Filter = "all" | "exceptions" | "held"

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function HrPayrollView({ access, portal }: { access: HrAccess; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile } = usePermissions()
  const { toast } = useToast()
  const today = todayDay()
  const orgId = access.orgId
  const actor = { uid: user?.uid ?? "", name: (profile?.name as string) || null }
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
  const [month, setMonth] = useState(lastMonth)
  const [filter, setFilter] = useState<Filter>("all")
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)

  const { employees, sites, siteName } = useHrPeople(access)
  const pays = useOrgPay(orgId, true)
  const { requests } = useHrRequests(access)
  const attQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, HR_ATTENDANCE), where("organizationId", "==", orgId), where("month", "==", month)) : null), [firestore, orgId, month])
  const { data: attData } = useCollection(attQ)
  const vioQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, HR_VIOLATIONS), where("organizationId", "==", orgId), where("deductMonth", "==", month)) : null), [firestore, orgId, month])
  const { data: vioData } = useCollection(vioQ)
  const attendance = (attData ?? []) as unknown as WorkplaceMonth[]
  const mainRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, HR_PAYROLLS, payrollId(orgId, month)) : null), [firestore, orgId, month])
  const { data: mainData } = useDoc(mainRef)
  const saved = (mainData as unknown as Payroll | null) ?? null
  // PY-04 — the month's supplementaries (-D, -D2…): each approved one is sent; what arrives after goes to the next.
  const supQ = useMemoFirebase(
    () => (firestore && orgId ? query(collection(firestore, HR_PAYROLLS), where("organizationId", "==", orgId), where("month", "==", month), where("kind", "==", "supplementary")) : null),
    [firestore, orgId, month]
  )
  const { data: supData } = useCollection(supQ)
  const sups = useMemo(() => ((supData ?? []) as unknown as Payroll[]).slice().sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true })), [supData])
  const openSup = sups.find((s) => s.state === "prepared") ?? null
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7)
  const prevRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, HR_PAYROLLS, payrollId(orgId, prevMonth)) : null), [firestore, orgId, prevMonth])
  const { data: prevData } = useDoc(prevRef)

  const live = useMemo(
    () =>
      computePayroll({ month, employees, pays, sites, attendance, requests, previous: (prevData as unknown as Payroll | null)?.lines ?? null, violations: (vioData ?? []) as unknown as HrViolation[] }),
    [month, employees, pays, sites, attendance, requests, prevData, vioData]
  )
  const { blocks, unclosed } = payrollBlocks({ month, today, sites, employees, attendance, missingPay: live.missingPay, state: saved?.state ?? null })
  const frozen = saved && saved.state !== "prepared"
  const lines: PayrollLine[] = frozen ? saved.lines : live.lines
  const totals = payrollTotals(lines)
  const stale = saved?.state === "prepared" && payrollTotals(saved.lines).net !== payrollTotals(live.lines).net
  const shown = lines.filter((l) => (filter === "held" ? l.held : filter === "exceptions" ? lineWarnings(l).length > 0 : true))
  const supLines = useMemo(
    () => computeSupplementary({ month, employees, pays, sites, main: saved, done: sups, violations: (vioData ?? []) as unknown as HrViolation[] }),
    [month, employees, pays, sites, saved, sups, vioData]
  )
  const supNet = (ls: SupplementaryLine[]) => r2(ls.reduce((s, l) => s + l.net, 0))
  const supStale = openSup !== null && supNet(openSup.supplementary ?? []) !== supNet(supLines)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (!firestore || !orgId) return
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `payroll.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  const prepare = () =>
    run(() => preparePayroll(firestore!, access.ctx, orgId!, month, actor, { lines: live.lines, sitesToClose: sitesToClose(month, sites, employees, attendance), missingPay: live.missingPay }), "payroll.prepared_ok")
  const mayApprove = (p: Payroll | null) => Boolean(p && p.state === "prepared" && (access.ctx.owner || mayApprovePayroll(access.ctx, p.prepared.by)))
  const name = (id: string) => employees.find((e) => e.id === id)?.names?.ar ?? id
  const months = [0, 1, 2].map((i) => addDays(`${today.slice(0, 7)}-01`, -1 - i * 28).slice(0, 7)).filter((m, i, a) => a.indexOf(m) === i)

  const kpi = (label: string, value: string, tone?: string) => (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-black tabular-nums", tone)} dir="ltr">
        {value}
      </p>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {months.map((m) => (
          <Button key={m} size="sm" variant={month === m ? "default" : "outline"} aria-pressed={month === m} onClick={() => setMonth(m)} className="rounded-full">
            {m}
          </Button>
        ))}
        <Input type="month" dir="ltr" aria-label={t("att.month")} value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 w-40" />
        {saved ? <StatusPill tone={STATE_TONE[saved.state]}>{t(`payroll.state.${saved.state}`)}</StatusPill> : <StatusPill tone="mute">{t("payroll.state.none")}</StatusPill>}
      </div>

      {saved && (
        <p className="text-xs text-muted-foreground">
          {t("payroll.prepared_by", { name: saved.prepared.byName || "—", at: hrDate(saved.prepared.at, locale) })}
          {saved.approved && ` · ${t("payroll.approved_by", { name: saved.approved.byName || "—", at: hrDate(saved.approved.at, locale) })}`}
        </p>
      )}

      {!frozen && (
        <BlockingReasons
          title={t("payroll.cannot_prepare")}
          reasons={blocks.map((b) =>
            b === "unclosed"
              ? t("payroll.block.unclosed_list", { sites: unclosed.map((id) => siteName(id) ?? (id === UNASSIGNED_SITE ? t("sites.unassigned") : id)).join("، ") })
              : b === "no_pay"
                ? t("payroll.block.no_pay_list", { names: live.missingPay.map(name).join("، ") })
                : t(`payroll.block.${b}`)
          )}
        />
      )}
      {!frozen && unclosed.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {unclosed.map((id) => (
            <Button key={id} asChild size="sm" variant="outline">
              <Link href={`/${portal}/hr/sites/${id}`}>{siteName(id) ?? id}</Link>
            </Button>
          ))}
        </div>
      )}
      {stale && <Callout tone="warn">{t("payroll.stale")}</Callout>}

      <div className="flex flex-wrap gap-2">
        {!frozen && access.allowed("payroll.prepare") && (
          <Button onClick={() => void prepare()} disabled={busy || blocks.length > 0}>
            {busy ? <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" /> : <RefreshCw size={15} className="me-1.5" aria-hidden="true" />}
            {t(saved ? "payroll.recompute" : "payroll.prepare")}
          </Button>
        )}
        {mayApprove(saved) && !stale && (
          <Button onClick={() => setConfirm(month)} disabled={busy}>
            <CheckCircle2 size={15} className="me-1.5" aria-hidden="true" />
            {t("payroll.approve")}
          </Button>
        )}
        {saved?.state === "prepared" && !mayApprove(saved) && access.allowed("payroll.approve") && <p className="self-center text-xs text-muted-foreground">{t("payroll.not_preparer")}</p>}
        {frozen && (
          <>
            <Button variant="outline" onClick={() => download(`mudad-${month}.csv`, mudadCsv(lines, pays))}>
              <Download size={15} className="me-1.5" aria-hidden="true" />
              {t("payroll.mudad")}
            </Button>
            <Button variant="outline" onClick={() => download(`gosi-${month}.csv`, gosiCsv(lines, pays))}>
              <Download size={15} className="me-1.5" aria-hidden="true" />
              {t("payroll.gosi")}
            </Button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {kpi(t("payroll.k.people"), String(totals.people))}
        {kpi(t("payroll.k.gross"), hrMoney(totals.gross))}
        {kpi(t("payroll.k.deductions"), hrMoney(totals.deductions))}
        {kpi(t("payroll.k.gosi"), hrMoney(totals.gosiEmployee + totals.gosiEmployer))}
        {kpi(t("payroll.k.advances"), hrMoney(totals.advances))}
        {kpi(t("payroll.k.net"), hrMoney(totals.net), "text-module")}
        {kpi(t("payroll.k.held", { n: totals.heldCount }), hrMoney(totals.heldNet), totals.heldCount ? "text-warning" : undefined)}
      </div>

      <Panel
        title={t("payroll.lines")}
        icon={Receipt}
        count={shown.length}
        bodyClassName="p-0"
        actions={
          <div className="flex gap-1" role="group" aria-label={t("payroll.filter")}>
            {(["all", "exceptions", "held"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} aria-pressed={filter === f} onClick={() => setFilter(f)} className="h-8 rounded-full text-xs">
                {t(`payroll.f.${f}`)}
              </Button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                {(["no", "name", "site", "days", "absent", "ot", "gross", "deductions", "net", "notes"] as const).map((c) => (
                  <th key={c} scope="col" className={cn("px-3 py-2 font-bold", ["days", "absent", "ot", "gross", "deductions", "net"].includes(c) ? "text-end" : "text-start")}>
                    {t(`payroll.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.employeeId} className={cn("border-t", l.held && "bg-warning/5")}>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground" dir="ltr">
                    {empNo(l.no)}
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    <Link href={`/${portal}/hr/people/${l.employeeId}`} className="rounded hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                      {l.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">{l.siteId ? (siteName(l.siteId) ?? "—") : t("sites.unassigned")}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{l.days}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{l.attendance.absent}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{l.attendance.overtimeHours}</td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                    {hrMoney(l.gross)}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                    {hrMoney(l.gross - l.net)}
                  </td>
                  <td className="px-3 py-2 text-end font-bold tabular-nums" dir="ltr">
                    {hrMoney(l.net)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {lineWarnings(l).map((w) => (
                        <StatusPill key={w} tone={w === "held" || w === "net_negative" ? "bad" : "warn"}>
                          {t(`payroll.w.${w}`)}
                        </StatusPill>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    {t("payroll.no_lines")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

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
                        {t("payroll.approve")}
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

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("payroll.confirm_title", { key: confirm ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("payroll.confirm_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && void run(() => approvePayroll(firestore!, access.ctx, orgId!, confirm, actor), "payroll.approved_ok")}>{t("payroll.approve")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
