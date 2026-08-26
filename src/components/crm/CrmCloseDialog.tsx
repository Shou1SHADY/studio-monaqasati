"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { XCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import { createFollowUp } from "@/lib/crm-writes"
import {
  CRM_OPPORTUNITIES,
  HOLD_REASONS,
  LOST_REASONS,
  historyEntry,
  isoDateIn,
  stageHistory,
  type CrmOpportunity,
  type HoldReason,
  type LostReason,
} from "@/lib/crm"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"

export type CloseMode = "lost" | "hold"

/**
 * Close a deal as lost, or park it.
 *
 * The distinction matters more than it looks: a deal the client postponed is
 * not a deal we lost, and filing it as one quietly poisons the win rate and
 * the loss analysis. Hold keeps the stage intact so the deal resumes exactly
 * where it stopped.
 *
 * The lost path insists on a reason and offers to capture the winning price,
 * because "why we lose" is the only report in this module that changes how
 * the next bid gets priced.
 */
export function CrmCloseDialog({
  open,
  onOpenChange,
  mode,
  opportunity,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: CloseMode
  opportunity: CrmOpportunity
}) {
  const t = useTranslations("Portal.Shared")

  const firestore = useFirestore()
  const { toast } = useToast()

  const [isSaving, setIsSaving] = useState(false)
  const [lostReason, setLostReason] = useState<LostReason>("price")
  const [competitor, setCompetitor] = useState("")
  const [competitorPrice, setCompetitorPrice] = useState("")
  const [lesson, setLesson] = useState("")
  const [holdReason, setHoldReason] = useState<HoldReason>("client_postponed")
  const [holdUntil, setHoldUntil] = useState("")
  const [keepRelationship, setKeepRelationship] = useState(true)

  useEffect(() => {
    if (!open) return
    setLostReason(opportunity.lostReason ?? "price")
    setCompetitor(opportunity.lostToCompetitor ?? "")
    setCompetitorPrice(opportunity.competitorPrice != null ? String(opportunity.competitorPrice) : "")
    setLesson(opportunity.lessonLearned ?? "")
    setHoldReason(opportunity.holdReason ?? "client_postponed")
    setHoldUntil(opportunity.holdUntil ?? isoDateIn(60))
  }, [open, opportunity])

  const gap = useMemo(() => {
    const theirs = parseFloat(competitorPrice)
    const ours = opportunity.submittedPrice || 0
    if (!Number.isFinite(theirs) || theirs <= 0 || ours <= 0) return null
    return Math.round(((ours - theirs) / theirs) * 1000) / 10
  }, [competitorPrice, opportunity.submittedPrice])

  const handleSave = async () => {
    if (!firestore || isSaving) return
    setIsSaving(true)
    try {
      const ref = doc(firestore, CRM_OPPORTUNITIES, opportunity.id)
      if (mode === "lost") {
        const theirs = parseFloat(competitorPrice)
        await updateDoc(ref, {
          stage: "lost",
          state: "lost",
          lostReason,
          lostToCompetitor: competitor.trim() || null,
          competitorPrice: Number.isFinite(theirs) && theirs > 0 ? theirs : null,
          lessonLearned: lesson.trim() || null,
          stageHistory: [...stageHistory(opportunity), historyEntry("lost", opportunity.ownerName)],
          updatedAt: serverTimestamp(),
        })
        // Losing a bid is not losing a client. A dated follow-up is the
        // difference between "we lost that one" and "we never called back".
        if (keepRelationship) {
          await createFollowUp(firestore, {
            orgId: opportunity.organizationId,
            contactId: opportunity.contactId,
            contactName: opportunity.contactName,
            type: "call",
            title: t("crm_lost_followup_title", { deal: opportunity.title }),
            dueInDays: 90,
            ownerId: opportunity.ownerId,
            ownerName: opportunity.ownerName,
          })
        }
        toast({ title: t("crm_closed_lost") })
      } else {
        await updateDoc(ref, {
          state: "on_hold",
          holdReason,
          holdUntil: holdUntil || null,
          stageHistory: [...stageHistory(opportunity), historyEntry("on_hold", opportunity.ownerName)],
          updatedAt: serverTimestamp(),
        })
        toast({ title: t("crm_put_on_hold") })
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const steps: CrmFormStep[] = [
    {
      id: "close",
      title: t(mode === "lost" ? "crm_close_lost_btn" : "crm_hold_btn"),
      validate: () => {
        return null
      },
      content: (
        <>
            {mode === "lost" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="close-reason">{t("crm_lost_reason")} <RequiredMark /></Label>
                  <Select value={lostReason} onValueChange={(v) => setLostReason(v as LostReason)} disabled={isSaving}>
                    <SelectTrigger id="close-reason"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LOST_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>{t(`crm_lost_reason_${r}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="close-competitor">{t("crm_lost_competitor")}</Label>
                    <Input id="close-competitor" value={competitor} onChange={(e) => setCompetitor(e.target.value)} disabled={isSaving} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="close-price">{t("crm_lost_winning_price")}</Label>
                    <Input id="close-price" type="number" min="0" step="any" inputMode="decimal" value={competitorPrice} onChange={(e) => setCompetitorPrice(e.target.value)} dir="ltr" disabled={isSaving} />
                  </div>
                </div>
                {gap !== null && (
                  <p className="rounded-lg border bg-muted/30 px-3 py-2 text-sm flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{t("crm_lost_price_gap")}</span>
                    <span className="font-black text-destructive" dir="ltr">{gap > 0 ? "+" : ""}{gap}%</span>
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="close-lesson">{t("crm_lost_lesson")}</Label>
                  <Textarea id="close-lesson" value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder={t("crm_lost_lesson_placeholder")} disabled={isSaving} />
                </div>
                <div className="flex items-start gap-2.5 rounded-lg border p-3">
                  <Checkbox
                    id="close-keep"
                    checked={keepRelationship}
                    onCheckedChange={(v) => setKeepRelationship(v === true)}
                    disabled={isSaving}
                    className="mt-0.5"
                  />
                  <Label htmlFor="close-keep" className="text-sm font-normal cursor-pointer">
                    {t("crm_lost_keep_relationship")}
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      {t("crm_lost_keep_relationship_hint")}
                    </span>
                  </Label>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="hold-reason">{t("crm_hold_reason")} <RequiredMark /></Label>
                  <Select value={holdReason} onValueChange={(v) => setHoldReason(v as HoldReason)} disabled={isSaving}>
                    <SelectTrigger id="hold-reason"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOLD_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>{t(`crm_hold_reason_${r}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hold-until">{t("crm_hold_revisit")}</Label>
                  <input id="hold-until" type="date" value={holdUntil} onChange={(e) => setHoldUntil(e.target.value)} dir="ltr" disabled={isSaving} className={DATE_INPUT_CLASS} />
                  <p className="text-[11px] text-muted-foreground">{t("crm_hold_revisit_hint")}</p>
                </div>
              </>
            )}
        </>
      ),
    },
  ]

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={XCircle}
      title={t(mode === "lost" ? "crm_close_lost_title" : "crm_hold_title")}
      description={t(mode === "lost" ? "crm_close_lost_desc" : "crm_hold_desc")}
      steps={steps}
      isSaving={isSaving}
      submitLabel={t(mode === "lost" ? "crm_close_lost_btn" : "crm_hold_btn")}
      onSubmit={() => void handleSave()}
      size="md"
    />
  )
}
