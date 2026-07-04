"use client"

import { useEffect } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useRouter } from "@/i18n/routing"
import { doc, getDoc } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Loader2 } from "lucide-react"

// Legacy flat tender-offers URL — resolves the tender's project and redirects into the
// new nested route. Kept so old links (notifications, bookmarks, AI suggestions) still work.
export default function LegacyRfqOffersPage() {
  const params = useParams()
  const rfqId = params.id as string
  const searchParams = useSearchParams()
  const tab = searchParams.get("tab")
  const router = useRouter()
  const firestore = useFirestore()

  useEffect(() => {
    if (!firestore || !rfqId) return
    ;(async () => {
      try {
        const snap = await getDoc(doc(firestore, "rfqs", rfqId))
        const projectId = snap.exists() ? (snap.data()?.projectId as string | undefined) : undefined
        if (projectId) {
          const suffix = tab ? `?tab=${tab}` : ""
          router.replace(`/contractor/projects/${projectId}/tenders/${rfqId}/offers${suffix}`)
          return
        }
      } catch {
        // fall through to the aggregate list below
      }
      router.replace("/contractor/rfqs")
    })()
  }, [firestore, rfqId, tab, router])

  return (
    <PortalLayout>
      <div className="flex items-center justify-center p-20">
        <Loader2 className="animate-spin text-muted-foreground" size={40} />
      </div>
    </PortalLayout>
  )
}
