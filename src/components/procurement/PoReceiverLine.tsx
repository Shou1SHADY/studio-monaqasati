"use client"

// «يستلمه …» on an order line (the prototype's line context). One receiver in every
// screen (PUR-06): once a notice has been forwarded it is the person it went to; until
// then it is the register's suggestion for the place the goods land — the project's own
// store, else the central store — marked as a suggestion, with the module whose desk
// records the receipt.

import { useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import { landingWarehouseId, suggestedReceiver } from "@/lib/procurement/receipt-desk"
import { forwardedReceiverOf } from "@/lib/procurement/receivers"

export function PoReceiverLine({
  organizationId,
  projectId,
  poId,
  notices = [],
}: {
  organizationId: string
  projectId: string | null | undefined
  poId?: string | null
  notices?: ReadonlyArray<{ poId?: string | null; status?: string; closedByReceipt?: unknown; forwardedTo?: unknown }>
}) {
  const t = useTranslations("Portal.ProcReceipts")
  const firestore = useFirestore()
  const { receivers } = useProcReceivers(organizationId)
  const projectRef = useMemoFirebase(() => (firestore && projectId ? doc(firestore, "projects", projectId) : null), [firestore, projectId])
  const { data: project } = useDoc<{ warehouseId?: string | null }>(projectRef)
  const place = landingWarehouseId(projectId, project && projectId ? [{ id: projectId, warehouseId: project.warehouseId ?? null }] : [], organizationId)
  const suggested = suggestedReceiver(receivers, place)
  const forwarded = forwardedReceiverOf(notices as Parameters<typeof forwardedReceiverOf>[0], poId)
  if (!forwarded && !suggested) return null
  const registered = forwarded ? receivers.find((r) => (forwarded.userId && r.userId === forwarded.userId) || r.name === forwarded.name) : suggested
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>
        {forwarded ? t("received_by") : t("received_by_suggested")} <b className="font-semibold text-foreground" dir="auto">{forwarded ? forwarded.name : suggested?.name}</b>
      </span>
      {registered && <SourceBadge module={registered.module === "projects" ? "project-management" : "warehouses"} label={t(`recordedBy.${registered.module}`)} />}
    </p>
  )
}
