"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Building2, CheckCircle2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import type { TeamMember } from "@/hooks/useCrmData"
import { suggestContractNumber } from "@/lib/crm-writes"
import { PROJECT_KINDS, type ProjectKind } from "@/lib/pm/handover"
import { sendHandoverFile } from "@/lib/pm/handover-writes"
import {
  formatSar,
  opportunityBestValue,
  type CrmContact,
  type CrmOpportunity,
} from "@/lib/crm"

/**
 * Hand a won deal over to Projects — the CRM's last step.
 *
 * PM 1.0 (HO-01, conflict 3): this sends a handover FILE to the manager it
 * names; it creates no project. The manager accepts it in "New projects" (the
 * project is born then), returns it for completion, or passes it on. Duration
 * is in days, the one unit both modules use (conflict 9).
 */
export function CrmHandoverDialog({
  open,
  onOpenChange,
  opportunity,
  contact,
  orgId,
  teamMembers,
  handedOverCount,
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
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()

  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const [isSaving, setIsSaving] = useState(false)
  const [contractNumber, setContractNumber] = useState("")
  const [durationDays, setDurationDays] = useState("365")
  const [signedOn, setSignedOn] = useState("")
  const [startOn, setStartOn] = useState("")
  const [kind, setKind] = useState<ProjectKind>("bld")
  const [advancePercent, setAdvancePercent] = useState("10")
  const [retentionPercent, setRetentionPercent] = useState("5")
  const [projectManagerId, setProjectManagerId] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (!open) return
    setContractNumber(opportunity.contractNumber || suggestContractNumber(handedOverCount))
    setDurationDays(opportunity.durationMonths != null ? String(opportunity.durationMonths * 30) : "365")
    setSignedOn("")
    setStartOn("")
    setKind("bld")
    setAdvancePercent(opportunity.advancePercent != null ? String(opportunity.advancePercent) : "10")
    setRetentionPercent(opportunity.retentionPercent != null ? String(opportunity.retentionPercent) : "5")
    setProjectManagerId("")
    setNotes("")
  }, [open, opportunity, handedOverCount])

  const contractValue = opportunityBestValue(opportunity)

  const pm = teamMembers.find((m) => m.id === projectManagerId)
  const requester = teamMembers.find((m) => m.id === user?.uid)

  const handleSubmit = async () => {
    if (!firestore || !user || isSaving) return
    if (!contractNumber.trim()) {
      toast({ title: t("crm_handover_contract_required"), variant: "destructive" })
      return
    }
    // A handover without a named PM is a project nobody knows they own.
    if (!pm) {
      toast({ title: t("crm_handover_pm_required"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      await sendHandoverFile(firestore, {
        organizationId: orgId,
        actor: { uid: user.uid, name: requester?.name ?? user.displayName ?? null },
        opportunity,
        clientType: contact?.entityType ?? null,
        location: contact?.city ?? null,
        contractNumber,
        value: contractValue,
        durationDays: parseInt(durationDays, 10) || 0,
        signedOn: signedOn || null,
        startOn: startOn || null,
        advance: (parseFloat(advancePercent) || 0) / 100 || null,
        retention: (parseFloat(retentionPercent) || 0) / 100 || null,
        kind,
        note: notes.trim() || null,
        to: pm.id,
        toName: pm.name,
        notification: {
          title: t("crm_handover_notif_title"),
          message: t("crm_handover_notif_message", {
            project: opportunity.title,
            by: requester?.name ?? user.displayName ?? "",
          }),
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

  const steps: CrmFormStep[] = [
    {
      id: "handover",
      title: t("crm_handover_btn"),
      validate: () => {
        if (!contractNumber.trim()) return t("crm_handover_contract_required")
        if (!projectManagerId) return t("crm_handover_pm_required")
        return null
      },
      content: (
        <>
            <div className="rounded-lg border bg-muted/30 divide-y text-sm">
              <p className="px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("crm_handover_project_name")}</span>
                <span className="font-bold truncate">{opportunity.title}</span>
              </p>
              <p className="px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("crm_handover_client")}</span>
                <span className="font-bold truncate">{opportunity.contactName || contact?.name || "—"}</span>
              </p>
              <p className="px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("crm_handover_contract_value")}</span>
                <span className="font-black" dir="ltr">{formatSar(contractValue, locale)}</span>
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="ho-contract">{t("crm_handover_contract_number")} <RequiredMark /></Label>
                <Input id="ho-contract" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} dir="ltr" disabled={isSaving} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ho-duration">{t("crm_handover_duration")}</Label>
                <Input id="ho-duration" type="number" min="1" inputMode="numeric" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} dir="ltr" disabled={isSaving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ho-kind">{t("crm_handover_kind")}</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as ProjectKind)} disabled={isSaving}>
                  <SelectTrigger id="ho-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>{t(`pm_kind_${k}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ho-signed">{t("crm_handover_signed_on")}</Label>
                <Input id="ho-signed" type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} dir="ltr" disabled={isSaving} />
                <p className="text-[11px] text-muted-foreground">{t("crm_handover_signed_hint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ho-start">{t("crm_handover_start_on")}</Label>
                <Input id="ho-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} dir="ltr" disabled={isSaving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ho-pm">{t("crm_handover_pm")} <RequiredMark /></Label>
                <Select value={projectManagerId} onValueChange={setProjectManagerId} disabled={isSaving}>
                  <SelectTrigger id="ho-pm"><SelectValue placeholder={t("crm_owner_placeholder")} /></SelectTrigger>
                  <SelectContent>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">{t("crm_handover_pm_hint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ho-advance">{t("crm_handover_advance")}</Label>
                <Input id="ho-advance" type="number" min="0" max="100" step="any" inputMode="decimal" value={advancePercent} onChange={(e) => setAdvancePercent(e.target.value)} dir="ltr" disabled={isSaving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ho-retention">{t("crm_handover_retention")}</Label>
                <Input id="ho-retention" type="number" min="0" max="100" step="any" inputMode="decimal" value={retentionPercent} onChange={(e) => setRetentionPercent(e.target.value)} dir="ltr" disabled={isSaving} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ho-notes">{t("crm_handover_notes")}</Label>
              <Textarea id="ho-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("crm_handover_notes_placeholder")} disabled={isSaving} />
            </div>

            {/* What saving actually does, stated before it happens — this write
                creates a record in another module and cannot be undone here. */}
            <ul className="rounded-lg border border-cta/20 bg-cta/5 p-3 space-y-1.5 text-xs text-foreground">
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
      size="md"
    />
  )
}
