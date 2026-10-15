"use client"

// The supplier layout's one decision: a company on the free journey gets the free frame and the live world around
// its pages; a company on the full portal gets its pages untouched (each brings its own PortalLayout). A free
// account that reaches a page of the full portal by its address is sent home.

import { useEffect, type ReactNode } from "react"
import { getAuth, signOut } from "firebase/auth"
import { useUser } from "@/firebase"
import { useRouter, usePathname } from "@/i18n/routing"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useSupplierPlan } from "@/hooks/useSupplierPlan"
import { freePathAllowed } from "@/lib/supplier-plan"
import { FreeFrame } from "./FreeFrame"
import { FreeOverlays } from "./FreeOverlays"
import { FreeWorldProvider } from "./FreeWorldProvider"
import { Splash } from "./PlanSwitch"

export function SupplierPlanFrame({ children }: { children: ReactNode }) {
  const { plan, loading } = useSupplierPlan()
  if (loading) return <Splash />
  if (plan === "full") return <>{children}</>
  return <FreeShell>{children}</FreeShell>
}

function FreeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useUser()
  const { profile } = useResolvedProfile(user?.uid)
  const allowed = freePathAllowed(pathname)

  useEffect(() => {
    if (!allowed) router.replace("/supplier")
  }, [allowed, router])

  // The same guards the portal frame keeps: verified e-mail for password sign-ins, and the second step when it is on.
  useEffect(() => {
    if (!user || !profile) return
    const isPassword = user.providerData.some((p) => p.providerId === "password")
    if (isPassword && !user.emailVerified) {
      router.push("/verify-email")
      return
    }
    const p = profile as { twoFactorEnabled?: boolean; phone?: string }
    if (p.twoFactorEnabled && p.phone && sessionStorage.getItem(`2fa_verified_${user.uid}`) !== "true") {
      void signOut(getAuth()).then(() => router.push("/login"))
    }
  }, [user, profile, router])

  if (!allowed) return <Splash />
  return (
    <FreeWorldProvider>
      <FreeOverlays>
        <FreeFrame>{children}</FreeFrame>
      </FreeOverlays>
    </FreeWorldProvider>
  )
}
