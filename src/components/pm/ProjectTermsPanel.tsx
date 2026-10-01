"use client"

// Contract › Terms & amendments (PRD TRM-01/02, AMD-01…10). Before start the
// original contract is completed here — what the handover carried and what it
// lacked. "Start work" freezes it as signed; after that the terms are never
// edited here again: the contract in force is the original + signed addenda,
// and any change is an addendum on top (ContractInForce). Shown only to holders
// of money or approve — never to the site engineer (AMD-10). An advance changed
// before start after Finance received it is warned about in the form, logged,
// and shown on the contract until Finance applies it.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { FileSignature, Loader2, Play, ScrollText, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import type { AddendumActor } from "@/lib/pm/addendum-writes"
import { PM_EVENTS } from "@/lib/pm/events"
import { displayDocNumber } from "@/lib/sales-numbering"
import { pmDate } from "@/lib/pm/format"
import { lifecycleOf, plannedEnd, startBlocks, type PmLifecycle } from "@/lib/pm/lifecycle"
import { PmProjectError, savePlanTerms, startProject, type AdvanceChange } from "@/lib/pm/project-writes"
import { defaultTerms, termProblems, termsEditable, type ContractTerms } from "@/lib/pm/terms"
import { AdvanceLogNote, ContractInForce } from "./ContractInForce"
import { TermsCashPanel } from "./TermsCashPanel"
import { TermsFields } from "./TermsFields"

const LIFECYCLE_TONE: Record<PmLifecycle, PillTone> = {
  plan: "info",
  live: "ok",
  hold: "warn",
  done: "module",
  closed: "mute",
}

export interface PmProjectBlock {
  no?: string
  lifecycle?: string
  terms?: ContractTerms
  original?: ContractTerms | null
  /** The contract in force after the last signed addendum (terms.ts `termsNow`). */
  inForce?: ContractTerms | null
  startOn?: string | null
  durationDays?: number
  startedAt?: string | null
  addendaCount?: number
  signedCount?: number
  retentionHeld?: number
  advanceRecovered?: number
  ipcCount?: number
  advLog?: AdvanceChange[]
  termsByName?: string | null
  termsOn?: string | null
}


