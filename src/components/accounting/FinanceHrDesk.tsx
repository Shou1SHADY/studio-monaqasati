"use client"

// Finance's desk for HR (PRD HR §7.2–7.4, WF-06 steps 5–7, AD-03). HR
// computes, approves and notifies; Finance posts and pays — here, where Finance
// works: the events to post (hr:PAY, hr:EOS), the payrolls to pay, the lines a
// bank returned or HR held, and the advances — above HR's limit to decide,
// approved ones to pay out. No wage is recomputed here.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { Banknote, BookCheck, HandCoins, Loader2, Lock, LogOut, Receipt, RotateCcw, ShieldCheck, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useHrAccess } from "@/hooks/useHrAccess"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import { accountName, POSTABLE_ACCOUNTS } from "@/lib/accounting/accounts"
import { HR_EVENTS, HR_PAY, HR_PAYROLLS, HR_REQUESTS, HR_SETTLEMENTS } from "@/lib/hr/collections"
import type { EmployeePay } from "@/lib/hr/employee"
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import type { HrSettlement } from "@/lib/hr/exit-writes"
import { gosiAmount, markReturned, owedLines, payAdvance, payFeeRequest, payHeldLine, paySettlement, postHrEvent, recordGosiPaid, recordPayrollPaid, returnableLines, transferAmount, type FinanceActor, type FinancePayroll, type HrEvent, type HrFeeEvent } from "@/lib/hr/finance-writes"
import { gosiDueOn } from "@/lib/hr/payroll"
import { postHrEos, postHrPay } from "@/lib/accounting/posting-rules"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { EntryPreview } from "@/components/hr/HrPayrollPanels"
import { financeDecideAdvance } from "@/lib/hr/request-writes"
import { requestNoDisplay, type HrRequest } from "@/lib/hr/requests"
import { r2 } from "@/lib/hr/statutory"
import { payTrainingCost, type TrainingCostEvent } from "@/lib/hr/training-writes"
import { HrWriteError } from "@/lib/hr/write-guard"
import { AccountingShell } from "./AccountingShell"

type PayrollDoc = FinancePayroll
type Pending =
  | { kind: "pay"; p: PayrollDoc }
  | { kind: "return"; p: PayrollDoc }
  | { kind: "held"; p: PayrollDoc; employeeId: string; name: string; net: number }
  | { kind: "advance"; r: HrRequest }
  | { kind: "decide"; r: HrRequest }
  | { kind: "settlement"; st: HrSettlement }
  | { kind: "fee"; ev: HrFeeEvent }
  | { kind: "training"; ev: TrainingCostEvent }
  | { kind: "gosi"; p: PayrollDoc }

const BANKS = POSTABLE_ACCOUNTS.filter((a) => a.code.startsWith("1101")).map((a) => a.code)

