"use client"

// «يستلمه …» on an order line (the prototype's line context): who the receiver
// register names for the place the goods land — the project's own store, else
// the central store — and the module whose desk records the receipt.

import { useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import { landingWarehouseId, suggestedReceiver } from "@/lib/procurement/receipt-desk"

export function PoReceiverLine({ organizationId, projectId }: { organizationId: string; projectId: string | null | undefined }) {
  const t = useTranslations("Portal.ProcReceipts")
  const firestore = useFirestore()
  const { receivers } = useProcReceivers(organizationId)
  const projectRef = useMemoFirebase(() => (firestore && projectId ? doc(firestore, "projects", projectId) : null), [firestore, projectId])
  const { data: project } = useDoc<{ warehouseId?: string | null }>(projectRef)
  const place = landingWarehouseId(projectId, project && projectId ? [{ id: projectId, warehouseId: project.warehouseId ?? null }] : [], organizationId)
  const receiver = suggestedReceiver(receivers, place)
  if (!receiver) return null
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>
        {t("received_by")} <b className="font-semibold text-foreground" dir="auto">{receiver.name}</b>
      </span>
      <SourceBadge module={receiver.module === "projects" ? "project-management" : "warehouses"} label={t(`recordedBy.${receiver.module}`)} />
    </p>
  )
}
