"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Building2, CheckCircle2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore, useUser } from "@/firebase"
import { useRouter } from "@/i18n/routing"
import { useToast } from "@/hooks/use-toast"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import type { TeamMember } from "@/hooks/useCrmData"
import { createProjectFromOpportunity, suggestContractNumber } from "@/lib/crm-writes"
import {
  formatSar,
  opportunityBestValue,
  type CrmContact,
  type CrmOpportunity,
} from "@/lib/crm"

/**
 * Hand a won deal over to Projects — the CRM's last step, and the one the
 * whole module builds towards.
 *
 * This writes a real `projects` document with the same shape the manual
 * wizard produces, so nothing downstream can tell the difference, and stamps
 * the opportunity with the new project's id. It is one-way on purpose: once a
 * project exists, unwinding it is a Projects decision, not a CRM one.
 */
export function CrmHandoverDialog({
  open,
  onOpenChange,
  opportunity,
  contact,
  orgId,
  teamMembers,
  handedOverCount,
  projectsBasePath,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  opportunity: CrmOpportunity
  contact?: CrmContact | null
  orgId: string
  teamMembers: TeamMember[]
  /** Deals already handed over — used only to suggest the next contract number. */
  handedOverCount: number
  /** Where to send the user once the project exists, e.g. `/contractor/projects`. */
  projectsBasePath: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()

  const firestore = useFirestore()
  const { user } = useUser()
  const router = useRouter()
  const { toast } = useToast()

  const [isSaving, setIsSaving] = useState(false)
  const [contractNumber, setContractNumber] = useState("")
  const [durationMonths, setDurationMonths] = useState("12")
  const [advancePercent, setAdvancePercent] = useState("10")
  const [retentionPercent, setRetentionPercent] = useState("5")
  const [projectManagerId, setProjectManagerId] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (!open) return
    setContractNumber(opportunity.contractNumber || suggestContractNumber(handedOverCount))
    setDurationMonths(opportunity.durationMonths != null ? String(opportunity.durationMonths) : "12")
    setAdvancePercent(opportunity.advancePercent != null ? String(opportunity.advancePercent) : "10")
    setRetentionPercent(opportunity.retentionPercent != null ? String(opportunity.retentionPercent) : "5")
    setProjectManagerId("")
    setNotes("")
  }, [open, opportunity, handedOverCount])

  const contractValue = opportunityBestValue(opportunity)

  const handleSubmit = async () => {
    if (!firestore || !user || isSaving) return
    if (!contractNumber.trim()) {
      toast({ title: t("crm_handover_contract_required"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const pm = teamMembers.find((m) => m.id === projectManagerId)
      const projectId = await createProjectFromOpportunity(firestore, {
        opportunity,
        contact,
        orgId,
        userId: user.uid,
        contractNumber,
        durationMonths: parseInt(durationMonths, 10) || null,
        advancePercent: parseFloat(advancePercent) || null,
        retentionPercent: parseFloat(retentionPercent) || null,
        projectManagerName: pm?.name || null,
        notes: notes.trim() || null,
        kickoffTitle: t("crm_handover_kickoff_title", { project: opportunity.title }),
      })
      toast({ title: t("crm_handover_done") })
      onOpenChange(false)
      router.push(`${projectsBasePath}/${projectId}`)
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
        return contractNumber.trim() ? null : t("crm_handover_contract_required")
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
                <Input id="ho-duration" type="number" min="1" inputMode="numeric" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} dir="ltr" disabled={isSaving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ho-pm">{t("crm_handover_pm")}</Label>
                <Select value={projectManagerId || "__none__"} onValueChange={(v) => setProjectManagerId(v === "__none__" ? "" : v)} disabled={isSaving}>
                  <SelectTrigger id="ho-pm"><SelectValue placeholder={t("crm_owner_placeholder")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("crm_owner_none")}</SelectItem>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              {["crm_handover_effect_project", "crm_handover_effect_sections", "crm_handover_effect_closed"].map((key) => (
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