export function ProjectTermsPanel({
  projectId,
  project,
  boqItems,
  access,
  actor,
  orgId = "",
}: {
  orgId?: string
  projectId: string
  project: {
    pm?: PmProjectBlock | null
    status?: string | null
    projectManagerId?: string | null
    budget?: number | null
  }
  boqItems: number
  access: PmAccess
  actor: AddendumActor
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const pm = project.pm ?? {}
  const lifecycle = lifecycleOf(project)
  const stored = pm.terms ?? defaultTerms()
  const [draft, setDraft] = useState<ContractTerms>(stored)
  const [busy, setBusy] = useState<"save" | "start" | null>(null)

  useEffect(() => setDraft(pm.terms ?? defaultTerms()), [pm.terms])

  // Finance holds the advance once prj:ADV was sent at handover — found by its
  // key inside this organisation (the outbox id carries the organisation, and
  // older events sit under the key alone).
  const advQuery = useMemoFirebase(
    () => (firestore && pm.no && orgId ? query(collection(firestore, PM_EVENTS), where("organizationId", "==", orgId), where("key", "==", `prj:ADV:${pm.no}`)) : null),
    [firestore, pm.no, orgId]
  )
  const { data: advEvents } = useCollection(advQuery)
  const financeAdvance = advEvents && advEvents.length > 0 ? stored.advance : null

  // Completing the original: money + (all | approve); Start: approve (PRD §4).
  const editable = access.allowed("terms.complete") && termsEditable(lifecycle)
  const canStart = access.allowed("project.start")
  const problems = termProblems(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored)
  const starts = startBlocks({
    lifecycle,
    hasManager: Boolean(project.projectManagerId),
    boqItems,
    termProblems: termProblems(stored).length,
  })
  const end = useMemo(() => (pm.startOn && pm.durationDays ? plannedEnd(pm.startOn, pm.durationDays) : null), [pm.startOn, pm.durationDays])

  const save = async () => {
    if (!firestore || problems.length) return
    setBusy("save")
    try {
      const r = await savePlanTerms(firestore, access.ctx, projectId, draft, actor)
      toast({ title: t(r.advanceChanged ? "terms.saved_adv" : "terms.saved") })
    } catch (err) {
      console.error(err)
      toast({
        title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmProjectError && err.code === "started" ? "terms.already_started" : "error.save"),
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  const start = async () => {
    if (!firestore || starts.length || dirty) return
    setBusy("start")
    try {
      await startProject(firestore, access.ctx, projectId, boqItems, actor)
      toast({ title: t("terms.started") })
    } catch (err) {
      console.error(err)
      toast({
        title: t(err instanceof PmAccessError ? `refused.${err.code}` : "error.save"),
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
    <Panel
      title={t(lifecycle === "plan" ? "terms.title_plan" : "terms.title_force")}
      icon={ScrollText}
      actions={
        <>
          {pm.no && (
            <span className="text-xs font-bold text-muted-foreground" dir="ltr">
              {displayDocNumber(pm.no, locale)}
            </span>
          )}
          <StatusPill tone={LIFECYCLE_TONE[lifecycle]}>{t(`lifecycle.${lifecycle}`)}</StatusPill>
        </>
      }
    >
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">{t(lifecycle === "plan" ? "terms.sub_plan" : "terms.sub_force")}</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <KeyValueRow label={t("field.start_on")} value={pmDate(pm.startOn, locale)} />
        <KeyValueRow label={t("field.duration")} value={pm.durationDays ? t("days", { count: pm.durationDays }) : "—"} />
        <KeyValueRow label={t("terms.planned_end")} value={pmDate(end, locale)} />
      </div>

      {lifecycle !== "plan" ? (
        <ContractInForce
          projectId={projectId}
          original={pm.original ?? stored}
          startedAt={pm.startedAt ?? null}
          lifecycle={lifecycle}
          contractValue={project.budget ?? 0}
          retentionHeld={pm.retentionHeld ?? 0}
          access={access}
          actor={actor}
          orgId={orgId}
          durationDays={pm.durationDays ?? 0}
          advanceRecovered={pm.advanceRecovered ?? 0}
          advLog={pm.advLog ?? null}
        />
      ) : (
        <>
          <Callout tone="info" className="mb-4">
            {t("terms.plan_note")}
          </Callout>
          {editable && (
            <div role="note" className="mb-4 flex gap-2.5 rounded-xl border bg-muted/40 px-3.5 py-3 text-sm leading-relaxed">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-module" aria-hidden="true" />
              <span>{t("terms.no_copy")}</span>
            </div>
          )}
          <TermsFields
            value={draft}
            onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
            disabled={!editable || busy !== null}
            contractValue={access.has("money") ? (project.budget ?? 0) : undefined}
            payerChangedFrom={stored.payer}
            financeAdvance={financeAdvance}
          />
          <AdvanceLogNote log={pm.advLog} />
          {editable && (
            <div className="mt-4 space-y-3">
              <BlockingReasons title={t("cannot_save")} reasons={problems.map((p) => t(`terms.problem.${p}`))} />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void save()} disabled={!dirty || problems.length > 0 || busy !== null}>
                  {busy === "save" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                  {t("terms.save")}
                </Button>
                {canStart && (
                  <Button onClick={() => void start()} disabled={starts.length > 0 || dirty || busy !== null}>
                    {busy === "start" ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <Play size={16} className="me-1.5" aria-hidden="true" />}
                    {t("terms.start")}
                  </Button>
                )}
              </div>
              {canStart && <BlockingReasons title={t("cannot_start")} reasons={[...(dirty ? [t("start_block.unsaved")] : []), ...starts.map((b) => t(`start_block.${b}`))]} />}
            </div>
          )}
          {access.has("money") && (
            <div className="mt-4">
              <TermsCashPanel terms={draft} contractValue={project.budget ?? 0} />
            </div>
          )}
        </>
      )}
      {pm.termsByName && pm.termsOn && <p className="mt-3 text-xs text-muted-foreground">{t("terms.last_completed", { who: pm.termsByName, date: pmDate(pm.termsOn, locale) })}</p>}
    </Panel>
    {lifecycle === "plan" && (
      <Panel title={t("amend.view_record")} icon={FileSignature}>
        <EmptyState icon={FileSignature} title={t("amend.record_starts_title")} description={t("amend.record_starts")} />
      </Panel>
    )}
    </div>
  )
}
