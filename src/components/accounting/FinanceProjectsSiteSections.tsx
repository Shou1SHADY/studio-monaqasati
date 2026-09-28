"use client"

// The Projects desk's site side (PM 1.0 S-02 — PM tells, Finance posts): an
// approved subcontractor certificate becomes his payable and is paid here
// («سدّد» — PM reads `paid` back on each subcontract), petty purchases, approved
// store losses and materials moved between projects post once each to the
// project's cost, and two things are shown without posting: the approved
// estimate at completion (highest revision per project) and the signed
// addenda that change a financial term.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { BadgeCheck, Banknote, CheckCircle2, FileSignature, HardHat, Loader2, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { TermChangeList } from "@/components/pm/TermChangeList"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { ACC } from "@/lib/accounting/accounts"
import type { JournalEntry, SourceType } from "@/lib/accounting/journal"
import { PmFinanceError, paySubCertificate, postPmSiteCost, postPmSubCertificate } from "@/lib/accounting/pm-finance-writes"
import { pmCashPosting, pmEstimateRev, pmEventDay, pmLatestEstimates, pmLossPosting, pmSubNet, pmSubPayable, pmSubVat, pmSubVatFixed, pmTransferPosting } from "@/lib/accounting/pm-postings"
import type { PostingContext, PostingResult } from "@/lib/accounting/posting-rules"
import { eventDocId, type PmEvent } from "@/lib/pm/events"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { PM_SUB_CERTIFICATES, subCertificateNo } from "@/lib/pm/subcontract"
import { cn } from "@/lib/utils"
import { Empty, ProjectCell, Section } from "./FinanceProjectsParts"

const todayIso = () => new Date().toISOString().slice(0, 10)

/** Posted entries by `${sourceType}|${sourceId}` — a sub certificate and its payment share an id. */
export type PostedEntries = Map<string, Pick<JournalEntry, "lines">>
export const postedKey = (sourceType: SourceType, sourceId: string) => `${sourceType}|${sourceId}`

interface Shared {
  names: Map<string, string>
  posted: PostedEntries
  booksOn: boolean
  mayAct: boolean
  ctx: PostingContext
}

const errorKey = (err: unknown) => (err instanceof PmFinanceError ? `fpj_err_${err.code}` : "fpj_post_failed")

// ---------------------------------------------------------------------------
// Subcontractor certificates (prj:SC)
// ---------------------------------------------------------------------------

