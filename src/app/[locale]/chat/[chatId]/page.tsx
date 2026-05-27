"use client"

import { useEffect } from "react"
import { useParams } from "next/navigation"
import { useRouter } from "@/i18n/routing"
import { useFirestore, useUser, useDoc, useMemoFirebase } from "@/firebase"
import { doc } from "firebase/firestore"
import { Loader2 } from "lucide-react"

/**
 * Legacy /chat/[chatId] redirect shim.
 * Detects the user's role and redirects to the correct role-scoped route:
 *   Contractor → /contractor/chat/[chatId]
 *   Supplier   → /supplier/chat/[chatId]
 */
export default function ChatRedirectPage() {
  const params = useParams()
  const chatId = params.chatId as string
  const router = useRouter()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])

  const { data: profile, isLoading: profileLoading } = useDoc(userDocRef)

  useEffect(() => {
    if (isUserLoading || profileLoading) return
    if (!user) { router.replace("/login"); return }
    if (profile?.role === "Supplier") {
      router.replace(`/supplier/chat/${chatId}`)
    } else {
      // Contractor or Admin — default to contractor chat
      router.replace(`/contractor/chat/${chatId}`)
    }
  }, [user, isUserLoading, profile, profileLoading, chatId, router])

  return (
    <div className="flex items-center justify-center h-screen">
      <Loader2 className="animate-spin text-primary" size={36} />
    </div>
  )
}
