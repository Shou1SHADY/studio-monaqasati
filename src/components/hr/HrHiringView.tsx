"use client"

// The Hiring tab (PRD HI-01…09, WF-17/18; the prototype's VIEWS.hire —
// optional: hire). Three segments: openings · candidates · onboarding. An
// opening shows its source, needed date and HONEST expected date (from its
// furthest stage), late when it will miss; the detail runs its track — the
// candidates by stage with each one's next step, or the recruitment batch's
// steps with the visa balance. Beside the list: exits without a replacement
// (a suggestion), where candidates come from, and hiring's effect on
// Saudization. Onboarding reads what it can from the record and ticks what
// is done outside. Amounts reach pay roles only (RL-03); management decides a
// new position and an offer above the band.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, BriefcaseBusiness, Check, Circle, ClipboardCheck, Inbox, Plane, Plus, UserPlus, Users, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, Figure, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import type { ModuleKpi } from "@/components/module-ui/ModuleHeader"
import { Panel } from "@/components/module-ui/Panel"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { WizardSteps } from "@/components/module-ui/WizardSteps"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrHiring } from "@/hooks/useHrHiring"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import { useTableLabels } from "@/hooks/useTableLabels"
import { usePermissions } from "@/hooks/usePermissions"
import { Link, useRouter } from "@/i18n/routing"
import type { HrEmployee } from "@/lib/hr/employee"
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import {
  ACTIVE_STAGES,
  activeCandidate,
  bandOf,
  BATCH_STAGES,
  candidatesOf,
  onboardingItems,
  onboardingList,
  openingEta,
  openingLate,
  openingLeft,
  openingNo,
  positionCost,
  prefillFromCandidate,
  replacementSuggestions,
  saudiPct,
  saudiPctProjected,
  scoreAvg,
  waitsOnUs,
  type Candidate,
  type HiredEmployee,
  type Opening,
} from "@/lib/hr/hiring"
import type { HiringWorld } from "@/lib/hr/hiring-today"
import { answerOffer, closeOpening, decideOffer, decidePosition, screenCandidate, tickOnboarding } from "@/lib/hr/hiring-writes"
import { freeVisas } from "@/lib/hr/manpower"
import { addDays } from "@/lib/hr/statutory"
import type { HrSite } from "@/lib/hr/sites"
import { cn } from "@/lib/utils"
import { BatchDialog, CandidateDialog, hireErrKey, OfferDialog, OfferLetterDialog, OpeningDialog, ScoreDialog } from "./HrHiringDialogs"
import type { HrPortal } from "./HrShell"
import { NewEmployeeDialog } from "./NewEmployeeDialog"

type Seg = "open" | "cand" | "join"
const STAGE_TONE: Record<Candidate["stage"], PillTone> = { new: "warn", int: "warn", offer: "info", acc: "ok", hired: "ok", rej: "bad" }

/** The header's three numbers (the prototype's K): open openings, candidates waiting on us, joining in 30 days. */
export function useHiringKpis(access: HrAccess): ModuleKpi[] | undefined {
  const t = useTranslations("Portal.HR")
  const hiring = useHrHiring(access)
  const { employees } = useHrPeople(access)
  const today = todayDay()
  return useMemo(() => {
    if (!hiring) return undefined
    const open = hiring.openings.filter((o) => o.state === "open" || o.state === "wait")
    const late = open.filter((o) => openingLate(o, hiring.candidates, today) > 0).length
    const live = new Set(open.map((o) => o.id))
    const mine = hiring.candidates.filter((c) => live.has(c.openingId) && waitsOnUs(c))
    const in30 = addDays(today, 30)
    const soon =
      hiring.candidates.filter((c) => c.stage === "acc" && (c.offer?.start ?? "") <= in30).length +
      open.filter((o) => o.track === "batch" && o.state === "open" && o.batch?.stage === "visa" && openingEta(o, hiring.candidates, today).date <= in30).reduce((s, o) => s + openingLeft(o), 0)
    const min = access.settings.establishment.minPct
    return [
      { id: "open", label: t("hire.kpi.open"), value: String(open.length), note: late ? t("hire.kpi.open_late", { n: late }) : t("hire.kpi.open_ok", { n: open.reduce((s, o) => s + openingLeft(o), 0) }), tone: late ? "bad" : "good", icon: BriefcaseBusiness },
      {
        id: "mine",
        label: t("hire.kpi.mine"),
        value: String(mine.length),
        note: t("hire.kpi.mine_note", { a: mine.filter((c) => c.stage === "new").length, b: mine.filter((c) => c.stage === "int").length, c: hiring.candidates.filter((c) => c.stage === "offer").length }),
        tone: mine.length ? "warn" : "good",
        icon: UserPlus,
      },
      { id: "soon", label: t("hire.kpi.soon"), value: String(soon), note: t("hire.kpi.soon_note", { pct: saudiPct(employees), min: min ?? "—" }), tone: "neutral", icon: Plane },
    ]
  }, [hiring, employees, today, access.settings.establishment.minPct, t])
}