export function FinanceHrDesk({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can, profile } = usePermissions()
  const access = useHrAccess()
  const orgId = access.orgId
  const allowed = can("invoices.manage") || can("accounting.post")
  const actor: FinanceActor = { uid: access.ctx.uid, name: (profile?.name as string) || null, allowed, employeeId: access.ctx.employeeId }
  const [pending, setPending] = useState<Pending | null>(null)
  const [date, setDate] = useState(todayDay())
  const [bank, setBank] = useState(BANKS[0] ?? "")
  const [note, setNote] = useState("")
  const [who, setWho] = useState("")
  const [busy, setBusy] = useState(false)

  const orgQ = (name: string, extra?: ReturnType<typeof where>) => (firestore && orgId && allowed ? query(collection(firestore, name), where("organizationId", "==", orgId), ...(extra ? [extra] : [])) : null)
  const evQ = useMemoFirebase(() => orgQ(HR_EVENTS), [firestore, orgId, allowed])
  const prQ = useMemoFirebase(() => orgQ(HR_PAYROLLS), [firestore, orgId, allowed])
  const avQ = useMemoFirebase(() => orgQ(HR_REQUESTS, where("kind", "==", "advance")), [firestore, orgId, allowed])
  const fsQ = useMemoFirebase(() => orgQ(HR_SETTLEMENTS, where("state", "==", "approved")), [firestore, orgId, allowed])
  const { data: fsData } = useCollection(fsQ)
  const settlements = (fsData ?? []) as unknown as HrSettlement[]
  const setRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, "accounting_settings", orgId) : null), [firestore, orgId])
  const { data: evData, isLoading } = useCollection(evQ)
  const { data: prData } = useCollection(prQ)
  const { data: avData } = useCollection(avQ)
  const { data: accSettings } = useDoc(setRef)
  const accountingOn = (accSettings as { enabled?: boolean } | null)?.enabled === true

  // A settlement (hr:FS) is paid from its own section below, not posted here.
  const events = ((evData ?? []) as unknown as HrEvent[]).filter((e) => e.state === "sent" && (e.kind === "PAY" || e.kind === "EOS")).sort((a, b) => a.key.localeCompare(b.key))
  // DC-03 — payment requests (hr:PR): a renewal's government fee, paid here.
  const fees = ((evData ?? []) as unknown as Array<HrEvent | HrFeeEvent>).filter((e): e is HrFeeEvent => e.kind === "PR" && e.state === "sent").sort((a, b) => a.key.localeCompare(b.key))
  // TR-04 — a training session's cost (hr:TRN): an external course, paid here.
  const trainings = ((evData ?? []) as unknown as Array<{ kind: string; state: string }>).filter((e): e is TrainingCostEvent => e.kind === "TRN" && e.state === "sent").sort((a, b) => a.key.localeCompare(b.key))
  const payrolls = ((prData ?? []) as unknown as PayrollDoc[]).sort((a, b) => b.key.localeCompare(a.key))
  const toPay = payrolls.filter((p) => p.state === "posted" || (p.state === "approved" && !accountingOn))
  // PY-03 — every paid payroll, however old: a held line never drops out of view, and a returned transfer is
  // recorded on the payroll it came from (newest first in the picker).
  const paid = payrolls.filter((p) => p.state === "paid")
  const held = owedLines(payrolls)
  // PY-09 — fin:GOSIPAID: a main payroll Finance has posted or paid, its contributions not yet paid.
  const gosiToPay = payrolls.filter((p) => p.kind === "main" && (p.state === "posted" || p.state === "paid") && !p.gosiPaid).sort((a, b) => a.key.localeCompare(b.key))
  const today = todayDay()
  const advances = (avData ?? []) as unknown as (HrRequest & { payout?: unknown })[]
  const toDecide = advances.filter((r) => r.state === "finance")
  const toPayOut = advances.filter((r) => r.state === "approved" && !r.payout)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
      setPending(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `fhd.block.${err.blocks[0]}` : `err.${err.code}`) : "fhd.failed"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  const books = { accountingOn, date, bankAccount: bank }
  const open = (p: Pending) => {
    setNote("")
    setWho("")
    setDate(todayDay())
    setPending(p)
  }

  const submit = () => {
    if (!firestore || !orgId || !pending) return
    if (pending.kind === "pay") void run(() => recordPayrollPaid(firestore, actor, orgId, pending.p, books), "fhd.paid_ok")
    else if (pending.kind === "return") void run(() => markReturned(firestore, actor, orgId, pending.p, who, note, books), "fhd.returned_ok")
    else if (pending.kind === "held") void run(() => payHeldLine(firestore, actor, orgId, pending.p, pending.employeeId, books), "fhd.paid_ok")
    else if (pending.kind === "advance") void run(() => payAdvance(firestore, actor, orgId, pending.r, books), "fhd.advance_paid_ok")
    else if (pending.kind === "settlement") void run(() => paySettlement(firestore, actor, orgId, pending.st, books), "fhd.settlement_paid_ok")
    else if (pending.kind === "fee") void run(() => payFeeRequest(firestore, actor, orgId, pending.ev, books), "fhd.fee_paid_ok")
    else if (pending.kind === "training") void run(() => payTrainingCost(firestore, actor, orgId, pending.ev, books), "fhd.fee_paid_ok")
    else if (pending.kind === "gosi") void run(() => recordGosiPaid(firestore, actor, orgId, pending.p, books), "fhd.gosi_paid_ok")
  }
  const decide = (verdict: "approve" | "decline") => {
    if (!firestore || pending?.kind !== "decide") return
    void run(() => financeDecideAdvance(firestore, actor, allowed, pending.r.id, verdict, note), verdict === "approve" ? "fhd.decided_ok" : "fhd.declined_ok")
  }

  const row = (key: string, main: React.ReactNode, sub: React.ReactNode, action: React.ReactNode) => (
    <li key={key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-bold">{main}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      {action}
    </li>
  )
  const empty = (text: string) => <p className="py-3 text-center text-sm text-muted-foreground">{text}</p>

  return (
    <AccountingShell portal={portal} title={t("fhd.title")} description={t("fhd.desc")} icon={Users}>
      {!allowed ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} aria-hidden="true" />
          {t("fhd.no_permission")}
        </p>
      ) : isLoading || access.isLoading ? (
        <div className="flex justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <div className="space-y-5">
          {!accountingOn && <Callout tone="info">{t("fhd.accounting_off")}</Callout>}

          <Panel title={t("fhd.to_post")} icon={BookCheck} count={events.length || undefined}>
            {events.length === 0 ? (
              empty(t("fhd.to_post_empty"))
            ) : (
              <ul className="divide-y rounded-xl border">
                {events.map((e) => (
                  <li key={e.id} className="space-y-2 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="text-sm font-bold">
                          <span dir="ltr">{e.key}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{t(`fhd.event.${e.kind}`, { amount: hrMoney(r2(e.debit.reduce((s, d) => s + d.amount, 0))) })}</p>
                      </div>
                      <Button size="sm" disabled={busy || !accountingOn} onClick={() => void run(() => postHrEvent(firestore!, actor, orgId!, e, { accountingOn }), "fhd.posted_ok")}>
                        {t("fhd.post")}
                      </Button>
                    </div>
                    {/* §7.2 — the entry as it will post, before «Post». */}
                    <DrawerSection title={t("fhd.show_entry")} defaultOpen={false}>
                      <EntryPreview
                        result={
                          e.kind === "PAY"
                            ? postHrPay({ key: e.key, month: e.month, date: e.month, debit: e.debit, credit: e.credit as { salariesPayable: number; gosi: number; advances: number; fines: number } })
                            : postHrEos({ key: e.key, month: e.month, date: e.month, debit: e.debit, credit: e.credit as { eosProvision: number; leaveProvision: number } })
                        }
                      />
                    </DrawerSection>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t("fhd.gosi")} icon={ShieldCheck} count={gosiToPay.length || undefined}>
            {gosiToPay.length === 0 ? (
              empty(t("fhd.gosi_empty"))
            ) : (
              <ul className="divide-y rounded-xl border">
                {gosiToPay.map((p) =>
                  row(
                    p.id,
                    <span dir="ltr">{p.key}</span>,
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {t("fhd.gosi_line", { amount: hrMoney(gosiAmount(p)), date: hrDate(gosiDueOn(p.month), locale) })}
                      {today > gosiDueOn(p.month) && <StatusPill tone="bad">{t("fhd.gosi_overdue")}</StatusPill>}
                    </span>,
                    <Button size="sm" disabled={busy} onClick={() => open({ kind: "gosi", p })}>
                      {t("fhd.record_gosi")}
                    </Button>
                  )
                )}
              </ul>
            )}
          </Panel>

          <Panel title={t("fhd.to_pay")} icon={Banknote} count={toPay.length || undefined}>
            {toPay.length === 0 ? (
              empty(t("fhd.to_pay_empty"))
            ) : (
              <ul className="divide-y rounded-xl border">
                {toPay.map((p) =>
                  row(
                    p.id,
                    <span dir="ltr">{p.key}</span>,
                    t("fhd.transfer_line", { amount: hrMoney(transferAmount(p)), held: (p.kind === "supplementary" ? (p.supplementary ?? []) : p.lines).filter((l) => l.held).length }),
                    <Button size="sm" disabled={busy} onClick={() => open({ kind: "pay", p })}>
                      {t("fhd.record_paid")}
                    </Button>
                  )
                )}
              </ul>
            )}
          </Panel>

          <Panel
            title={t("fhd.held")}
            icon={RotateCcw}
            count={held.length || undefined}
            actions={
              paid.length > 0 ? (
                <Button size="sm" variant="outline" onClick={() => open({ kind: "return", p: paid[0] })}>
                  {t("fhd.mark_returned")}
                </Button>
              ) : null
            }
          >
            {held.length === 0 ? (
              empty(t("fhd.held_empty"))
            ) : (
              <ul className="divide-y rounded-xl border">
                {held.map((h) => (
                  <HeldRow key={`${h.p.id}-${h.employeeId}`} h={h} busy={busy} onPay={() => open({ kind: "held", p: h.p, employeeId: h.employeeId, name: h.name, net: h.net })} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t("fhd.fees")} icon={Receipt} count={fees.length || undefined}>
            {fees.length === 0 ? (
              empty(t("fhd.fees_empty"))
            ) : (
              <ul className="divide-y rounded-xl border">
                {fees.map((ev) =>
                  row(
                    ev.id,
                    <span dir="ltr">{ev.key}</span>,
                    t("fhd.fee_line", { no: empNo(ev.employeeNo), doc: t(`doc.${ev.doc}` as "doc.iqama"), expiry: hrDate(ev.expiry, locale), amount: hrMoney(ev.amount) }),
                    <Button size="sm" disabled={busy} onClick={() => open({ kind: "fee", ev })}>
                      {t("fhd.pay_out")}
                    </Button>
                  )
                )}
              </ul>
            )}
          </Panel>

          {trainings.length > 0 && (
            <Panel title={t("fhd.trainings")} icon={Receipt} count={trainings.length}>
              <ul className="divide-y rounded-xl border">
                {trainings.map((ev) =>
                  row(
                    ev.id,
                    <span dir="ltr">{ev.key}</span>,
                    t("fhd.training_line", { course: t(`train.course.${ev.course}` as "train.course.ind"), date: hrDate(ev.at, locale), n: ev.count, amount: hrMoney(ev.amount) }),
                    <Button size="sm" disabled={busy} onClick={() => open({ kind: "training", ev })}>
                      {t("fhd.pay_out")}
                    </Button>
                  )
                )}
              </ul>
            </Panel>
          )}

          <Panel title={t("fhd.settlements")} icon={LogOut} count={settlements.length || undefined}>
            {settlements.length === 0 ? (
              empty(t("fhd.settlements_empty"))
            ) : (
              <ul className="divide-y rounded-xl border">
                {settlements.map((st) =>
                  row(
                    st.id,
                    `${empNo(st.no)} · ${t(`exit.reasons.${st.reason}`)}`,
                    t("fhd.settlement_line", { net: hrMoney(st.net), last: hrDate(st.lastDay, locale) }),
                    <Button size="sm" disabled={busy || st.employeeId === access.ctx.employeeId} onClick={() => open({ kind: "settlement", st })}>
                      {t("fhd.pay_out")}
                    </Button>
                  )
                )}
              </ul>
            )}
          </Panel>

          <Panel title={t("fhd.advances")} icon={HandCoins} count={toDecide.length + toPayOut.length || undefined}>
            {toDecide.length + toPayOut.length === 0 ? (
              empty(t("fhd.advances_empty"))
            ) : (
              <ul className="divide-y rounded-xl border">
                {toDecide.map((r) =>
                  row(
                    r.id,
                    `${requestNoDisplay(r.no, locale)} · ${r.employeeName}`,
                    `${hrMoney(r.advance?.amount)} · ${t("fhd.hr_view")}: ${r.decision?.note || "—"}`,
                    <Button size="sm" disabled={busy || r.employeeId === access.ctx.employeeId} onClick={() => open({ kind: "decide", r })}>
                      {t("fhd.decide")}
                    </Button>
                  )
                )}
                {toPayOut.map((r) =>
                  row(
                    r.id,
                    `${requestNoDisplay(r.no, locale)} · ${r.employeeName}`,
                    t("fhd.payout_line", { amount: hrMoney(r.advance?.amount), months: r.advance?.months ?? 0 }),
                    <Button size="sm" disabled={busy || r.employeeId === access.ctx.employeeId} onClick={() => open({ kind: "advance", r })}>
                      {t("fhd.pay_out")}
                    </Button>
                  )
                )}
              </ul>
            )}
          </Panel>
        </div>
      )}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pending ? t(`fhd.dialog.${pending.kind}`) : ""}</DialogTitle>
            <DialogDescription>
              {pending?.kind === "pay" && t("fhd.transfer_line", { amount: hrMoney(transferAmount(pending.p)), held: 0 })}
              {pending?.kind === "held" && `${pending.name} · ${hrMoney(pending.net)}`}
              {(pending?.kind === "advance" || pending?.kind === "decide") && `${requestNoDisplay(pending.r.no, locale)} · ${pending.r.employeeName} · ${hrMoney(pending.r.advance?.amount)}`}
              {pending?.kind === "return" && t("fhd.return_desc", { key: pending.p.key })}
              {pending?.kind === "settlement" && `${empNo(pending.st.no)} · ${hrMoney(pending.st.net)}`}
              {pending?.kind === "gosi" && `${pending.p.key} · ${hrMoney(gosiAmount(pending.p))}`}
              {pending?.kind === "training" && `${t(`train.course.${pending.ev.course}` as "train.course.ind")} · ${hrMoney(pending.ev.amount)}`}
              {pending?.kind === "fee" &&`${empNo(pending.ev.employeeNo)} · ${t(`doc.${pending.ev.doc}` as "doc.iqama")} · ${hrMoney(pending.ev.amount)}`}
            </DialogDescription>
          </DialogHeader>
          {pending?.kind === "return" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="fhd-payroll">{t("fhd.which_payroll")}</Label>
                <SearchableSelect
                  id="fhd-payroll"
                  value={pending.p.id}
                  onChange={(v) => {
                    const p = paid.find((x) => x.id === v)
                    if (p) {
                      setWho("")
                      setPending({ kind: "return", p })
                    }
                  }}
                  options={paid.map((p) => ({ value: p.id, label: `${p.key} · ${hrDate(p.paid?.date, locale)}` }))}
                  placeholder={t("fhd.which_payroll")}
                  searchPlaceholder={t("search")}
                  noResultsText={t("no_results")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fhd-who">{t("fhd.who")}</Label>
                <SearchableSelect
                  id="fhd-who"
                  value={who}
                  onChange={setWho}
                  options={returnableLines(pending.p).map((l) => ({ value: l.employeeId, label: `${empNo(l.no)} · ${l.name} · ${hrMoney(l.net)}` }))}
                  placeholder={t("fhd.who")}
                  searchPlaceholder={t("search")}
                  noResultsText={t("no_results")}
                />
              </div>
            </div>
          )}
          {pending && pending.kind !== "decide" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fhd-date">{t("fhd.date")}</Label>
                <Input id="fhd-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
              </div>
              {accountingOn && (
                <div className="space-y-1.5">
                  <Label htmlFor="fhd-bank">{t("fhd.bank")}</Label>
                  <SearchableSelect id="fhd-bank" value={bank} onChange={setBank} options={BANKS.map((c) => ({ value: c, label: `${c} · ${accountName(c, locale)}` }))} placeholder={t("fhd.bank")} searchPlaceholder={t("search")} noResultsText={t("no_results")} />
                </div>
              )}
            </div>
          )}
          {(pending?.kind === "return" || pending?.kind === "decide") && (
            <div className="space-y-1.5">
              <Label htmlFor="fhd-note">{t(pending.kind === "return" ? "fhd.return_reason" : "req.note")}</Label>
              <Textarea id="fhd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            {pending?.kind === "decide" ? (
              <>
                <Button variant="destructive" disabled={busy || !note.trim()} onClick={() => decide("decline")}>
                  {t("req.act.decline")}
                </Button>
                <Button disabled={busy} onClick={() => decide("approve")}>
                  {t("req.act.approve")}
                </Button>
              </>
            ) : (
              <Button onClick={submit} disabled={busy || !date || (pending?.kind === "return" && (!who || !note.trim()))}>
                {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                {pending ? t(`fhd.confirm.${pending.kind}`) : ""}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AccountingShell>
  )
}

/** A held or returned line: payable once HR approved its IBAN. */
function HeldRow({ h, busy, onPay }: { h: { p: PayrollDoc; employeeId: string; no: number; name: string; net: number; reason: string | null }; busy: boolean; onPay: () => void }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore ? doc(firestore, HR_PAY, h.employeeId) : null), [firestore, h.employeeId])
  const { data } = useDoc(ref)
  const pay = data as unknown as EmployeePay | null
  const ready = Boolean(pay?.iban) && pay?.ibanState !== "returned" && pay?.ibanState !== "fixed"
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-bold">
          <span dir="ltr">{h.p.key}</span> · {empNo(h.no)} · <span dir="auto">{h.name}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {hrMoney(h.net)} · {h.reason ? t("fhd.returned_because", { reason: h.reason }) : t("fhd.held_iban")}
          {h.p.paid?.date ? ` · ${hrDate(h.p.paid.date, locale)}` : ""}
        </p>
      </div>
      {ready ? <StatusPill tone="ok">{t("fhd.iban_ready")}</StatusPill> : <StatusPill tone="warn">{t("fhd.iban_waiting")}</StatusPill>}
      <Button size="sm" disabled={busy || !ready} onClick={onPay}>
        {t("fhd.pay_line")}
      </Button>
    </li>
  )
}
