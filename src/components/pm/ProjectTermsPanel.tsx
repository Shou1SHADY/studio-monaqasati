"use client"

// Contract › Terms (PRD TRM-01/02, AMD-10). Before start the original contract
// is completed here — what the handover carried and what it lacked. "Start
// work" freezes it as signed; after that the terms are read-only here and any
// change is an addendum on top of the original (a later release).

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Lock, Play, ScrollText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { displayDocNumber } from "@/lib/sales-numbering"
import { pmDate, pmPct } from "@/lib/pm/format"
import { lifecycleOf, plannedEnd, startBlocks, type PmLifecycle } from "@/lib/pm/lifecycle"
import { PmProjectError, savePlanTerms, startProject } from "@/lib/pm/project-writes"
import {
  ADVANCE_RECOVERY,
  defaultTerms,
  PAYERS,
  PRICING_BASES,
  RETENTION_RELEASE,
  termProblems,
  termsEditable,
  type ContractTerms,
} from "@/lib/pm/terms"

const LIFECYCLE_TONE: Record<PmLifecycle, PillTone> = { plan: "info", live: "ok", hold: "warn", done: "module", closed: "mute" }

export interface PmProjectBlock {
  no?: string
  lifecycle?: string
  terms?: ContractTerms
  original?: ContractTerms | null
  startOn?: string | null
  durationDays?: number
  startedAt?: string | null
}

const toPct = (f: number) => String(Math.round(f * 10000) / 100)
const fromPct = (s: string) => (s.trim() === "" ? NaN : Number(s) / 100)

export function ProjectTermsPanel({
  projectId,
  project,
  boqItems,
  canEdit,
}: {
  projectId: string
  project: { pm?: PmProjectBlock | null; status?: string | null; projectManagerId?: string | null }
  boqItems: number
  canEdit: boolean
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

  const editable = canEdit && termsEditable(lifecycle)
  const problems = termProblems(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored)
  const starts = startBlocks({ lifecycle, hasManager: Boolean(project.projectManagerId), boqItems, termProblems: termProblems(stored).length })
  const end = useMemo(() => (pm.startOn && pm.durationDays ? plannedEnd(pm.startOn, pm.durationDays) : null), [pm.startOn, pm.durationDays])

  const set = <K extends keyof ContractTerms>(k: K, v: ContractTerms[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const save = async () => {
    if (!firestore || problems.length) return
    setBusy("save")
    try {
      await savePlanTerms(firestore, projectId, draft)
      toast({ title: t("terms.saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmProjectError && err.code === "started" ? "terms.already_started" : "error.save"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const start = async () => {
    if (!firestore || starts.length || dirty) return
    setBusy("start")
    try {
      await startProject(firestore, projectId, boqItems)
      toast({ title: t("terms.started") })
    } catch (err) {
      console.error(err)
      toast({ title: t("error.save"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const pctField = (id: string, key: "advance" | "retention" | "retentionCap") => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(`terms.${key}`)}</Label>
      <Input id={id} type="number" min="0" max="100" step="any" inputMode="decimal" dir="ltr" value={Number.isNaN(draft[key]) ? "" : toPct(draft[key])} onChange={(e) => set(key, fromPct(e.target.value))} disabled={!editable || busy !== null} />
    </div>
  )
  const dayField = (id: string, key: "paymentDays" | "consultantDays" | "claimNoticeDays" | "defectsDays") => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(`terms.${key}`)}</Label>
      <Input id={id} type="number" min="0" step="1" inputMode="numeric" dir="ltr" value={Number.isNaN(draft[key]) ? "" : String(draft[key])} onChange={(e) => set(key, e.target.value === "" ? NaN : Number(e.target.value))} disabled={!editable || busy !== null} />
    </div>
  )
  const choice = <K extends "payer" | "basis" | "advanceRecovery" | "retentionRelease">(id: string, key: K, options: readonly ContractTerms[K][]) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(`terms.${key as string}` as "terms.save")}</Label>
      <Select value={draft[key] as string} onValueChange={(v) => set(key, v as ContractTerms[K])} disabled={!editable || busy !== null}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o as string} value={o as string}>
              {t(`terms.opt.${key as string}.${o as string}` as "terms.save")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <Panel
      title={t("terms.title")}
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
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <KeyValueRow label={t("field.start_on")} value={pmDate(pm.startOn, locale)} />
        <KeyValueRow label={t("field.duration")} value={pm.durationDays ? t("days", { count: pm.durationDays }) : "—"} />
        <KeyValueRow label={t("terms.planned_end")} value={pmDate(end, locale)} />
      </div>

      {lifecycle === "plan" ? (
        <Callout tone="info" className="mb-4">
          {t("terms.plan_note")}
        </Callout>
      ) : (
        <Callout tone="warn" className="mb-4" title={t("terms.frozen_title")}>
          {t("terms.frozen_note", { date: pmDate(pm.startedAt?.slice(0, 10), locale) })}
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {choice("t-payer", "payer", PAYERS)}
        {choice("t-basis", "basis", PRICING_BASES)}
        {pctField("t-adv", "advance")}
        {choice("t-advr", "advanceRecovery", ADVANCE_RECOVERY)}
        {pctField("t-ret", "retention")}
        {pctField("t-cap", "retentionCap")}
        {choice("t-rel", "retentionRelease", RETENTION_RELEASE)}
        {dayField("t-pay", "paymentDays")}
        {dayField("t-cons", "consultantDays")}
        {dayField("t-claim", "claimNoticeDays")}
        {dayField("t-dlp", "defectsDays")}
        <div className="space-y-2 rounded-xl border p-3 sm:col-span-2">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="t-dmg">{t("terms.damages")}</Label>
            <Switch id="t-dmg" checked={draft.damages.on} onCheckedChange={(v) => set("damages", { ...draft.damages, on: v })} disabled={!editable || busy !== null} />
          </div>
          {draft.damages.on && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="t-dmg-rate">{t("terms.damages_rate")}</Label>
                <Input id="t-dmg-rate" type="number" min="0" step="any" dir="ltr" value={toPct(draft.damages.weeklyRate)} onChange={(e) => set("damages", { ...draft.damages, weeklyRate: fromPct(e.target.value) })} disabled={!editable || busy !== null} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-dmg-cap">{t("terms.damages_cap")}</Label>
                <Input id="t-dmg-cap" type="number" min="0" step="any" dir="ltr" value={toPct(draft.damages.cap)} onChange={(e) => set("damages", { ...draft.damages, cap: fromPct(e.target.value) })} disabled={!editable || busy !== null} />
              </div>
            </div>
          )}
        </div>
      </div>

      {lifecycle !== "plan" && pm.original && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={13} aria-hidden="true" />
          {t("terms.original_kept", { advance: pmPct(pm.original.advance), retention: pmPct(pm.original.retention) })}
        </p>
      )}

      {editable && (
        <div className="mt-4 space-y-3">
          <BlockingReasons title={t("cannot_save")} reasons={problems.map((p) => t(`terms.problem.${p}`))} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void save()} disabled={!dirty || problems.length > 0 || busy !== null}>
              {busy === "save" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("terms.save")}
            </Button>
            <Button onClick={() => void start()} disabled={starts.length > 0 || dirty || busy !== null}>
              {busy === "start" ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <Play size={16} className="me-1.5" aria-hidden="true" />}
              {t("terms.start")}
            </Button>
          </div>
          <BlockingReasons title={t("cannot_start")} reasons={[...(dirty ? [t("start_block.unsaved")] : []), ...starts.map((b) => t(`start_block.${b}`))]} />
        </div>
      )}
    </Panel>
  )
}
