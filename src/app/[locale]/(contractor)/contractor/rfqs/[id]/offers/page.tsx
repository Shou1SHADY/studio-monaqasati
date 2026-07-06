"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useRouter } from "@/i18n/routing"
import { doc, getDoc } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Loader2 } from "lucide-react"
import { RfqOffersView } from "@/components/contractor/RfqOffersView"

// Flat RFQ-offers URL. Project-linked RFQs redirect into the canonical nested route (kept so
// old links — notifications, bookmarks, AI suggestions — still work). Standalone RFQs (no
// project) have no nested route to redirect to, so this page renders the offers view directly.
export default function RfqOffersEntryPage() {
  const params = useParams()
  const rfqId = params.id as string
  const searchParams = useSearchParams()
  const tab = searchParams.get("tab")
  const router = useRouter()
  const firestore = useFirestore()
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    if (!firestore || !rfqId) return
    ;(async () => {
      try {
        const snap = await getDoc(doc(firestore, "rfqs", rfqId))
        const projectId = snap.exists() ? (snap.data()?.projectId as string | undefined) : undefined
        if (projectId) {
          const suffix = tab ? `?tab=${tab}` : ""
          router.replace(`/contractor/projects/${projectId}/tenders/${rfqId}/offers${suffix}`)
        } else if (snap.exists()) {
          // Confirmed: this RFQ genuinely has no project — render the offers view inline.
          setIsStandalone(true)
        } else {
          router.replace("/contractor/rfqs")
        }
      } catch {
        router.replace("/contractor/rfqs")
      }
    })()
  }, [firestore, rfqId, tab, router])

  if (isStandalone) {
    return <RfqOffersView rfqId={rfqId} />
  }

  return (
    <PortalLayout>
      <div className="flex items-center justify-center p-20">
        <Loader2 className="animate-spin text-muted-foreground" size={40} />
      </div>
    </PortalLayout>
  )
}