export function HrHiringView({ access, portal }: { access: HrAccess; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const params = useSearchParams()
  const router = useRouter()
  const { profile } = usePermissions()
  const actorName = (profile?.name as string) || ""
  const today = todayDay()
  const hiring = useHrHiring(access)
  const { employees, sites } = useHrPeople(access)
  const money = access.allowed("pay.view")
  const pays = useOrgPay(access.orgId, money)
  const seg = (params?.get("seg") as Seg | null) ?? "open"
  const jobId = params?.get("job") ?? null
  const convertId = params?.get("convert") ?? null
  const go = (q: string) => router.replace(`/${portal}/hr/hiring${q ? `?${q}` : ""}`)
  const [newOpening, setNewOpening] = useState<{ replaces: HrEmployee | null } | null>(null)

  if (!hiring) return <EmptyState icon={BriefcaseBusiness} title={t("hire.off_title")} description={t("hire.off_desc")} />

  const open = hiring.openings.filter((o) => o.state === "open" || o.state === "wait")
  const activeCands = hiring.candidates.filter(activeCandidate)
  const joiners = onboardingList(employees as HiredEmployee[], today)
  const siteName = (id: string | null) => (id ? (sites.find((s) => s.id === id)?.name ?? "—") : "—")
  const job = jobId ? (hiring.openings.find((o) => o.id === jobId) ?? null) : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedNav
          ariaLabel={t("hire.segs")}
          active={seg}
          onSelect={(id) => go(id === "open" ? "" : `seg=${id}`)}
          segments={[
            { id: "open", label: t("hire.seg.open"), count: open.length },
            { id: "cand", label: t("hire.seg.cand"), count: activeCands.length },
            { id: "join", label: t("hire.seg.join"), count: joiners.length },
          ]}
        />
        {access.allowed("hire.manage") && (
          <Button size="sm" className="gap-1.5" onClick={() => setNewOpening({ replaces: null })}>
            <Plus size={15} aria-hidden="true" />
            {t("hire.new_opening")}
          </Button>
        )}
      </div>

      {seg === "open" &&
        (job ? (
          <OpeningDetail access={access} portal={portal} actorName={actorName} opening={job} hiring={hiring} employees={employees} sites={sites} siteName={siteName} convertId={convertId} onBack={() => go("")} />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
            <OpeningsPanel hiring={hiring} siteName={siteName} onOpen={(id) => go(`job=${id}`)} money={money} />
            <div className="space-y-5">
              {access.allowed("hire.manage") && <ReplacementsPanel employees={employees} openings={hiring.openings} siteName={siteName} onOpen={(e) => setNewOpening({ replaces: e })} />}
              <Panel title={t("hire.sources_title")} icon={Inbox}>
                <p className="text-sm leading-relaxed text-muted-foreground">{t("hire.sources_text")}</p>
              </Panel>
              <Panel title={t("hire.saudi_title")} icon={UsersRound}>
                <KeyValueRow label={t("hire.saudi_now")} value={`${saudiPct(employees)}%`} />
                <KeyValueRow label={t("hire.saudi_proj")} value={`${saudiPctProjected(employees, hiring.candidates, hiring.openings)}%`} />
                <p className="pt-2 text-xs text-muted-foreground">{t("hire.saudi_floor", { min: access.settings.establishment.minPct ?? "—" })}</p>
              </Panel>
            </div>
          </div>
        ))}

      {seg === "cand" && <CandidatesPanel access={access} portal={portal} sites={sites} actorName={actorName} hiring={hiring} employees={employees} siteName={siteName} onOpen={(id) => go(`job=${id}`)} />}

      {seg === "join" && <OnboardingPanel access={access} portal={portal} actorName={actorName} joiners={joiners} employees={employees} sites={sites} pays={pays} siteName={siteName} />}

      {newOpening && (
        <OpeningDialog
          open
          onOpenChange={(o) => !o && setNewOpening(null)}
          access={access}
          actorName={actorName}
          sites={sites}
          replaces={newOpening.replaces}
          onOpened={(id) => go(`job=${id}`)}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {job ? `${t(`trade.${job.trade}` as "trade.mason")} ${openingNo(job.no, locale)}` : ""}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The openings list (jobRow)
// ---------------------------------------------------------------------------

function useOpeningLabels() {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const today = todayDay()
  return {
    name: (o: Opening, siteName: (id: string | null) => string) => `${t(`trade.${o.trade}` as "trade.mason")}${o.q > 1 ? ` ×${o.q}` : ""} — ${siteName(o.siteId)}`,
    source: (o: Opening) => (o.src === "mr" ? t("hire.src.mr", { no: o.refLabel ?? "" }) : o.src === "rep" ? t("hire.src.rep", { name: o.refLabel ?? "" }) : o.state === "wait" ? t("hire.src.new_wait") : o.okBy ? t("hire.src.new_ok") : t("hire.src.new")),
    eta: (o: Opening, candidates: Candidate[]) => {
      if (o.state === "wait") return t("hire.awaiting_mgmt")
      const e = openingEta(o, candidates, today)
      return `${hrDate(e.date, locale)} (${t(`hire.why.${e.why}`)})`
    },
  }
}

function OpeningsPanel({ hiring, siteName, onOpen, money }: { hiring: HiringWorld; siteName: (id: string | null) => string; onOpen: (id: string) => void; money: boolean }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const labels = useTableLabels()
  const L = useOpeningLabels()
  const today = todayDay()
  const open = hiring.openings.filter((o) => o.state === "open" || o.state === "wait")
  const done = hiring.openings.filter((o) => o.state === "filled" || o.state === "closed")
  const columns: DataColumn<Opening>[] = [
    {
      key: "name",
      header: t("hire.col.opening"),
      sortValue: (o) => o.no,
      cell: (o) => (
        <button type="button" onClick={() => onOpen(o.id)} className="rounded text-start font-semibold hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span dir="auto">{L.name(o, siteName)}</span> <bdi dir="ltr" className="ms-1 text-xs text-muted-foreground">{openingNo(o.no, locale)}</bdi>
          <span className="block text-xs font-normal text-muted-foreground">{L.source(o)}</span>
        </button>
      ),
    },
    { key: "need", header: t("hire.col.need"), sortValue: (o) => o.need, cell: (o) => hrDate(o.need, locale) },
    { key: "eta", header: t("hire.col.eta"), cell: (o) => L.eta(o, hiring.candidates), hideBelow: "lg" },
    {
      key: "state",
      header: t("hire.col.state"),
      cell: (o) => {
        const late = openingLate(o, hiring.candidates, today)
        return (
          <span className="flex flex-wrap gap-1">
            {o.state === "wait" ? (
              <StatusPill tone="warn">{t("hire.not_approved")}</StatusPill>
            ) : o.state === "open" ? (
              late ? (
                <StatusPill tone="bad">{t("hire.late", { n: late })}</StatusPill>
              ) : (
                <StatusPill tone="ok">{t("hire.on_time")}</StatusPill>
              )
            ) : (
              <StatusPill tone="mute">{t(`hire.state.${o.state}`)}</StatusPill>
            )}
            {o.track === "batch" ? <StatusPill tone="module">{t(`hire.bst.${o.batch?.stage ?? "auth"}`)}</StatusPill> : <StatusPill tone="mute">{t("hire.n_cands", { n: candidatesOf(o, hiring.candidates).filter(activeCandidate).length })}</StatusPill>}
          </span>
        )
      },
    },
    ...(money ? [{ key: "cost", header: t("hire.col.cost"), numeric: true, hideBelow: "xl" as const, cell: (o: Opening) => hrMoney(positionCost(o.trade, openingLeft(o), hiring.policies)) }] : []),
  ]
  return (
    <Panel title={t("hire.openings")} icon={BriefcaseBusiness} count={open.length} bodyClassName="space-y-3">
      <p className="text-xs text-muted-foreground">{t("hire.openings_sub")}</p>
      <DataTable
        caption={t("hire.openings")}
        labels={labels}
        dense
        columns={columns}
        rows={open}
        rowKey={(o) => o.id}
        initialSort={{ key: "need", dir: "asc" }}
        rowTone={(o) => (openingLate(o, hiring.candidates, today) ? "bad" : o.state === "wait" ? "warn" : undefined)}
        empty={<EmptyState icon={BriefcaseBusiness} title={t("hire.none_title")} description={t("hire.none_desc")} />}
      />
      {done.length > 0 && (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("hire.done_title")} <span className="text-xs text-muted-foreground tabular-nums">({done.length})</span>
          </summary>
          <div className="p-2">
            <DataTable caption={t("hire.done_title")} labels={labels} dense columns={columns} rows={done} rowKey={(o) => o.id} rowTone={() => "mute"} empty={null} />
          </div>
        </details>
      )}
    </Panel>
  )
}

function ReplacementsPanel({ employees, openings, siteName, onOpen }: { employees: HrEmployee[]; openings: Opening[]; siteName: (id: string | null) => string; onOpen: (e: HrEmployee) => void }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const list = replacementSuggestions(employees, openings)
  if (!list.length) return null
  return (
    <Panel title={t("hire.rep_title")} icon={Users} count={list.length}>
      <p className="mb-2 text-xs text-muted-foreground">{t("hire.rep_sub")}</p>
      <ul className="divide-y">
        {list.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 text-sm">
              <b dir="auto">{e.names?.ar}</b> — {t(`trade.${e.trade}` as "trade.mason")}
              <span className="block text-xs text-muted-foreground">
                {siteName(e.siteId)} · {t("hire.last_day", { date: hrDate(e.lastDay ?? null, locale) })}
              </span>
            </span>
            <Button size="sm" variant="outline" onClick={() => onOpen(e)}>
              {t("hire.open_rep")}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Candidates (candRow) — with each one's next step
// ---------------------------------------------------------------------------

type Dialogs =
  | { kind: "score"; c: Candidate }
  | { kind: "offer"; c: Candidate }
  | { kind: "letter"; c: Candidate }
  | { kind: "convert"; c: Candidate }
  | null

function useCandidateActions(access: HrAccess, actorName: string) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const actor = { uid: access.ctx.uid, name: actorName || null }
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (!firestore) return
    setBusy(key)
    try {
      await fn()
      toast({ title: t(ok) })
    } catch (err) {
      console.error(err)
      toast({ title: t(hireErrKey(err)), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }
  return {
    busy,
    interview: (c: Candidate) => run(c.id, () => screenCandidate(firestore!, access.ctx, c.id, actor, "interview"), "hire.done.interview"),
    reject: (c: Candidate) => run(c.id, () => screenCandidate(firestore!, access.ctx, c.id, actor, "reject"), "hire.done.rejected"),
    accepted: (c: Candidate) => run(c.id, () => answerOffer(firestore!, access.ctx, c.id, actor, "acc"), "hire.done.accepted"),
    declined: (c: Candidate) => run(c.id, () => answerOffer(firestore!, access.ctx, c.id, actor, "dec"), "hire.done.declined"),
    approveOffer: (c: Candidate) => run(c.id, () => decideOffer(firestore!, access.ctx, c.id, actor, "approve"), "hire.done.offer_ok"),
    returnOffer: (c: Candidate) => run(c.id, () => decideOffer(firestore!, access.ctx, c.id, actor, "return"), "hire.done.offer_back"),
  }
}

function CandidateTable({
  access,
  portal,
  sites,
  actorName,
  candidates,
  hiring,
  employees,
  withOpening,
  siteName,
  convertId,
}: {
  access: HrAccess
  portal: HrPortal
  sites: HrSite[]
  actorName: string
  candidates: Candidate[]
  hiring: HiringWorld
  employees: HrEmployee[]
  withOpening?: boolean
  siteName: (id: string | null) => string
  convertId?: string | null
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const labels = useTableLabels()
  const today = todayDay()
  const money = access.allowed("pay.view")
  const act = useCandidateActions(access, actorName)
  const initial = convertId ? candidates.find((c) => c.id === convertId && c.stage === "acc") : null
  const [dlg, setDlg] = useState<Dialogs>(initial && access.allowed("hire.convert") ? { kind: "convert", c: initial } : null)
  const opening = (c: Candidate) => hiring.openings.find((o) => o.id === c.openingId)
  const hr = access.allowed("hire.manage")

  const next = (c: Candidate) => {
    const b = act.busy === c.id
    const btn = (label: string, on: () => void, primary = false) => (
      <Button key={label} size="sm" variant={primary ? "default" : "outline"} onClick={on} disabled={b}>
        {t(label)}
      </Button>
    )
    if (c.stage === "new") return hr ? [btn("hire.act.interview", () => act.interview(c)), btn("hire.act.reject", () => act.reject(c))] : []
    if (c.stage === "int")
      return hr ? (c.sc ? [btn("hire.act.offer", () => setDlg({ kind: "offer", c }), true), btn("hire.act.reject", () => act.reject(c))] : [btn("hire.act.score", () => setDlg({ kind: "score", c }), true)]) : []
    if (c.stage === "offer") {
      if (c.offer?.state === "mg")
        return access.allowed("hire.approve") ? [btn("hire.act.approve_offer", () => act.approveOffer(c), true), btn("hire.act.return_offer", () => act.returnOffer(c))] : [<StatusPill key="w" tone="warn">{t("hire.with_mgmt")}</StatusPill>]
      return [btn("hire.act.letter", () => setDlg({ kind: "letter", c })), ...(hr ? [btn("hire.act.accepted", () => act.accepted(c), true), btn("hire.act.declined", () => act.declined(c))] : [])]
    }
    if (c.stage === "acc") return access.allowed("hire.convert") ? [btn("hire.act.convert", () => setDlg({ kind: "convert", c }), true)] : []
    return []
  }

  const facts = (c: Candidate) => {
    const p = hiring.pays.get(c.id)
    const out: string[] = [t(`nat.${c.nat}` as "nat.sa"), t(`hire.csrc.${c.src}`)]
    if (c.sc) out.push(t("hire.fact.score", { avg: scoreAvg(c.sc) }))
    else if (c.stage === "int" && c.intAt) out.push(t("hire.fact.interview", { date: hrDate(c.intAt, locale) }))
    if (money && p?.ask && c.stage !== "new") out.push(t("hire.fact.asks", { amount: hrMoney(p.ask) }))
    if (money && p?.basic && c.offer) out.push(t("hire.fact.offer", { amount: hrMoney(p.basic) }))
    if (c.offer?.state === "sent") out.push(t("hire.fact.valid", { date: hrDate(c.offer.until, locale) }))
    if (c.stage === "acc" && c.offer) out.push(t("hire.fact.starts", { date: hrDate(c.offer.start, locale) }))
    if (c.why) out.push(t(`hire.rej.${c.why}`))
    return out.join(" · ")
  }

  const columns: DataColumn<Candidate>[] = [
    {
      key: "name",
      header: t("hire.col.candidate"),
      sortValue: (c) => c.names.ar,
      cell: (c) => (
        <span className="block min-w-0">
          <b dir="auto">{c.names.ar}</b>
          {withOpening && (
            <span className="block text-xs text-muted-foreground">
              {t(`trade.${c.trade}` as "trade.mason")} — {siteName(c.siteId)}
            </span>
          )}
          <span className="block text-xs text-muted-foreground">{facts(c)}</span>
        </span>
      ),
    },
    { key: "stage", header: t("hire.col.stage"), sortValue: (c) => ACTIVE_STAGES.indexOf(c.stage as (typeof ACTIVE_STAGES)[number]), cell: (c) => <StatusPill tone={STAGE_TONE[c.stage]}>{t(`hire.stg.${c.stage}`)}</StatusPill> },
    { key: "act", header: t("hire.col.next"), cell: (c) => <span className="flex flex-wrap gap-1.5">{next(c)}</span> },
  ]

  const dOpening = dlg ? opening(dlg.c) : null
  return (
    <>
      <DataTable caption={t("hire.col.candidate")} labels={labels} dense columns={columns} rows={candidates} rowKey={(c) => c.id} initialSort={{ key: "stage", dir: "desc" }} rowTone={(c) => (c.stage === "rej" || c.stage === "hired" ? "mute" : undefined)} empty={null} />
      {dlg?.kind === "score" && <ScoreDialog open onOpenChange={(o) => !o && setDlg(null)} access={access} actorName={actorName} candidate={dlg.c} />}
      {dlg?.kind === "offer" && dOpening && <OfferDialog open onOpenChange={(o) => !o && setDlg(null)} access={access} actorName={actorName} candidate={dlg.c} opening={dOpening} ask={hiring.pays.get(dlg.c.id)?.ask ?? null} employees={employees} />}
      {dlg?.kind === "letter" && dOpening && (
        <OfferLetterDialog open onOpenChange={(o) => !o && setDlg(null)} access={access} candidate={dlg.c} opening={dOpening} siteName={siteName(dOpening.siteId)} basic={money ? (hiring.pays.get(dlg.c.id)?.basic ?? null) : null} />
      )}
      {dlg?.kind === "convert" && dOpening && (
        <NewEmployeeDialog
          open
          onOpenChange={(o) => !o && setDlg(null)}
          access={access}
          actorName={actorName}
          sites={sites}
          portal={portal}
          prefill={prefillFromCandidate(dlg.c, dOpening, money ? (hiring.pays.get(dlg.c.id)?.basic ?? null) : null, today)}
          hiring={{ openingId: dOpening.id, candidateId: dlg.c.id }}
        />
      )}
    </>
  )
}

function CandidatesPanel({
  access,
  portal,
  sites,
  actorName,
  hiring,
  employees,
  siteName,
  onOpen,
}: {
  access: HrAccess
  portal: HrPortal
  sites: HrSite[]
  actorName: string
  hiring: HiringWorld
  employees: HrEmployee[]
  siteName: (id: string | null) => string
  onOpen: (id: string) => void
}) {
  const t = useTranslations("Portal.HR")
  const list = hiring.candidates.filter(activeCandidate)
  return (
    <Panel title={t("hire.cands_title")} icon={UserPlus} count={list.length}>
      {list.length ? (
        <CandidateTable access={access} portal={portal} sites={sites} actorName={actorName} candidates={list} hiring={hiring} employees={employees} withOpening siteName={siteName} />
      ) : (
        <EmptyState icon={UserPlus} title={t("hire.no_cands")} />
      )}
      {list.length > 0 && (
        <p className="pt-3 text-xs text-muted-foreground">
          {t("hire.cands_note")}{" "}
          {[...new Set(list.map((c) => c.openingId))].slice(0, 6).map((id) => {
            const o = hiring.openings.find((x) => x.id === id)
            return o ? (
              <Button key={id} variant="link" size="sm" className="h-auto px-1" onClick={() => onOpen(id)}>
                {t(`trade.${o.trade}` as "trade.mason")}
              </Button>
            ) : null
          })}
        </p>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// The opening's page (jobDetail)
// ---------------------------------------------------------------------------

function OpeningDetail({
  access,
  portal,
  actorName,
  opening: o,
  hiring,
  employees,
  sites,
  siteName,
  convertId,
  onBack,
}: {
  access: HrAccess
  portal: HrPortal
  actorName: string
  opening: Opening
  hiring: HiringWorld
  employees: HrEmployee[]
  sites: HrSite[]
  siteName: (id: string | null) => string
  convertId: string | null
  onBack: () => void
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const L = useOpeningLabels()
  const money = access.allowed("pay.view")
  const [dlg, setDlg] = useState<"cand" | "batch" | null>(null)
  const [busy, setBusy] = useState(false)
  const actor = { uid: access.ctx.uid, name: actorName || null }
  const cands = candidatesOf(o, hiring.candidates)
  const active = cands.filter(activeCandidate)
  const closed = cands.filter((c) => !activeCandidate(c))
  const late = openingLate(o, hiring.candidates, today)
  const eta = openingEta(o, hiring.candidates, today)
  const band = bandOf(o.trade, hiring.policies)
  const est = access.settings.establishment
  const stageIx = BATCH_STAGES.indexOf(o.batch?.stage ?? "auth")

  const run = async (fn: () => Promise<unknown>, ok: string, back = false) => {
    if (!firestore) return
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
      if (back) onBack()
    } catch (err) {
      console.error(err)
      toast({ title: t(hireErrKey(err)), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={
        <>
          <span dir="auto">{L.name(o, siteName)}</span> <bdi dir="ltr" className="ms-1 text-xs text-muted-foreground">{openingNo(o.no, locale)}</bdi>
        </>
      }
      icon={BriefcaseBusiness}
      actions={o.state === "filled" || o.state === "closed" ? <StatusPill tone="mute">{t(`hire.state.${o.state}`)}</StatusPill> : undefined}
      bodyClassName="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-3 border-b pb-3">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onBack}>
          <ArrowLeft size={15} className="rtl-flip" aria-hidden="true" />
          {t("hire.all_openings")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {L.source(o)} · {t("hire.opened_by", { name: o.opened.byName ?? "—", date: hrDate(o.opened.at.slice(0, 10), locale) })}
        </span>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t("hire.kv.needed_joined")} value={<Figure>{`${o.q} · ${o.filled ?? 0}`}</Figure>} />
        <Fact label={t("hire.kv.need")} value={hrDate(o.need, locale)} />
        <Fact label={t("hire.kv.eta")} value={o.state === "wait" ? "—" : `${hrDate(eta.date, locale)} · ${t(`hire.why.${eta.why}`)}`} />
        {money && band && <Fact label={t("hire.band")} value={`${hrMoney(band[0])} – ${hrMoney(band[1])}`} />}
      </dl>
      {o.why && <Callout tone="info">{o.why}</Callout>}
      {o.state === "wait" && (
        <Callout tone="warn" title={t("hire.wait_title")}>
          {t("hire.wait_text")}
          {money ? ` ${t("hire.wait_cost", { cost: hrMoney(positionCost(o.trade, o.q, hiring.policies)) })}` : ""}
        </Callout>
      )}
      {late > 0 && (
        <Callout tone="block" title={t("hire.late_title", { n: late })}>
          {t(o.track === "batch" ? "hire.late_batch" : o.src === "mr" ? "hire.late_mr" : "hire.late_ind")}
        </Callout>
      )}
      {o.state === "wait" && access.allowed("hire.approve") && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => run(() => decidePosition(firestore!, access.ctx, o.id, actor, "approve"), "hire.done.position_ok")}>
            <Check size={15} aria-hidden="true" />
            {t("hire.act.approve_position")}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => decidePosition(firestore!, access.ctx, o.id, actor, "decline"), "hire.done.position_no", true)}>
            {t("hire.act.decline_position")}
          </Button>
        </div>
      )}

      {o.track === "batch" && o.batch ? (
        <div className="space-y-3">
          <WizardSteps steps={BATCH_STAGES.map((s) => t(`hire.bst.${s}`))} current={stageIx} ariaLabel={t("hire.batch_steps")} />
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label={t("hire.batch.agency")} value={o.batch.agency || t("hire.not_set")} />
            <Fact label={t("new.nationality")} value={o.batch.nat ? t(`nat.${o.batch.nat}` as "nat.sa") : "—"} />
            <Fact label={t("hire.batch.sel")} value={<Figure>{`${o.batch.sel ?? "—"} / ${o.q}`}</Figure>} />
            {stageIx >= 2 ? (
              <Fact label={t("hire.batch.lot")} value={<Figure>{`${o.batch.visas} / ${o.batch.issued}`}</Figure>} />
            ) : (
              <Fact
                label={t("hire.batch.free_visas") + (est.visasAsOf ? ` · ${t("hire.updated", { date: hrDate(est.visasAsOf, locale) })}` : "")}
                value={<span className={cn(freeVisas(est) < openingLeft(o) && "text-destructive")}>{freeVisas(est)}</span>}
              />
            )}
          </dl>
          <Callout tone="info">{t("hire.batch.coverage_note")}</Callout>
          {o.state === "open" && access.allowed("hire.batch") && openingLeft(o) > 0 && (
            <Button size="sm" className="gap-1.5" onClick={() => setDlg("batch")}>
              <ClipboardCheck size={15} aria-hidden="true" />
              {stageIx < 2 ? t("hire.batch.record_next", { stage: t(`hire.bst.${BATCH_STAGES[stageIx + 1]}`) }) : t("hire.batch.register")}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {active.length ? (
            <CandidateTable access={access} portal={portal} sites={sites} actorName={actorName} candidates={active} hiring={hiring} employees={employees} siteName={siteName} convertId={convertId} />
          ) : (
            <EmptyState icon={UserPlus} title={t("hire.no_cands")} description={o.state === "open" ? t("hire.no_cands_desc") : undefined} />
          )}
          {closed.length > 0 && (
            <details className="rounded-lg border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("hire.closed_cands")} <span className="text-xs text-muted-foreground tabular-nums">({closed.length})</span>
              </summary>
              <div className="p-2">
                <CandidateTable access={access} portal={portal} sites={sites} actorName={actorName} candidates={closed} hiring={hiring} employees={employees} siteName={siteName} />
              </div>
            </details>
          )}
          {o.state === "open" && access.allowed("hire.manage") && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button size="sm" className="gap-1.5" onClick={() => setDlg("cand")}>
                <Plus size={15} aria-hidden="true" />
                {t("hire.act.add_cand")}
              </Button>
              <span className="flex-1" />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => closeOpening(firestore!, access.ctx, o.id, actor), "hire.done.closed", true)}>
                {t("hire.act.close")}
              </Button>
            </div>
          )}
        </div>
      )}
      {dlg === "cand" && <CandidateDialog open onOpenChange={(x) => !x && setDlg(null)} access={access} actorName={actorName} opening={o} employees={employees} />}
      {dlg === "batch" && <BatchDialog open onOpenChange={(x) => !x && setDlg(null)} access={access} actorName={actorName} opening={o} siteName={siteName(o.siteId)} />}
    </Panel>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-bold">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Onboarding (onbList / onbItems)
// ---------------------------------------------------------------------------

function OnboardingPanel({
  access,
  portal,
  actorName,
  joiners,
  employees,
  sites,
  pays,
  siteName,
}: {
  access: HrAccess
  portal: HrPortal
  actorName: string
  joiners: HiredEmployee[]
  employees: HrEmployee[]
  sites: HrSite[]
  pays: Map<string, { iban?: string | null }>
  siteName: (id: string | null) => string
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const labels = useTableLabels()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const money = access.allowed("pay.view")
  const ticks = access.allowed("hire.onboard")
  const supervisorOf = (id: string) => sites.find((s) => s.id === id)?.supervisorEmployeeId ?? null
  const nameOf = (id: string | null | undefined) => (id ? (employees.find((e) => e.id === id)?.names?.ar ?? "—") : t("hire.onb.management"))
  const items = (e: HiredEmployee) => onboardingItems(e, { employees, supervisorOf, hasIban: money ? Boolean(pays.get(e.id)?.iban) : null })

  const tick = async (e: HiredEmployee, key: "qiwa" | "gosi") => {
    if (!firestore) return
    setBusy(`${e.id}:${key}`)
    try {
      await tickOnboarding(firestore, access.ctx, e.id, { uid: access.ctx.uid, name: actorName || null }, key)
      toast({ title: t("hire.onb.ticked") })
    } catch (err) {
      console.error(err)
      toast({ title: t(hireErrKey(err)), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const columns: DataColumn<HiredEmployee>[] = [
    {
      key: "emp",
      header: t("hire.col.joiner"),
      sortValue: (e) => e.join,
      cell: (e) => (
        <Link href={`/${portal}/hr/people/${e.id}`} className="rounded font-semibold hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <bdi dir="ltr" className="me-1.5 text-xs text-muted-foreground">
            {empNo(e.no)}
          </bdi>
          <span dir="auto">{e.names?.ar}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {t(`trade.${e.trade}` as "trade.mason")} · {siteName(e.siteId)} · {t("hire.onb.started", { date: hrDate(e.join, locale) })}
          </span>
        </Link>
      ),
    },
    {
      key: "items",
      header: t("hire.col.items"),
      cell: (e) => (
        <span className="flex flex-wrap gap-1.5">
          {items(e).map((x) =>
            x.manual && !x.ok && ticks ? (
              <Button key={x.key} size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={busy === `${e.id}:${x.key}`} onClick={() => tick(e, x.key as "qiwa" | "gosi")} title={t("hire.onb.tick_hint")}>
                <Circle size={12} aria-hidden="true" />
                {t(`hire.onb.${x.key}`)}
              </Button>
            ) : (
              <StatusPill key={x.key} tone={x.unknown ? "mute" : x.ok ? "ok" : "warn"}>
                {x.ok ? "✓" : "○"} {t(`hire.onb.${x.key}`)}
                {x.key === "manager" ? ` · ${nameOf(x.managerId)}` : ""}
                {x.due && !x.ok ? ` · ${t("hire.onb.due", { date: hrDate(x.due, locale) })}` : ""}
                {x.unknown ? ` · ${t("hire.onb.hidden")}` : ""}
              </StatusPill>
            ),
          )}
        </span>
      ),
    },
    {
      key: "n",
      header: t("hire.col.done"),
      numeric: true,
      cell: (e) => {
        const it = items(e).filter((x) => !x.unknown)
        return `${it.filter((x) => x.ok).length}/${it.length}`
      },
    },
  ]
  return (
    <Panel title={t("hire.onb.title")} icon={ClipboardCheck} count={joiners.length} bodyClassName="space-y-3">
      <p className="text-xs text-muted-foreground">{t("hire.onb.sub")}</p>
      <DataTable caption={t("hire.onb.title")} labels={labels} dense columns={columns} rows={joiners} rowKey={(e) => e.id} empty={<EmptyState icon={ClipboardCheck} title={t("hire.onb.none")} />} />
    </Panel>
  )
}
