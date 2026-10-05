"use client"

// Manpower requests from Projects (PRD AS-02, WF-12, form 5), on HR's
// workplaces: each request with the coverage it could get now (on time · late ·
// uncovered), the HR manager's answer in two steps — the coverage person by
// person with anyone excluded named, and how to cover what is left (hire, a
// transfer of services, temporary labour if the company allows it, or say it
// stays uncovered) — then the answer. Sending it acts: the unassigned are
// assigned now, people on an ending site are scheduled to move on their day,
// visas are reserved, and Projects is told; it accepts the plan on its side.

import { useCallback, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Loader2, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { ShowMoreRow } from "@/components/module-ui/ShowMoreRow"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { WizardSteps } from "@/components/module-ui/WizardSteps"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useHrPeople } from "@/hooks/useHrPeople"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import {
  ajeerMonthlyCost,
  answerBlocks,
  answerManpowerRequest,
  COVERAGE,
  coverage,
  freeVisas,
  MANPOWER_REQUESTS,
  manpowerNo,
  REST_CHOICES,
  restLine,
  type CoverageLine,
  type ManpowerRequest,
  type RestChoice,
} from "@/lib/hr/manpower"
import { siteEndOf, type HrSite } from "@/lib/hr/sites"
import { addDays } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"

/** One coverage line in words — shared with the project's panel. */
export function CoverageLines({ lines, excluded, short }: { lines: CoverageLine[]; excluded: Array<{ name: string; reason: string }>; short?: number }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-2">
            <span className="font-bold tabular-nums">{l.count}</span>
            <span>{t(`mp.src.${l.source}`)}</span>
            <span className="text-xs text-muted-foreground">{t("mp.from_date", { date: hrDate(l.date, locale) })}</span>
            {l.names?.length ? (
              <span className="text-xs text-muted-foreground" dir="auto">
                · {l.names.join("، ")}
              </span>
            ) : null}
          </li>
        ))}
        {short ? (
          <li className="flex flex-wrap items-baseline gap-2 text-destructive">
            <span className="font-bold tabular-nums">{short}</span>
            <span>{t("mp.uncovered_said")}</span>
          </li>
        ) : null}
      </ul>
      {excluded.length > 0 && (
        <p className="text-xs text-destructive">{t("mp.excluded", { list: excluded.map((x) => `${x.name} (${t(`mp.why.${x.reason}`)})`).join("، ") })}</p>
      )}
    </div>
  )
}

/** Where a request stands, as both sides read it. */
export function manpowerState(r: ManpowerRequest): { key: string; tone: PillTone; n?: number } {
  if (r.state === "open") return { key: "open", tone: "warn" }
  if (r.state === "withdrawn") return { key: "withdrawn", tone: "mute" }
  if (r.answer?.short) return { key: "short", tone: "bad", n: r.answer.short }
  return r.accepted ? { key: "accepted", tone: "ok" } : { key: "answered", tone: "info" }
}

const PAGE = 10

