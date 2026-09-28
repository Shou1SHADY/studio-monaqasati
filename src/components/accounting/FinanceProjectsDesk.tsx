"use client"

// Finance's desk for Project Management (PM 1.0 S-02: PM tells, Finance posts).
// PM's outbox (`pmEvents`) carries what Finance must act on: a certified
// certificate (revenue — posted by itself at certification when Accounting is
// on, or from here), what the client pays on it, the retention a handover makes
// claimable, and the advance the contract asks for. PM reads the answers back:
// `collected` on the certificate and `pm.retentionReleased` on the project.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { BadgeCheck, CheckCircle2, HandCoins, KeyRound, Loader2, Lock, Receipt, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { Link } from "@/i18n/routing"
import { JOURNAL_ENTRIES } from "@/lib/accounting/journal"
import { isAccountingEnabled } from "@/lib/accounting/post"
import { PmFinanceError, postPmCertificate, recordPmCollection, releasePmRetention } from "@/lib/accounting/pm-finance-writes"
import { outstandingOf, pmCertificateSeq } from "@/lib/accounting/pm-postings"
import type { PostingContext } from "@/lib/accounting/posting-rules"
import { PM_CERTIFICATES, certificateNo } from "@/lib/pm/certificate"
import { PM_EVENTS, eventDocId, type PmEvent } from "@/lib/pm/events"
import { pmDate, pmMoney } from "@/lib/pm/format"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { cn } from "@/lib/utils"
import { AccountingShell } from "./AccountingShell"

const todayIso = () => new Date().toISOString().slice(0, 10)

