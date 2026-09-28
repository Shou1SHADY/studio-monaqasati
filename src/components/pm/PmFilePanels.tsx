"use client"

// File › Contract details on a PM 1.0 project (the prototype's fileInfo): the
// project's information — only the location and the consultant are edited
// here, by whoever approves; the contract terms at a glance with the org's
// recorded self-approval (the owner's switch); and "Start work" while the
// project is in planning.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc } from "firebase/firestore"
import { Clock, FileText, Loader2, Play, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmTermText } from "@/hooks/usePmTermText"
import { PmAccessError } from "@/lib/pm/access"
import { progressOf } from "@/lib/pm/acceptance"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import { delayAndDamages, grantedDays, PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { addDays } from "@/lib/pm/programme"
import { pmDate, pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import { PM_SETTINGS, PmInfoError, setSelfApproval, updatePmInfo, type InfoActor, type PmOrgSettings } from "@/lib/pm/info-writes"
import { lifecycleOf, startBlocks } from "@/lib/pm/lifecycle"
import { PmProjectError, startProject } from "@/lib/pm/project-writes"
import { defaultTerms, termProblems, type ContractTerms } from "@/lib/pm/terms"
import { approvedValue, PM_VARIATIONS, type PmVariation } from "@/lib/pm/variation"
import { displayDocNumber } from "@/lib/sales-numbering"
import { CheckLine, ChoiceChips, FormHint } from "./ContractBits"

export interface PmFileProject {
  name?: string | null
  organizationId?: string | null
  clientName?: string | null
  clientType?: string | null
  location?: string | null
  consultant?: string | null
  projectManagerId?: string | null
  projectManagerName?: string | null
  budget?: number | null
  status?: string | null
  pm?: {
    no?: string
    lifecycle?: string
    kind?: string | null
    startOn?: string | null
    startedAt?: string | null
    durationDays?: number
    terms?: ContractTerms
    original?: ContractTerms | null
    acceptances?: { prov?: { on: string } | null } | null
    holdSince?: string | null
    holdWhy?: string | null
  } | null
}

const dayGap = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000))

const useClaims = (projectId: string) => {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_CLAIMS) : null), [firestore, projectId])
  const { data } = useCollection(q)
  return useMemo(() => (data ?? []) as unknown as PmClaim[], [data])
}

