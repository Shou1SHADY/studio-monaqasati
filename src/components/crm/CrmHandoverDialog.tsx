"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Building2, CheckCircle2, FileText, Paperclip, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { IconButton } from "@/components/module-ui/IconButton"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useFirestore, useStorage } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import { guessFileKind } from "@/components/crm/OppFilesPanel"
import { iso } from "@/components/crm/OppBits"
import type { TeamMember } from "@/hooks/useCrmData"
import { suggestContractNumber } from "@/lib/crm-writes"
import { addOpportunityFiles, oppFileAllowed, type OppActor, type OpportunityFile } from "@/lib/crm-opportunity-writes"
import type { ProjectKind } from "@/lib/pm/handover"
import { sendHandoverFile } from "@/lib/pm/handover-writes"
import { displayDocNumber } from "@/lib/sales-numbering"
import {
  OPPORTUNITY_FILE_KINDS,
  formatSar,
  opportunityBestValue,
  primaryScope,
  type CrmContact,
  type CrmOpportunity,
  type CrmQuotation,
  type OpportunityFileKind,
  type ScopeType,
} from "@/lib/crm"

/** The project's kind follows the deal's work type (OPP-07 #2) — one list, not a second one to fill in. */
const KIND_OF_SCOPE: Record<ScopeType, ProjectKind> = {
  residential: "bld",
  commercial: "bld",
  offices: "bld",
  industrial: "ind",
  healthcare: "bld",
  education: "bld",
  infrastructure: "infra",
  renovation: "mnt",
  fitout: "bld",
  mep: "mep",
  facilities: "mnt",
}

export function projectKindOf(opp: Pick<CrmOpportunity, "scopeTypes" | "customScopeActivity">): ProjectKind {
  const scope = primaryScope(opp)
  if (scope) return KIND_OF_SCOPE[scope]
  const activity = opp.customScopeActivity
  return activity === "roads" ? "road" : activity === "mep" ? "mep" : activity === "maintenance" ? "mnt" : "bld"
}

const percentText = (fraction: number | null | undefined) => (fraction != null && fraction > 0 ? String(Math.round(fraction * 10000) / 100) : "")

/**
 * Hand a won PROJECT to Project Management (OPP-07) — the CRM's last step, and the only place a manager is chosen: the
 * receiving project manager is the first owner in the deal's journey. The deal's number, client and work type come from
 * the deal (read only); the contract terms start EMPTY and are typed from the signed contract; the accepted offer is
 * attached by itself, and the signed contract, the priced BOQ and anything else are picked from the deal's files or
 * attached here. PM 1.0: this sends a handover FILE; the project is born when the manager accepts it.
 */
