"use client"

// «وصلت بلا إشعار» from the receiver's own hands: the truck is at the gate and the supplier never notified. The member who
// receives it (deliveries.confirm) opens the order's receipt page here — the same blind count, the same confirmation that IS the
// signature. Nothing is stored until he confirms; Procurement has no door into this page.

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2, TriangleAlert } from "lucide-react"
import { useUser } from "@/firebase"
import { PortalLayout } from "@/components/layout/portal-layout"
import { EmptyState } from "@/components/module-ui/EmptyState"

export default function ArrivalReceiptPage() {
  const { poId } = useParams<{ poId: string }>()
  const t = useTranslations("Portal.ProcReceipts")
  const { user, isUserLoading } = useUser()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (isUserLoading || !user || !poId) return
    void (async () => {
      const res = await fetch("/api/receipt-links/arrival", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ poId }) })
      const body = (await res.json().catch(() => null)) as { data?: { token?: string } } | null
      if (res.ok && body?.data?.token) window.location.replace(`/receive/${body.data.token}`)
      else setFailed(true)
    })()
  }, [user, isUserLoading, poId])
  return (
    <PortalLayout>
      {failed ? (
        <EmptyState icon={TriangleAlert} title={t("arrival.failedTitle")} description={t("arrival.failedHint")} />
      ) : (
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="animate-spin text-module" aria-label={t("mine.opening")} />
        </div>
      )}
    </PortalLayout>
  )
}
