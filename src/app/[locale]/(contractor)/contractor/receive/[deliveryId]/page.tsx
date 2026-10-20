"use client"

// «عدّ الشحنة» from a member's own tasks (PUR-06): the delivery forwarded to him opens
// on its receipt link — where he counts and confirms signed in, with no code.

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2, TriangleAlert } from "lucide-react"
import { useUser } from "@/firebase"
import { PortalLayout } from "@/components/layout/portal-layout"
import { EmptyState } from "@/components/module-ui/EmptyState"

export default function ForwardedReceiptPage() {
  const { deliveryId } = useParams<{ deliveryId: string }>()
  const t = useTranslations("Portal.ProcReceipts")
  const { user, isUserLoading } = useUser()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (isUserLoading || !user || !deliveryId) return
    void (async () => {
      const res = await fetch(`/api/receipt-links/mine?deliveryId=${encodeURIComponent(deliveryId)}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } })
      const body = (await res.json().catch(() => null)) as { data?: { token?: string } } | null
      if (res.ok && body?.data?.token) window.location.replace(`/receive/${body.data.token}`)
      else setFailed(true)
    })()
  }, [user, isUserLoading, deliveryId])
  return (
    <PortalLayout>
      {failed ? (
        <EmptyState icon={TriangleAlert} title={t("mine.notYours")} description={t("mine.notYoursHint")} />
      ) : (
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="animate-spin text-module" aria-label={t("mine.opening")} />
        </div>
      )}
    </PortalLayout>
  )
}
