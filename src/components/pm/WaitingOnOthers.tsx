"use client"

// What a project waits on from other modules (the PM 1.0 prototype's "waiting
// on others"): the open purchase orders placed for it, soonest promise first.
// No button — the act is Procurement's; the state reaches us here. Given one
// project it reads that project's orders; given several (the portfolio Today)
// it reads the org's and names the project on each row.

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { ArrowLeftRight } from "lucide-react"
import { Panel } from "@/components/module-ui/Panel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { pmDate, todayDay } from "@/lib/pm/format"
import { displayPoNumber } from "@/lib/procurement/format"
import { poStatus } from "@/lib/procurement/po"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"

const CLIP = 8

export function WaitingOnOthers({ organizationId, projects }: { organizationId: string; projects: Array<{ id: string; name?: string }> }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const single = projects.length === 1 ? projects[0].id : null
  const poQ = useMemoFirebase(
    () =>
      firestore && organizationId
        ? single
          ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", organizationId), where("projectId", "==", single))
          : query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", organizationId))
        : null,
    [firestore, organizationId, single]
  )
  const { data } = useCollection(poQ)
  const nameOf = useMemo(() => new Map(projects.map((p) => [p.id, p.name || ""])), [projects])
  const waiting = useMemo(
    () =>
      ((data ?? []) as unknown as PurchaseOrder[])
        .filter((po) => po.projectId && nameOf.has(po.projectId))
        .map((po) => ({ ...po, lines: po.lines || [], log: po.log || [] }))
        .filter((po) => !["received", "closed", "cancelled"].includes(poStatus(po)))
        .sort((a, b) => String(a.promisedDate ?? "9999").localeCompare(String(b.promisedDate ?? "9999"))),
    [data, nameOf]
  )
  const today = todayDay()

  return (
    <Panel title={t("pulse.waiting_title")} icon={ArrowLeftRight} count={waiting.length || undefined} bodyClassName="p-0">
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("pulse.waiting_desc")}</p>
      {waiting.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("pulse.waiting_none")}</p>
      ) : (
        <ul className="divide-y">
          {waiting.slice(0, CLIP).map((po) => {
            const late = po.promisedDate && po.promisedDate.slice(0, 10) < today
            return (
              <li key={po.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold">
                    <span className="me-2 rounded bg-teal/10 px-1.5 py-0.5 text-[11px] font-semibold text-teal">{t("pulse.from_procurement")}</span>
                    <span dir="ltr">{displayPoNumber(po.docNumber, locale)}</span> — <span dir="auto">{po.supplierName}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
                    {[single ? null : nameOf.get(po.projectId || ""), ...po.lines.slice(0, 2).map((l) => `${l.name} ${l.quantity} ${l.unit}`)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {po.promisedDate && (
                  <span className={late ? "rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive" : "rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"}>
                    {pmDate(po.promisedDate, locale)}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {waiting.length > CLIP && <p className="border-t px-4 py-2.5 text-center text-xs font-semibold text-cta">{t("pulse.waiting_more", { count: waiting.length - CLIP })}</p>}
    </Panel>
  )
}