export function HrManpowerPanel({ access, siteId }: { access: HrAccess; siteId?: string }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile } = usePermissions()
  const { toast } = useToast()
  const today = todayDay()
  const { employees, sites: rawSites } = useHrPeople(access)
  const q = useMemoFirebase(() => (firestore && access.orgId ? query(collection(firestore, MANPOWER_REQUESTS), where("organizationId", "==", access.orgId)) : null), [firestore, access.orgId])
  const { data } = useCollection(q)
  const projQ = useMemoFirebase(() => (firestore && access.orgId ? query(collection(firestore, "projects"), where("organizationId", "==", access.orgId)) : null), [firestore, access.orgId])
  const { data: projData } = useCollection(projQ)
  // A project site ends when Projects says it does (§data "Workplace: project/end").
  const sites = useMemo<HrSite[]>(() => {
    const projects = new Map(((projData ?? []) as Array<{ id: string; pm?: { startOn?: string | null; durationDays?: number | null } | null; endDate?: string | null }>).map((p) => [p.id, p]))
    return rawSites.map((s) => ({ ...s, endDate: siteEndOf(s, s.projectId ? projects.get(s.projectId) : null) }))
  }, [rawSites, projData])
  const est = access.settings.establishment
  const visas = freeVisas(est)
  const policies = access.settings.policies
  const money = access.allowed("pay.view")
  const requests = useMemo(
    () =>
      ((data ?? []) as unknown as ManpowerRequest[])
        .filter((r) => r.state !== "withdrawn" && (!siteId || r.siteId === siteId || r.answer?.siteId === siteId))
        .sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || a.from.localeCompare(b.from)),
    [data, siteId]
  )
  const open = requests.filter((r) => r.state === "open")
  const [all, setAll] = useState(false)
  const [answering, setAnswering] = useState<ManpowerRequest | null>(null)
  const [step, setStep] = useState(0)
  const [rest, setRest] = useState<RestChoice | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const cover = useCallback((r: ManpowerRequest) => coverage({ trade: r.trade, count: r.count, from: r.from, today, siteId: r.siteId, employees, sites, visas }), [today, employees, sites, visas])
  const plan = useMemo(() => (answering ? cover(answering) : null), [answering, cover])
  const siteName = (id: string | null) => (id ? (rawSites.find((s) => s.id === id)?.name ?? "—") : t("sites.unassigned"))

  if (!requests.length) return null

  const start = (r: ManpowerRequest) => {
    setNote("")
    setStep(0)
    const c = cover(r)
    setRest(c.short ? (policies.ajeer ? "ajeer" : "hire") : null)
    setAnswering(r)
  }
  // The workplace the people go to: the request's, or the one HR keeps for the project (the write finds it the same way).
  const target = answering ? (answering.siteId ?? rawSites.find((s) => s.projectId === answering.projectId && s.active !== false)?.id ?? null) : null
  const blocks = plan && answering ? answerBlocks({ short: plan.short, rest, policies, peopleRows: plan.rows.filter((x) => x.employeeId).length, siteId: target }) : []

  const submit = async () => {
    if (!firestore || !answering || !plan) return
    setBusy(true)
    try {
      await answerManpowerRequest(
        firestore,
        access.ctx,
        answering.id,
        { uid: user?.uid ?? "", name: (profile?.name as string) || null },
        { rows: plan.rows, excluded: plan.excluded, rest: plan.short ? rest : null, note },
        { policies }
      )
      toast({ title: t("mp.answered_ok") })
      setAnswering(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `mp.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const restOption = (k: RestChoice) => {
    const disabled = k === "ajeer" && !policies.ajeer
    const sub =
      k === "hire"
        ? t("mp.rest_sub.hire", { date: hrDate(addDays(today, COVERAGE.hireLeadDays), locale) })
        : k === "xfer"
          ? t("mp.rest_sub.xfer", { date: hrDate(addDays(today, COVERAGE.xferLeadDays), locale) })
          : k === "ajeer"
            ? policies.ajeer
              ? t("mp.rest_sub.ajeer", { factor: policies.ajeerFactor }) + (money && answering ? ` · ${t("mp.ajeer_cost", { cost: hrMoney(ajeerMonthlyCost(answering.trade, policies)) })}` : "")
              : t("mp.rest_sub.ajeer_off")
            : t("mp.rest_sub.none")
    return (
      <label key={k} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm", rest === k && "border-module bg-module/10", disabled && "cursor-not-allowed opacity-50")}>
        <input type="radio" name="mp-rest" value={k} checked={rest === k} disabled={disabled || busy} onChange={() => setRest(k)} className="mt-1 accent-current focus-visible:ring-2 focus-visible:ring-ring" />
        <span>
          <span className="block font-bold">{t(`mp.rest.${k}`)}</span>
          <span className="block text-xs text-muted-foreground">{sub}</span>
        </span>
      </label>
    )
  }

  const answerLine = plan
    ? [
        t("mp.sum_on_time", { n: plan.onTime }),
        plan.late ? t("mp.sum_late", { n: plan.late }) : null,
        plan.short ? (rest === "none" || !rest ? t("mp.sum_short", { n: plan.short }) : `${plan.short} ${t(`mp.src.${rest}`)} — ${hrDate(restLine(rest, plan.short, answering!.from, today)!.date, locale)}`) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : ""

  return (
    <Panel title={t("mp.title")} icon={UsersRound} count={open.length || undefined}>
      <p className="mb-3 text-xs text-muted-foreground">{t("mp.panel_note")}</p>
      <ul className="divide-y rounded-xl border">
        {(all ? requests : requests.slice(0, PAGE)).map((r) => {
          const st = manpowerState(r)
          const c = r.state === "open" ? cover(r) : null
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", st.tone === "bad" || (c && c.short) ? "bg-destructive" : st.tone === "warn" ? "bg-warning" : "bg-cta")} aria-hidden="true" />
              <div className="min-w-0 flex-1 basis-60 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  {r.no && <span dir="ltr" className="text-xs text-muted-foreground">{manpowerNo(r.no, locale)}</span>}
                  <SourceBadge module="project-management" label={r.projectName} />
                  {t("mp.line", { count: r.count, trade: t(`trade.${r.trade}` as "trade.mason"), date: hrDate(r.from, locale) })}
                  <StatusPill tone={st.tone}>{t(`mp.state.${st.key}`, { n: st.n ?? 0 })}</StatusPill>
                </p>
                {c && <p className="text-xs text-muted-foreground">{t("mp.possible", { on: c.onTime, late: c.late, short: c.short })}</p>}
                {r.note && (
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {r.note}
                  </p>
                )}
                {r.answer && <CoverageLines lines={r.answer.plan} excluded={r.answer.excluded} short={r.answer.short} />}
              </div>
              {r.state === "open" && access.allowed("manpower.answer") && (
                <Button size="sm" onClick={() => start(r)}>
                  {t("mp.answer")}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {requests.length > PAGE && !all && <ShowMoreRow onClick={() => setAll(true)}>{t("site.show_more", { n: requests.length - PAGE })}</ShowMoreRow>}

      <Dialog open={answering !== null} onOpenChange={(o) => !o && setAnswering(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("mp.answer_title", { no: answering?.no ? manpowerNo(answering.no, locale) : answering?.projectName ?? "" })}</DialogTitle>
            <DialogDescription>
              {answering ? `${answering.projectName} · ${t("mp.line", { count: answering.count, trade: t(`trade.${answering.trade}` as "trade.mason"), date: hrDate(answering.from, locale) })}` : ""}
            </DialogDescription>
          </DialogHeader>
          <WizardSteps steps={[t("mp.step.cover"), t("mp.step.answer")]} current={step} ariaLabel={t("mp.steps")} />
          {plan && step === 0 && (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { k: "on_time", v: plan.onTime, c: "text-success" },
                  { k: "late", v: plan.late, c: "text-warning" },
                  { k: "short", v: plan.short, c: plan.short ? "text-destructive" : "" },
                  { k: "excluded", v: plan.excluded.length, c: "" },
                ].map((x) => (
                  <div key={x.k} className="rounded-lg border px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{t(`mp.kpi.${x.k}`)}</dt>
                    <dd className={cn("text-lg font-black tabular-nums", x.c)}>{x.v}</dd>
                  </div>
                ))}
              </dl>
              <ul className="divide-y rounded-xl border text-sm">
                {plan.rows.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 basis-40">
                      <span className="block font-semibold" dir="auto">
                        {r.name || t("mp.visa_row", { trade: t(`trade.${answering!.trade}` as "trade.mason") })}
                      </span>
                      <span className="block text-xs text-muted-foreground">{r.employeeId ? t("mp.now_at", { site: siteName(r.fromSiteId) }) : t("mp.visa_issued")}</span>
                    </span>
                    <StatusPill tone={r.late ? "warn" : "ok"}>
                      {t(`mp.src.${r.source}`)} · {hrDate(r.date, locale)}
                    </StatusPill>
                  </li>
                ))}
                {plan.excluded.map((x, i) => (
                  <li key={`x${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 basis-40 font-semibold" dir="auto">
                      {x.name}
                    </span>
                    <StatusPill tone="bad">{t("mp.excluded_one", { why: t(`mp.why.${x.reason}`) })}</StatusPill>
                  </li>
                ))}
                {!plan.rows.length && !plan.excluded.length && <li className="px-3 py-3 text-muted-foreground">{t("mp.nobody")}</li>}
              </ul>
              {plan.short > 0 && (
                <>
                  <Callout tone="warn" title={t("mp.short_title", { n: plan.short })}>
                    {t("mp.short_desc", { date: hrDate(addDays(today, COVERAGE.hireLeadDays), locale), visas })}
                  </Callout>
                  <fieldset className="grid gap-2 sm:grid-cols-2">
                    <legend className="sr-only">{t("mp.rest_legend")}</legend>
                    {REST_CHOICES.map(restOption)}
                  </fieldset>
                </>
              )}
            </div>
          )}
          {plan && step === 1 && (
            <div className="space-y-3">
              <Callout tone="info" title={t("mp.sum_title")}>
                {answerLine}
              </Callout>
              <div className="space-y-1.5">
                <Label htmlFor="mp-note">{t("mp.note_pm")}</Label>
                <Textarea id="mp-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
              </div>
              <p className="text-xs text-muted-foreground">{t("mp.on_send")}</p>
              <p className="text-xs text-muted-foreground">{t("att.fill_by", { name: (profile?.name as string) || "—" })}</p>
            </div>
          )}
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`mp.block.${b}`))} />
          <DialogFooter>
            {step === 0 ? (
              <>
                <Button variant="outline" onClick={() => setAnswering(null)} disabled={busy}>
                  {t("cancel")}
                </Button>
                <Button onClick={() => setStep(1)} disabled={busy || !plan || blocks.length > 0}>
                  {t("next")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setStep(0)} disabled={busy}>
                  {t("back")}
                </Button>
                <Button onClick={() => void submit()} disabled={busy || !plan || blocks.length > 0}>
                  {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                  {t("mp.send")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
