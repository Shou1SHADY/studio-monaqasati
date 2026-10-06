"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { StageReasonDialog, type PendingStage } from "@/components/admin/StageReasonDialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { changeStage, type Actor } from "@/lib/admin-crm-writes"

/** Every stage change asks why (agreed with the sales team, 6 Oct 2026): the board's drag and «move to», and the record's stage field, all go through `ask`. */
export function useStageChange(actor: Actor) {
  const t = useTranslations("Portal.Admin.Crm")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [pending, setPending] = useState<PendingStage | null>(null)

  const ask = (id: string, name: string, from: string, to: string) => {
    if (from !== to) setPending({ id, name, from, to })
  }
  const confirm = async (reason: string) => {
    if (!pending || !firestore) return
    try {
      await changeStage(firestore, actor, pending.id, pending.from, pending.to, reason)
      toast({ title: t("stage_changed", { to: t(`stage_${pending.to}`) }) })
      setPending(null)
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }
  const dialog = <StageReasonDialog pending={pending} stageLabel={(s) => t(`stage_${s}`)} onCancel={() => setPending(null)} onConfirm={confirm} />
  return { ask, dialog }
}