export function FinanceProjectsDesk({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile, can } = usePermissions()
  const orgId = (profile?.organizationId as string | undefined) || user?.uid || ""
  const ctx: PostingContext = { organizationId: orgId, userId: user?.uid || "", userName: (profile?.name as string | undefined) || user?.email || "" }
  const mayAct = can("invoices.manage")

  const eventsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PM_EVENTS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: eventsData, isLoading } = useCollection(eventsQ)
  const projectsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: projectsData } = useCollection(projectsQ)
  const journalQ = useMemoFirebase(
    () => (firestore && orgId ? query(collection(firestore, JOURNAL_ENTRIES), where("organizationId", "==", orgId), where("sourceType", "in", ["ipc_claim", "retention_release"])) : null),
    [firestore, orgId]
  )
  const { data: journalData } = useCollection(journalQ)
  const [booksOn, setBooksOn] = useState<boolean | null>(null)
  useEffect(() => {
    if (!firestore || !orgId) return
    void isAccountingEnabled(firestore, orgId).then(setBooksOn).catch(() => setBooksOn(false))
  }, [firestore, orgId])

  const names = useMemo(() => new Map(((projectsData || []) as Array<{ id: string; name?: string }>).map((p) => [p.id, p.name || ""])), [projectsData])
  const retentionReleased = useMemo(() => new Set(((projectsData || []) as Array<{ id: string; pm?: { retentionReleased?: boolean } | null }>).filter((p) => p.pm?.retentionReleased).map((p) => p.id)), [projectsData])
  const posted = useMemo(() => new Set(((journalData || []) as Array<{ sourceId?: string }>).map((e) => e.sourceId || "")), [journalData])
  const events = useMemo(() => ((eventsData || []) as unknown as PmEvent[]).sort((a, b) => (b.at || "").localeCompare(a.at || "")), [eventsData])
  const certs = events.filter((e) => e.kind === "IPC")
  const handovers = events.filter((e) => e.kind === "HND" && e.amount > 0)
  const advances = events.filter((e) => e.kind === "ADV")

  return (
    <AccountingShell portal={portal} title={t("fpj_title")} description={t("fpj_desc")} icon={KeyRound}>
      {!mayAct && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} aria-hidden="true" />
          {t("fpj_read_only")}
        </p>
      )}
      {booksOn === false && <p className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-2.5 text-xs text-warning">{t("fpj_books_off")}</p>}

      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <>
          <Section icon={Receipt} title={t("fpj_certs_title")} sub={t("fpj_certs_sub")} count={certs.filter((e) => !posted.has(eventDocId(e.key))).length}>
            {certs.length === 0 ? (
              <Empty>{t("fpj_certs_empty")}</Empty>
            ) : (
              <ul className="divide-y">
                {certs.map((e) => (
                  <CertificateRow key={e.key} event={e} projectName={names.get(e.projectId) || ""} posted={posted.has(eventDocId(e.key))} booksOn={booksOn === true} mayAct={mayAct} ctx={ctx} />
                ))}
              </ul>
            )}
          </Section>

          <Section icon={Wallet} title={t("fpj_ret_title")} sub={t("fpj_ret_sub")} count={handovers.filter((e) => !posted.has(eventDocId(e.key))).length}>
            {handovers.length === 0 ? (
              <Empty>{t("fpj_ret_empty")}</Empty>
            ) : (
              <ul className="divide-y">
                {handovers.map((e) => (
                  <RetentionRow key={e.key} event={e} projectName={names.get(e.projectId) || ""} released={posted.has(eventDocId(e.key)) || (e.params.stage === "final" && retentionReleased.has(e.projectId))} booksOn={booksOn === true} mayAct={mayAct} ctx={ctx} />
                ))}
              </ul>
            )}
          </Section>

          <Section icon={HandCoins} title={t("fpj_adv_title")} sub={t("fpj_adv_sub")} count={0}>
            {advances.length === 0 ? (
              <Empty>{t("fpj_adv_empty")}</Empty>
            ) : (
              <ul className="divide-y">
                {advances.map((e) => (
                  <li key={e.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <ProjectCell event={e} projectName={names.get(e.projectId) || ""} sub={t("fpj_adv_rate", { rate: Math.round(Number(e.params.rate) * 100) })} />
                    <span className="font-bold tabular-nums" dir="ltr">{pmMoney(e.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {advances.length > 0 && (
              <p className="border-t px-5 py-2.5 text-[11px] text-muted-foreground">
                {t("fpj_adv_note")}{" "}
                <Link href="/contractor/accounting/settlements" className="rounded font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t("fpj_adv_link")}
                </Link>
              </p>
            )}
          </Section>
        </>
      )}
    </AccountingShell>
  )
}

function ProjectCell({ event, projectName, sub }: { event: PmEvent; projectName: string; sub: string }) {
  return (
    <span className="min-w-0 flex-1">
      <Link href={`/contractor/projects/${event.projectId}`} className="rounded font-bold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span dir="ltr">{event.projectNo}</span>
        {projectName && <span dir="auto"> — {projectName}</span>}
      </Link>
      <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span>
    </span>
  )
}

function CertificateRow({ event, projectName, posted, booksOn, mayAct, ctx }: { event: PmEvent; projectName: string; posted: boolean; booksOn: boolean; mayAct: boolean; ctx: PostingContext }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const ref = useMemoFirebase(() => (firestore ? doc(firestore, "projects", event.projectId, PM_CERTIFICATES, certificateNo(pmCertificateSeq(event))) : null), [firestore, event.projectId, event.key])
  const { data: cert } = useDoc(ref)
  const c = (cert || {}) as { net?: number; collected?: number; status?: string }
  const net = Number(c.net ?? event.params.net) || 0
  const outstanding = outstandingOf(net, Number(c.collected) || 0)
  const due = String(event.params.due || "")
  const late = outstanding > 0 && due && due < todayIso()
  const [busy, setBusy] = useState(false)
  const [collecting, setCollecting] = useState(false)

  const post = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await postPmCertificate(firestore, ctx, event, projectName)
      toast({ title: t("fpj_posted") })
    } catch (err) {
      console.error(err)
      toast({ title: t("fpj_post_failed"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <ProjectCell event={event} projectName={projectName} sub={t("fpj_cert_sub", { no: String(event.params.certificate || ""), date: pmDate(event.at, locale) })} />
      <span className="text-end">
        <span className="block font-bold tabular-nums" dir="ltr">{pmMoney(net)}</span>
        <span className={cn("block text-[11px]", late ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {outstanding <= 0 ? t("fpj_collected_all") : due ? t("fpj_due", { date: pmDate(due, locale), left: pmMoney(outstanding) }) : t("fpj_left", { left: pmMoney(outstanding) })}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {posted ? (
          <StatusPill tone="ok">
            <BadgeCheck size={12} aria-hidden="true" /> {t("fpj_in_books")}
          </StatusPill>
        ) : (
          booksOn &&
          mayAct && (
            <Button size="sm" variant="outline" className="h-8 border border-border bg-card text-xs text-foreground shadow-none hover:bg-muted" onClick={post} disabled={busy}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              {t("fpj_post")}
            </Button>
          )
        )}
        {mayAct && outstanding > 0 && (
          <Button size="sm" className="h-8 bg-module text-xs text-module-foreground hover:bg-module/90" onClick={() => setCollecting(true)}>
            {t("fpj_collect")}
          </Button>
        )}
      </span>
      {collecting && <CollectDialog event={event} projectName={projectName} outstanding={outstanding} booksOn={booksOn} ctx={ctx} onClose={() => setCollecting(false)} />}
    </li>
  )
}

function CollectDialog({ event, projectName, outstanding, booksOn, ctx, onClose }: { event: PmEvent; projectName: string; outstanding: number; booksOn: boolean; ctx: PostingContext; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [amount, setAmount] = useState(String(outstanding))
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const value = Number(amount)
  const invalid = !(value > 0) || value > outstanding + 0.01 || !date || date > todayIso()

  const save = async () => {
    if (!firestore || invalid) return
    setBusy(true)
    setError(null)
    try {
      const res = await recordPmCollection(firestore, ctx, { event, projectName, amount: value, date, postToBooks: booksOn })
      toast({ title: res.collected >= 1 ? t("fpj_collect_done_all") : t("fpj_collect_done") })
      onClose()
    } catch (err) {
      console.error(err)
      setError(err instanceof PmFinanceError ? t(`fpj_err_${err.code}`) : t("fpj_post_failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{t("fpj_collect_title", { no: String(event.params.certificate || ""), project: event.projectNo })}</DialogTitle>
          <DialogDescription>{t("fpj_collect_desc", { left: pmMoney(outstanding) })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fpj-amount">{t("fpj_collect_amount")}</Label>
            <Input id="fpj-amount" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="text-end tabular-nums" dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fpj-date">{t("fpj_collect_date")}</Label>
            <Input id="fpj-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
          </div>
        </div>
        {!booksOn && <p className="text-[11px] text-muted-foreground">{t("fpj_books_off_short")}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("acc_cancel")}
          </Button>
          <Button onClick={save} disabled={busy || invalid} className="gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {t("fpj_collect_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RetentionRow({ event, projectName, released, booksOn, mayAct, ctx }: { event: PmEvent; projectName: string; released: boolean; booksOn: boolean; mayAct: boolean; ctx: PostingContext }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const stage = event.params.stage === "final" ? "final" : "prov"

  const release = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await releasePmRetention(firestore, ctx, { event, projectName, date: todayIso(), postToBooks: booksOn })
      toast({ title: t("fpj_ret_done") })
    } catch (err) {
      console.error(err)
      toast({ title: t("fpj_post_failed"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <ProjectCell event={event} projectName={projectName} sub={t(`fpj_ret_stage_${stage}`, { date: pmDate(String(event.params.on || event.at), locale) })} />
      <span className="font-bold tabular-nums" dir="ltr">{pmMoney(event.amount)}</span>
      {released ? (
        <Badge className="border-none bg-success/10 text-[11px] text-success">{t("fpj_ret_released")}</Badge>
      ) : (
        mayAct && (
          <Button size="sm" className="h-8 bg-module text-xs text-module-foreground hover:bg-module/90" onClick={release} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            {t("fpj_ret_release")}
          </Button>
        )
      )}
    </li>
  )
}

function Section({ icon: Icon, title, sub, count, children }: { icon: typeof Receipt; title: string; sub: string; count: number; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-black text-foreground">
            <Icon size={15} className="text-module" aria-hidden="true" />
            {title}
            {count > 0 && <Badge className="border-none bg-warning/10 text-[10px] tabular-nums text-warning">{count}</Badge>}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="p-6 text-center text-sm text-muted-foreground">{children}</p>