export function CrmHandoverDialog({
  open,
  onOpenChange,
  opportunity,
  contact,
  orgId,
  teamMembers,
  handedOverCount,
  acceptedOffer,
  files,
  actor,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  opportunity: CrmOpportunity
  contact?: CrmContact | null
  orgId: string
  teamMembers: TeamMember[]
  /** Deals already handed over — used only to suggest the next contract number. */
  handedOverCount: number
  /** Kept for callers; the project no longer exists at this step. */
  projectsBasePath?: string
  acceptedOffer: CrmQuotation | null
  files: OpportunityFile[]
  actor: OppActor
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const input = useRef<HTMLInputElement>(null)

  const [isSaving, setIsSaving] = useState(false)
  const [contractNumber, setContractNumber] = useState("")
  const [durationDays, setDurationDays] = useState("")
  const [signedOn, setSignedOn] = useState("")
  const [startOn, setStartOn] = useState("")
  const [advancePercent, setAdvancePercent] = useState("")
  const [retentionPercent, setRetentionPercent] = useState("")
  const [projectManagerId, setProjectManagerId] = useState("")
  const [notes, setNotes] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [extra, setExtra] = useState<Array<{ file: File; kind: OpportunityFileKind }>>([])

  useEffect(() => {
    if (!open) return
    setContractNumber(opportunity.contractNumber || suggestContractNumber(handedOverCount))
    // A file returned by the manager comes back with what was sent (days, and the percentages stored as fractions);
    // a first handover starts empty — the terms are the signed contract's, never a default (OPP-07 #3).
    setDurationDays(opportunity.durationDays ? String(opportunity.durationDays) : opportunity.durationMonths ? String(opportunity.durationMonths * 30) : "")
    setSignedOn("")
    setStartOn("")
    setAdvancePercent(percentText(opportunity.advancePercent))
    setRetentionPercent(percentText(opportunity.retentionPercent))
    setProjectManagerId(opportunity.projectManagerId ?? "")
    setNotes("")
    setPicked(files.filter((f) => f.kind === "contract" || f.kind === "boq").map((f) => f.id))
    setExtra([])
  }, [open, opportunity, handedOverCount, files])

  const contractValue = opportunity.awardedValue || acceptedOffer?.amount || opportunityBestValue(opportunity)
  const kind = projectKindOf(opportunity)
  const scope = primaryScope(opportunity)
  const pm = teamMembers.find((m) => m.id === projectManagerId)
  const pickable = useMemo(() => files.filter((f) => f.kind !== "quotation"), [files])

  const addExtra = (list: FileList | null) => {
    if (!list) return
    const next: Array<{ file: File; kind: OpportunityFileKind }> = []
    for (const file of Array.from(list)) {
      const check = oppFileAllowed(file)
      if (check !== "ok") {
        toast({ variant: "destructive", title: t(`crm_file_err_${check}`, { name: file.name }) })
        continue
      }
      next.push({ file, kind: guessFileKind(file) })
    }
    setExtra((p) => [...p, ...next])
    if (input.current) input.current.value = ""
  }

  const handleSubmit = async () => {
    if (!firestore || isSaving) return
    setIsSaving(true)
    try {
      // Files attached here join the deal's files first, so the deal keeps them too.
      const added = extra.length ? await addOpportunityFiles(firestore, storage, opportunity, actor, extra, "handover") : []
      const sent = [...files.filter((f) => picked.includes(f.id)), ...added].map((f) => ({ name: f.name, path: f.path, kind: f.kind }))
      const pct = (v: string) => {
        const n = parseFloat(v)
        return Number.isFinite(n) && n > 0 ? n / 100 : null
      }
      await sendHandoverFile(firestore, {
        organizationId: orgId,
        actor: { uid: actor.uid, name: actor.name },
        opportunity,
        clientType: contact?.entityType ?? null,
        location: contact?.city ?? null,
        contractNumber,
        value: contractValue,
        durationDays: parseInt(durationDays, 10) || 0,
        signedOn: signedOn || null,
        startOn: startOn || null,
        advance: pct(advancePercent),
        retention: pct(retentionPercent),
        kind,
        note: notes.trim() || null,
        to: pm?.id ?? "",
        toName: pm?.name ?? null,
        files: sent,
        acceptedOffer: acceptedOffer ? { id: acceptedOffer.id, number: acceptedOffer.quotationNumber, amount: acceptedOffer.amount } : null,
        notification: {
          title: t("crm_handover_notif_title"),
          message: t("crm_handover_notif_message", { project: opportunity.title, by: actor.name }),
        },
      })
      toast({ title: t("crm_handover_done") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_handover_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const summary: Array<[string, React.ReactNode]> = [
    [t("crm_opp_label"), [displayDocNumber(opportunity.docNumber, locale), opportunity.title].filter(Boolean).join(" · ")],
    [t("crm_client"), opportunity.contactName || contact?.name || "—"],
    [t("crm_handover_work_type"), `${scope ? t(`crm_scope_${scope}`) : opportunity.customScopeType || "—"} (${t(`pm_kind_${kind}`)}) — ${t("crm_from_opportunity")}`],
    [
      t("crm_handover_contract_value"),
      <span key="v" dir="auto">
        <span dir="ltr">{formatSar(contractValue, locale)}</span>
        {acceptedOffer && ` · ${t("crm_handover_accepted_offer", { number: iso(displayDocNumber(acceptedOffer.quotationNumber, locale)) })}`}
      </span>,
    ],
  ]

  const steps: CrmFormStep[] = [
    {
      id: "handover",
      title: t("crm_handover_btn"),
      validate: () => {
        if (!contractNumber.trim()) return t("crm_handover_contract_required")
        if (!signedOn) return t("crm_handover_signed_required")
        if (!projectManagerId) return t("crm_handover_pm_required")
        return null
      },
      content: (
        <>
          <dl className="divide-y rounded-lg border bg-muted/30 text-sm">
            {summary.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-end font-bold">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ho-contract">
                {t("crm_handover_contract_number")} <RequiredMark />
              </Label>
              <Input id="ho-contract" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} dir="ltr" disabled={isSaving} />
              <p className="text-[11px] text-muted-foreground">{t("crm_handover_as_in_contract")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-signed">
                {t("crm_handover_signed_on")} <RequiredMark />
              </Label>
              <Input id="ho-signed" type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} dir="ltr" disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-start">{t("crm_handover_start_on")}</Label>
              <Input id="ho-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} dir="ltr" disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-duration">{t("crm_handover_duration")}</Label>
              <Input id="ho-duration" type="number" min="1" inputMode="numeric" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} dir="ltr" disabled={isSaving} />
              <p className="text-[11px] text-muted-foreground">{t("crm_handover_from_contract")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-advance">{t("crm_handover_advance")}</Label>
              <Input id="ho-advance" type="number" min="0" max="100" step="any" inputMode="decimal" value={advancePercent} onChange={(e) => setAdvancePercent(e.target.value)} dir="ltr" disabled={isSaving} />
              <p className="text-[11px] text-muted-foreground">{t("crm_handover_from_contract")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-retention">{t("crm_handover_retention")}</Label>
              <Input id="ho-retention" type="number" min="0" max="100" step="any" inputMode="decimal" value={retentionPercent} onChange={(e) => setRetentionPercent(e.target.value)} dir="ltr" disabled={isSaving} />
              <p className="text-[11px] text-muted-foreground">{t("crm_handover_retention_hint")}</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ho-pm">
                {t("crm_handover_pm")} <RequiredMark />
              </Label>
              <NativeSelect id="ho-pm" className="w-full" value={projectManagerId} onChange={(e) => setProjectManagerId(e.target.value)} disabled={isSaving}>
                <option value="" disabled>
                  {t("crm_handover_pm_pick")}
                </option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-[11px] text-muted-foreground">{t("crm_handover_pm_first")}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("crm_handover_attachments")}</Label>
            <div className="space-y-2 rounded-lg border border-dashed p-3 text-sm">
              {acceptedOffer && (
                <p className="flex items-center gap-2">
                  <FileText size={13} className="shrink-0 text-indigo" aria-hidden="true" />
                  <bdi dir="ltr">{displayDocNumber(acceptedOffer.quotationNumber, locale)}.pdf</bdi>
                  <span className="text-[11px] text-muted-foreground">— {t("crm_handover_offer_auto")}</span>
                </p>
              )}
              {pickable.length > 0 && <p className="pt-1 text-[11px] font-bold text-muted-foreground">{t("crm_handover_from_files")}</p>}
              {pickable.map((f) => (
                <div key={f.id} className="flex items-center gap-2">
                  <Checkbox id={`ho-f-${f.id}`} checked={picked.includes(f.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, f.id] : p.filter((x) => x !== f.id)))} />
                  <Label htmlFor={`ho-f-${f.id}`} className="cursor-pointer font-normal">
                    <bdi dir="auto">{f.name}</bdi>
                    <span className="ms-2 text-[11px] text-muted-foreground">{t(`crm_file_kind_${f.kind}`)}</span>
                  </Label>
                </div>
              ))}
              {extra.map((x, i) => (
                <div key={`${x.file.name}-${i}`} className="flex flex-wrap items-center gap-2">
                  <Paperclip size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <bdi dir="auto" className="min-w-0 flex-1 truncate">{x.file.name}</bdi>
                  <NativeSelect
                    aria-label={t("crm_file_kind")}
                    className="h-8 w-40 text-xs"
                    value={x.kind}
                    onChange={(e) => setExtra((list) => list.map((y, j) => (j === i ? { ...y, kind: e.target.value as OpportunityFileKind } : y)))}
                  >
                    {OPPORTUNITY_FILE_KINDS.filter((k) => k !== "quotation").map((k) => (
                      <option key={k} value={k}>
                        {t(`crm_file_kind_${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
                  <IconButton icon={Trash2} iconSize={13} label={t("crm_delete_btn")} onClick={() => setExtra((list) => list.filter((_, j) => j !== i))} />
                </div>
              ))}
              <input ref={input} type="file" multiple className="sr-only" aria-label={t("crm_files_attach")} onChange={(e) => addExtra(e.target.files)} />
              <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-cta" onClick={() => input.current?.click()} disabled={isSaving}>
                <Paperclip size={13} aria-hidden="true" />
                {t("crm_files_attach")}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ho-notes">{t("crm_handover_notes")}</Label>
            <Textarea id="ho-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("crm_handover_notes_placeholder")} disabled={isSaving} />
          </div>

          <ul className="space-y-1.5 rounded-lg border border-cta/20 bg-cta/5 p-3 text-xs text-foreground">
            {["crm_handover_effect_project", "crm_handover_effect_pm", "crm_handover_effect_sections", "crm_handover_effect_closed"].map((key) => (
              <li key={key} className="flex items-start gap-2">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-cta" aria-hidden="true" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </>
      ),
    },
  ]

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Building2}
      title={t("crm_handover_title")}
      description={t("crm_handover_desc")}
      steps={steps}
      isSaving={isSaving}
      submitLabel={t("crm_handover_btn")}
      onSubmit={() => void handleSubmit()}
      size="lg"
    />
  )
}
