"use client"

import { useEffect } from "react"
import { useParams } from "next/navigation"
import { useRouter } from "@/i18n/routing"
import { doc, getDoc } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Loader2 } from "lucide-react"

// Flat tender/RFQ URL — just redirects to its own offers view, mirroring the project-scoped
// [tenderId]/page.tsx. Project-linked RFQs redirect into the nested route; standalone RFQs
// (no project) redirect to the flat offers route, which renders the view directly.
export default function LegacyRfqPage() {
  const params = useParams()
  const rfqId = params.id as string
  const router = useRouter()
  const firestore = useFirestore()

  useEffect(() => {
    if (!firestore || !rfqId) return
    ;(async () => {
      try {
        const snap = await getDoc(doc(firestore, "rfqs", rfqId))
        const projectId = snap.exists() ? (snap.data()?.projectId as string | undefined) : undefined
        if (projectId) {
          router.replace(`/contractor/projects/${projectId}/tenders/${rfqId}/offers`)
        } else if (snap.exists()) {
          router.replace(`/contractor/rfqs/${rfqId}/offers`)
        } else {
          router.replace("/contractor/rfqs")
        }
      } catch {
        router.replace("/contractor/rfqs")
      }
    })()
  }, [firestore, rfqId, router])

  return (
    <PortalLayout>
      <div className="flex items-center justify-center p-20">
        <Loader2 className="animate-spin text-muted-foreground" size={40} />
      </div>
    </PortalLayout>
  )
}
