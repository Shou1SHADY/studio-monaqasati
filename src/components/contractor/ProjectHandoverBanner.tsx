"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Building2, CheckCircle2, Loader2, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { HANDOVER_BADGE_CLASS, type ProjectHandover } from "@/lib/crm"
import { respondToHandover } from "@/lib/crm-writes"

/**
 * The project manager's answer to a handover from the CRM.
 *
 * Shown at the top of a project that came from a won deal. The named PM sees
 * Accept / Reject; everyone else sees where the handover stands. A rejection
 * needs a reason because it goes straight back to whoever handed the deal
 * over, and "no" with nothing attached is not something they can act on.
 */
export function ProjectHandoverBanner({
  projectId,
  projectName,
  handover,
}: {
  projectId: string
  projectName: string
  handover: ProjectHandover
}) {
  const t = useTranslations("Portal.Contractor")
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  const isPm = !!user && user.uid === handover.pmId
  const pending = handover.status === "pending"

  const respond = async (decision: "accepted" | "rejected") => {
    if (!firestore || !user || busy) return
    if (decision === "rejected" && reason.trim().length < 4) {
      toast({ title: t("proj_handover_reject_reason_required"), variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      const userName = user.displayName ?? handover.pmName ?? null
      await respondToHandover(firestore, {
        projectId,
        handover,
        decision,
        reason: decision === "rejected" ? reason : null,
        userId: user.uid,
        userName,
        notification: {
          title: t(decision === "accepted" ? "proj_handover_notif_accepted_title" : "proj_handover_notif_rejected_title"),
          message: t(decision === "accepted" ? "proj_handover_notif_accepted_message" : "proj_handover_notif_rejected_message", {
            project: projectName,
            pm: userName ?? "",
            reason: reason.trim(),
          }),
        },
      })
      toast({ title: t(decision === "accepted" ? "proj_handover_accepted_toast" : "proj_handover_rejected_toast") })
      setRejecting(false)
      setReason("")
    } catch (err) {
      console.error(err)
      toast({ title: t("proj_handover_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3",
        pending ? "border-warning/30 bg-warning/5" : handover.status === "accepted" ? "border-success/20 bg-success/5" : "border-destructive/20 bg-destructive/5"
      )}
      role={pending && isPm ? "region" : undefined}
      aria-label={pending && isPm ? t("proj_handover_banner_title") : undefined}
    >
      <div className="flex flex-wrap items-start gap-3">
        <Building2 size={18} className="shrink-0 mt-0.5 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-bold text-foreground flex flex-wrap items-center gap-2">
            {pending && isPm ? t("proj_handover_banner_title") : t("proj_handover_banner_title_other")}
            <Badge variant="outline" className={cn("text-[10px]", HANDOVER_BADGE_CLASS[handover.status])}>
              {t(`proj_handover_status_${handover.status}`)}
            </Badge>
          </p>
          <p className="text-xs text-muted-foreground">
            {t("proj_handover_banner_desc", {
              pm: handover.pmName || "—",
              by: handover.requestedByName || "—",
            })}
          </p>
          {handover.status === "rejected" && handover.rejectReason && (
            <p className="text-xs text-destructive">{t("proj_handover_reject_reason")}: {handover.rejectReason}</p>
          )}
        </div>

        {pending && isPm && !rejecting && (
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" disabled={busy} onClick={() => setRejecting(true)}>
              <XCircle size={13} />
              {t("proj_handover_reject")}
            </Button>
            <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => void respond("accepted")}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              {t("proj_handover_accept")}
            </Button>
          </div>
        )}
      </div>

      {pending && isPm && rejecting && (
        <div className="space-y-2 rounded-lg border bg-background p-3">
          <Label htmlFor="handover-reject-reason" className="text-xs font-bold">
            {t("proj_handover_reject_reason")}
          </Label>
          <Textarea
            id="handover-reject-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("proj_handover_reject_reason_placeholder")}
            disabled={busy}
            className="resize-none text-sm"
            autoFocus
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setRejecting(false); setReason("") }}>
              {t("proj_handover_cancel")}
            </Button>
            <Button size="sm" variant="destructive" className="gap-1.5" disabled={busy || reason.trim().length < 4} onClick={() => void respond("rejected")}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
              {t("proj_handover_reject_confirm")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