/** C-31 · C-02 — the project's information; edit = location + consultant only. */
export function PmInfoPanel({ projectId, project, access }: { projectId: string; project: PmFileProject; access: PmAccess }) {
  const t = useTranslations("Portal.PM")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const claims = useClaims(projectId)
  const [editing, setEditing] = useState(false)
  const [location, setLocation] = useState("")
  const [consultant, setConsultant] = useState("")
  const [busy, setBusy] = useState(false)
  const pm = project.pm ?? {}
  // The terms IN FORCE (original + signed addenda) — addenda are read by money or approve only.
  const seesAddenda = access.has("money") || access.has("approve")
  const addQ = useMemoFirebase(() => (firestore && seesAddenda ? collection(firestore, "projects", projectId, PM_ADDENDA) : null), [firestore, projectId, seesAddenda])
  const { data: addenda } = useCollection(addQ)
  const terms = inForce(pm.original ?? pm.terms ?? defaultTerms(), (addenda ?? []) as unknown as PmAddendum[])
  const onHold = lifecycleOf(project) === "hold"
  const eot = grantedDays(claims)
  const start = (pm.startedAt ?? pm.startOn ?? "").slice(0, 10) || null
  const dur = pm.durationDays ?? 0
  const prov = pm.acceptances?.prov?.on ?? null
  const canEdit = !access.ctx.archived && access.allowed("project.edit")

  const save = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await updatePmInfo(firestore, access.ctx, projectId, { location, consultant })
      toast({ title: t("info.saved") })
      setEditing(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmInfoError && err.code === "too_long" ? "info.too_long" : "error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={t("info.title")}
      icon={FileText}
      actions={
        canEdit ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLocation(project.location ?? "")
              setConsultant(project.consultant ?? "")
              setEditing(true)
            }}
          >
            {t("info.edit")}
          </Button>
        ) : undefined
      }
    >
      <KeyValueRow label={t("info.no")} value={pm.no ? displayDocNumber(pm.no, locale) : "—"} />
      <KeyValueRow
        label={t("info.client")}
        value={
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
            <span dir="auto">{project.clientName || "—"}</span>
            <SourceBadge module="crm" label={t("info.from_crm")} />
          </span>
        }
      />
      <KeyValueRow label={t("info.types")} value={[project.clientType, pm.kind ? tShared(`pm_kind_${pm.kind}` as "pm_kind_bld") : null].filter(Boolean).join(" · ") || "—"} />
      <KeyValueRow label={t("info.location")} value={project.location || "—"} />
      <KeyValueRow label={t("info.consultant")} value={project.consultant || "—"} />
      <KeyValueRow label={t("info.manager")} value={project.projectManagerName || "—"} />
      {onHold && (pm.holdWhy || pm.holdSince) && (
        <KeyValueRow
          label={t("info.hold_why")}
          value={
            <span className="block text-end">
              <b dir="auto">{pm.holdWhy || "—"}</b>
              {pm.holdSince && (
                <span className="block text-xs text-muted-foreground">
                  {t("info.hold_since", { date: pmDate(pm.holdSince, locale), days: t("days", { count: dayGap(pm.holdSince, todayDay()) }) })}
                </span>
              )}
            </span>
          }
        />
      )}
      <KeyValueRow
        label={t("info.start_duration")}
        value={
          start
            ? `${pmDate(start, locale)} · ${t("days", { count: dur })}${eot ? ` + ${t("info.eot", { days: t("days", { count: eot }) })}` : ""} · ${t("info.ends", { date: pmDate(addDays(start, dur + eot), locale) })}`
            : t("days", { count: dur })
        }
      />
      {access.has("money") && (
        <KeyValueRow
          label={t("info.financial")}
          value={terms.payer === "none" ? t("terms.opt.payer.none") : t("info.financial_value", { advance: pmPct(terms.advance), retention: pmPct(terms.retention) })}
        />
      )}
      {prov && <KeyValueRow label={t("info.prov")} value={t("info.prov_value", { date: pmDate(prov, locale), end: pmDate(addDays(prov, terms.defectsDays), locale) })} />}

      <Dialog open={editing} onOpenChange={(o) => !busy && setEditing(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("info.edit_title")}</DialogTitle>
            <DialogDescription dir="auto">{project.name ?? ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pi-loc">{t("info.location")}</Label>
                <Input id="pi-loc" value={location} onChange={(e) => setLocation(e.target.value)} disabled={busy} dir="auto" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pi-cons">{t("info.consultant")}</Label>
                <Input id="pi-cons" value={consultant} onChange={(e) => setConsultant(e.target.value)} placeholder={t("info.consultant_ph")} disabled={busy} dir="auto" />
              </div>
            </div>
            <Callout tone="info" title={t("info.not_here_title")}>
              {t("info.not_here")}
            </Callout>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("info.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

/** C-32 — the terms at a glance (money), with the org's recorded self-approval (the owner's). */
export function PmTermsGlance({
  projectId,
  project,
  items,
  access,
  actor,
  onOpenTerms,
}: {
  projectId: string
  project: PmFileProject
  items: Array<{ quantity: number; rate: number; executed: number }>
  access: PmAccess
  actor: InfoActor
  onOpenTerms?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const text = usePmTermText()
  const firestore = useFirestore()
  const { toast } = useToast()
  const claims = useClaims(projectId)
  const orgId = project.organizationId ?? ""
  const addQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_ADDENDA) : null), [firestore, projectId])
  const { data: addenda } = useCollection(addQ)
  const voQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [firestore, projectId])
  const { data: vos } = useCollection(voQ)
  const setQ = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PM_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settings } = useDoc(setQ)
  const [busy, setBusy] = useState(false)
  if (!access.has("money")) return null
  const pm = project.pm ?? {}
  const terms = inForce(pm.original ?? pm.terms ?? defaultTerms(), (addenda ?? []) as unknown as PmAddendum[])
  const value = (project.budget ?? 0) + approvedValue((vos ?? []) as unknown as PmVariation[])
  const today = todayDay()
  const delay = delayAndDamages({
    lifecycle: lifecycleOf(project),
    startOn: (pm.startedAt ?? pm.startOn ?? "").slice(0, 10) || null,
    effectiveDays: (pm.durationDays ?? 0) + grantedDays(claims),
    progress: progressOf(items),
    contractValue: value,
    damages: terms.damages,
    today,
  })
  const self = (settings as PmOrgSettings | null)?.selfApproval === true
  const s = settings as PmOrgSettings | null

  const toggle = async (allowed: boolean) => {
    if (!firestore || !orgId || allowed === self) return
    setBusy(true)
    try {
      await setSelfApproval(firestore, access.ctx, orgId, actor, allowed)
      toast({ title: t("glance.self_saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : "error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={t("glance.title")}
      icon={Settings2}
      actions={
        onOpenTerms ? (
          <Button size="sm" variant="outline" onClick={onOpenTerms}>
            <FileText size={14} className="me-1.5" aria-hidden="true" />
            {t("glance.open_terms")}
          </Button>
        ) : undefined
      }
    >
      <p className="mb-2 text-xs text-muted-foreground">{t("glance.sub")}</p>
      <KeyValueRow label={t("terms.payer")} value={text("payer", terms.payer)} />
      <KeyValueRow label={t("terms.damages")} value={text("damages", terms.damages)} />
      {terms.damages.on &&
        (delay && delay.damages > 0 ? (
          <Callout tone="warn" className="my-2">
            {t("glance.penalty", { amount: pmMoney(delay.damages), pct: pmPct(value ? delay.damages / value : 0) })}
          </Callout>
        ) : (
          <Callout tone="info" className="my-2">
            {t("glance.no_penalty")}
          </Callout>
        ))}
      <KeyValueRow label={t("terms.claimNoticeDays")} value={text("claimNoticeDays", terms.claimNoticeDays)} />
      <FormHint>{t("terms.mean.notice")}</FormHint>
      {access.has("admin") && !access.ctx.archived && (
        <div className="mt-4 space-y-1.5">
          <Label>{t("glance.self_label")}</Label>
          <ChoiceChips
            label={t("glance.self_label")}
            options={[
              { id: "on", label: t("glance.self_on") },
              { id: "off", label: t("glance.self_off") },
            ]}
            value={self ? "on" : "off"}
            onChange={(v) => void toggle(v === "on")}
            disabled={busy}
          />
          <FormHint>{self ? t("glance.self_on_hint") : t("glance.self_off_hint")}</FormHint>
          {s?.selfApprovalByName && s.selfApprovalOn && <FormHint>{t("glance.self_by", { who: s.selfApprovalByName, date: pmDate(s.selfApprovalOn, locale) })}</FormHint>}
        </div>
      )}
    </Panel>
  )
}

/** C-33 — "Start work" while the project is in planning (approve). */
export function PmStartPanel({ projectId, project, boqItems, access }: { projectId: string; project: PmFileProject; boqItems: number; access: PmAccess }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const lifecycle = lifecycleOf(project)
  if (lifecycle !== "plan" || access.ctx.archived || !access.allowed("project.start")) return null
  const blocks = startBlocks({ lifecycle, hasManager: Boolean(project.projectManagerId), boqItems, termProblems: termProblems(project.pm?.terms ?? defaultTerms()).length })

  const start = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      await startProject(firestore, access.ctx, projectId, boqItems)
      toast({ title: t("terms.started") })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmProjectError && err.blocks?.[0] ? `start_block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t("startp.title")} icon={Play}>
      <p className="mb-2 text-xs text-muted-foreground">{t("startp.sub")}</p>
      <CheckLine ok={boqItems > 0} title={t("startp.boq")} note={boqItems > 0 ? t("startp.items", { count: boqItems }) : t("startp.no_items")} />
      <CheckLine ok={Boolean(project.projectManagerId)} title={t("startp.pm")} note={project.projectManagerName || t("startp.not_assigned")} />
      <CheckLine ok={!blocks.includes("terms_invalid")} title={t("startp.terms")} note={blocks.includes("terms_invalid") ? t("start_block.terms_invalid") : t("startp.terms_ok")} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button className="bg-success text-success-foreground hover:bg-success/90" onClick={() => void start()} disabled={busy || blocks.length > 0}>
          {busy ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <Play size={16} className="me-1.5" aria-hidden="true" />}
          {t("startp.start")}
        </Button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock size={12} aria-hidden="true" />
          {t("startp.auto")}
        </span>
      </div>
    </Panel>
  )
}