export function SubCertificatesSection({ events, ...shared }: Shared & { events: PmEvent[] }) {
  const t = useTranslations("Portal.Shared")
  const subs = events.filter((e) => e.kind === "SC")
  const unposted = subs.filter((e) => !shared.posted.has(postedKey("pm_sub_certificate", eventDocId(e.key)))).length
  return (
    <Section icon={HardHat} title={t("fpj_sc_title")} sub={t("fpj_sc_sub")} count={shared.booksOn ? unposted : 0}>
      {subs.length === 0 ? (
        <Empty>{t("fpj_sc_empty")}</Empty>
      ) : (
        <ul className="divide-y">
          {subs.map((e) => (
            <SubCertificateRow key={e.key} event={e} {...shared} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function SubCertificateRow({ event, names, posted, booksOn, mayAct, ctx }: Shared & { event: PmEvent }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const projectName = names.get(event.projectId) || ""
  const ref = useMemoFirebase(() => (firestore ? doc(firestore, "projects", event.projectId, PM_SUB_CERTIFICATES, subCertificateNo(Number(event.params.certificate) || 0)) : null), [firestore, event.projectId, event.key])
  const { data: cert } = useDoc(ref)
  const c = (cert || {}) as { paidOn?: string | null; paidAmount?: number }
  const entry = posted.get(postedKey("pm_sub_certificate", eventDocId(event.key)))
  const payableInBooks = entry ? entry.lines.filter((l) => l.account === ACC.suppliersPayable).reduce((a, l) => a + l.credit - l.debit, 0) : null
  const payable = payableInBooks ?? pmSubPayable(event, pmSubVat(event, true))
  const [dialog, setDialog] = useState<"post" | "pay" | null>(null)
  const sub = String(event.params.subcontractor || "")

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <ProjectCell
        event={event}
        projectName={projectName}
        sub={
          <>
            <span dir="auto">{t("fpj_sc_row_sub", { sub, no: String(event.params.certificate || ""), date: pmDate(event.at, locale) })}</span>
            <span className="block" dir="auto">
              {t("fpj_sc_breakdown", { gross: pmMoney(Number(event.params.gross) || 0), retention: pmMoney(Number(event.params.retention) || 0), recovery: pmMoney(Number(event.params.recovery) || 0) })}
            </span>
          </>
        }
      />
      <span className="text-end">
        <span className="block font-bold tabular-nums" dir="ltr">{pmMoney(c.paidOn ? Number(c.paidAmount) || payable : payable)}</span>
        <span className="block text-[11px] text-muted-foreground">{c.paidOn ? t("fpj_sc_paid", { date: pmDate(c.paidOn, locale) }) : t("fpj_sc_payable")}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {entry ? (
          <StatusPill tone="ok">
            <BadgeCheck size={12} aria-hidden="true" /> {t("fpj_in_books")}
          </StatusPill>
        ) : (
          booksOn &&
          mayAct && (
            <Button size="sm" variant="outline" className="h-8 border border-border bg-card text-xs text-foreground shadow-none hover:bg-muted" onClick={() => setDialog("post")}>
              {t("fpj_post")}
            </Button>
          )
        )}
        {c.paidOn ? (
          <StatusPill tone="ok">{t("fpj_sc_paid_pill")}</StatusPill>
        ) : (
          mayAct &&
          (booksOn && !entry ? (
            <span className="text-[11px] text-muted-foreground">{t("fpj_sc_post_first")}</span>
          ) : (
            <Button size="sm" className="h-8 bg-module text-xs text-module-foreground hover:bg-module/90" onClick={() => setDialog("pay")}>
              {t("fpj_sc_pay")}
            </Button>
          ))
        )}
      </span>
      {dialog && <SubCertificateDialog mode={dialog} event={event} projectName={projectName} payableInBooks={payableInBooks} booksOn={booksOn} ctx={ctx} onClose={() => setDialog(null)} />}
    </li>
  )
}

function SubCertificateDialog({ mode, event, projectName, payableInBooks, booksOn, ctx, onClose }: { mode: "post" | "pay"; event: PmEvent; projectName: string; payableInBooks: number | null; booksOn: boolean; ctx: PostingContext; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [registered, setRegistered] = useState(true)
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fixed = pmSubVatFixed(event)
  const vat = pmSubVat(event, registered)
  const chooseVat = !fixed && (mode === "post" || payableInBooks === null)
  const amount = mode === "pay" && payableInBooks !== null ? payableInBooks : pmSubPayable(event, vat)
  const no = String(event.params.certificate || "")
  const invalid = mode === "pay" && (!date || date > todayIso())

  const save = async () => {
    if (!firestore || invalid) return
    setBusy(true)
    setError(null)
    try {
      if (mode === "post") {
        await postPmSubCertificate(firestore, ctx, event, { vatRegistered: registered, projectName })
        toast({ title: t("fpj_posted") })
      } else {
        await paySubCertificate(firestore, ctx, { event, projectName, date, postToBooks: booksOn, vatRegistered: registered })
        toast({ title: t("fpj_sc_pay_done") })
      }
      onClose()
    } catch (err) {
      console.error(err)
      setError(t(errorKey(err)))
    } finally {
      setBusy(false)
    }
  }

  const rows: Array<[string, number]> = [
    [t("fpj_l_gross"), Number(event.params.gross) || 0],
    [t("fpj_l_retention"), -(Number(event.params.retention) || 0)],
    [t("fpj_l_recovery"), -(Number(event.params.recovery) || 0)],
    [t("fpj_l_net"), pmSubNet(event)],
    ...(mode === "pay" && payableInBooks !== null ? [] : ([[t("fpj_l_vat"), vat]] as Array<[string, number]>)),
  ]

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{mode === "post" ? t("fpj_sc_post_title", { no, project: event.projectNo }) : t("fpj_sc_pay_title", { no, sub: String(event.params.subcontractor || "") })}</DialogTitle>
          <DialogDescription>{mode === "post" ? t("fpj_sc_post_desc") : t("fpj_sc_pay_desc")}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-1 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
          {rows.map(([label, v]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums" dir="ltr">{pmMoney(v)}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t pt-1 font-bold">
            <dt>{t("fpj_l_payable")}</dt>
            <dd className="tabular-nums" dir="ltr">{pmMoney(amount)}</dd>
          </div>
        </dl>
        {chooseVat ? (
          <div className="flex items-center gap-2">
            <Checkbox id="fpj-sc-vat" checked={registered} onCheckedChange={(v) => setRegistered(v === true)} />
            <Label htmlFor="fpj-sc-vat" className="text-sm font-normal">
              {t("fpj_sc_vat_registered")}
            </Label>
          </div>
        ) : (
          fixed && mode === "post" && <p className="text-[11px] text-muted-foreground">{t("fpj_sc_vat_fixed")}</p>
        )}
        {mode === "pay" && (
          <div className="space-y-1.5">
            <Label htmlFor="fpj-sc-date">{t("fpj_sc_pay_date")}</Label>
            <Input id="fpj-sc-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
          </div>
        )}
        {mode === "pay" && !booksOn && <p className="text-[11px] text-muted-foreground">{t("fpj_sc_books_off")}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("acc_cancel")}
          </Button>
          <Button onClick={save} disabled={busy || invalid} className="gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mode === "post" ? t("fpj_post") : t("fpj_sc_pay")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Site costs: petty purchases (CASH), approved losses (LOSS), transfers (XFER)
// ---------------------------------------------------------------------------

const COST_KINDS = ["CASH", "LOSS", "XFER"] as const

function sitePosting(e: PmEvent, names: Map<string, string>): PostingResult | null {
  const projectName = names.get(e.projectId) || null
  if (e.kind === "CASH") return pmCashPosting(e, projectName)
  if (e.kind === "LOSS") return pmLossPosting(e, projectName)
  if (e.kind === "XFER") return pmTransferPosting(e, { projectName, fromProjectName: names.get(String(e.params.fromProjectId || "")) || null })
  return null
}

export function SiteCostsSection({ events, names, posted, booksOn, mayAct, ctx }: Shared & { events: PmEvent[] }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const rows = events.filter((e) => (COST_KINDS as readonly string[]).includes(e.kind)).map((e) => ({ event: e, posting: sitePosting(e, names) }))
  const isPosted = (p: PostingResult | null) => Boolean(p && posted.has(postedKey(p.sourceType, p.sourceId)))
  const pending = rows.filter((r) => r.posting && !r.posting.empty && !isPosted(r.posting))

  const postAll = async () => {
    if (!firestore) return
    setBusy(true)
    let done = 0
    let failed = 0
    for (const r of pending) {
      try {
        await postPmSiteCost(firestore, ctx, r.posting)
        done += 1
      } catch (err) {
        console.error(err)
        failed += 1
      }
    }
    setBusy(false)
    toast({ title: t("fpj_posted_n", { count: done }), ...(failed ? { description: t("fpj_failed_n", { count: failed }), variant: "destructive" as const } : {}) })
  }

  return (
    <Section
      icon={Banknote}
      title={t("fpj_cost_title")}
      sub={t("fpj_cost_sub")}
      count={booksOn ? pending.length : 0}
      action={
        booksOn && mayAct && pending.length > 1 ? (
          <Button size="sm" variant="outline" className="h-8 border border-border bg-card text-xs text-foreground shadow-none hover:bg-muted" onClick={postAll} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            {t("fpj_post_all", { count: pending.length })}
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <Empty>{t("fpj_cost_empty")}</Empty>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <SiteCostRow key={r.event.key} event={r.event} posting={r.posting} posted={isPosted(r.posting)} names={names} booksOn={booksOn} mayAct={mayAct} ctx={ctx} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function SiteCostRow({ event, posting, posted, names, booksOn, mayAct, ctx }: { event: PmEvent; posting: PostingResult | null; posted: boolean; names: Map<string, string>; booksOn: boolean; mayAct: boolean; ctx: PostingContext }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const p = event.params
  const date = pmDate(event.kind === "CASH" ? pmEventDay(event) : event.at, locale)
  const what =
    event.kind === "CASH"
      ? t(p.receipt ? "fpj_cash_sub" : "fpj_cash_sub_noreceipt", { what: String(p.what || ""), supplier: String(p.supplier || ""), receipt: String(p.receipt || ""), date })
      : event.kind === "LOSS"
        ? t("fpj_loss_sub", { qty: String(p.qty ?? ""), unit: String(p.unit || ""), material: String(p.material || ""), date })
        : t("fpj_xfer_sub", { qty: String(p.qty ?? ""), unit: String(p.unit || ""), material: String(p.material || ""), from: names.get(String(p.fromProjectId || "")) || String(p.fromProject || ""), date })

  const post = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await postPmSiteCost(firestore, ctx, posting)
      toast({ title: t("fpj_posted") })
    } catch (err) {
      console.error(err)
      toast({ title: t(errorKey(err)), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <ProjectCell
        event={event}
        projectName={names.get(event.projectId) || ""}
        sub={
          <>
            <span className="font-semibold text-foreground">{t(`fpj_cost_kind_${event.kind}` as "fpj_cost_kind_CASH")}</span> · <span dir="auto">{what}</span>
          </>
        }
      />
      <span className={cn("font-bold tabular-nums", !(event.amount > 0) && "text-muted-foreground")} dir="ltr">
        {pmMoney(event.amount || 0)}
      </span>
      {posted ? (
        <StatusPill tone="ok">
          <BadgeCheck size={12} aria-hidden="true" /> {t("fpj_in_books")}
        </StatusPill>
      ) : !posting || posting.empty ? (
        <span className="text-[11px] text-muted-foreground">{t("fpj_no_cost")}</span>
      ) : (
        booksOn &&
        mayAct && (
          <Button size="sm" variant="outline" className="h-8 border border-border bg-card text-xs text-foreground shadow-none hover:bg-muted" onClick={post} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            {t("fpj_post")}
          </Button>
        )
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Shown, never posted: the approved estimate (BUD) and financial addenda (AMD)
// ---------------------------------------------------------------------------

export function EstimatesSection({ events, names }: { events: PmEvent[]; names: Map<string, string> }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const latest = pmLatestEstimates(events).sort((a, b) => (b.at || "").localeCompare(a.at || ""))
  return (
    <Section icon={Target} title={t("fpj_bud_title")} sub={t("fpj_bud_sub")} count={0}>
      {latest.length === 0 ? (
        <Empty>{t("fpj_bud_empty")}</Empty>
      ) : (
        <ul className="divide-y">
          {latest.map((e) => {
            const margin = Number(e.params.margin) || 0
            return (
              <li key={e.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <ProjectCell
                  event={e}
                  projectName={names.get(e.projectId) || ""}
                  sub={
                    <>
                      {t("fpj_bud_row", { rev: pmEstimateRev(e), date: pmDate(e.at, locale) })}
                      <span className="block" dir="auto">
                        {t("fpj_bud_detail", { contract: pmMoney(Number(e.params.contract) || 0), actual: pmMoney(Number(e.params.actual) || 0) })}
                      </span>
                    </>
                  }
                />
                <span className="text-end">
                  <span className="block font-bold tabular-nums" dir="ltr">{pmMoney(Number(e.params.estimate ?? e.amount) || 0)}</span>
                  <span className={cn("block text-[11px]", margin < 0 ? "font-semibold text-destructive" : "text-muted-foreground")}>{t("fpj_bud_margin", { v: pmMoney(margin) })}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

export function AddendaSection({ events, names }: { events: PmEvent[]; names: Map<string, string> }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const amds = events.filter((e) => e.kind === "AMD")
  return (
    <Section icon={FileSignature} title={t("fpj_amd_title")} sub={t("fpj_amd_sub")} count={0}>
      {amds.length === 0 ? (
        <Empty>{t("fpj_amd_empty")}</Empty>
      ) : (
        <ul className="divide-y">
          {amds.map((e) => (
            <li key={e.key} className="space-y-2 px-5 py-3">
              <ProjectCell event={e} projectName={names.get(e.projectId) || ""} sub={t("fpj_amd_row", { no: String(e.params.addendum || ""), date: pmDate(String(e.params.signedOn || e.at), locale) })} />
              {e.changes?.length ? <TermChangeList changes={e.changes} className="ps-1" /> : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
