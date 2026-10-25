"use client"

import { useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { resolvePolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"

export function OwnerHoldsNote() {
  const t = useTranslations("Portal.Layout")
  const firestore = useFirestore()
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const { isOrgOwner } = usePermissions()
  const settingsRef = useMemoFirebase(() => (firestore && organizationId ? doc(firestore, PROCUREMENT_SETTINGS, organizationId) : null), [firestore, organizationId])
  const { data: settings } = useDoc(settingsRef)
  if (!isOrgOwner || resolvePolicies(settings as Parameters<typeof resolvePolicies>[0]).ownerStepsBack) return null
  return (
    <p className="px-2 pb-1.5 text-[11px] leading-relaxed text-muted-foreground" data-testid="owner-holds-note">
      {t("owner_holds_procurement")}
    </p>
  )
}
