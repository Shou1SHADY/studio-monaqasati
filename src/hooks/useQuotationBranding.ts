"use client"

import { useMemo } from "react"
import { useLocale } from "next-intl"
import { useUser } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useCrmOrgProfile } from "@/hooks/useCrmOrgProfile"
import { displayCity } from "@/lib/constants"
import { brandingFromProfile } from "@/lib/quotation-document"

/**
 * The letterhead a quotation document starts from: the ACTIVE company's
 * identity (name, CR, VAT number, address, phone, website — resolved per
 * company, never the primary's when a secondary one is active) and the logo
 * the org last set for quotations (`crmOrgProfile/{orgId}.quotationLogoUrl`).
 */
export function useQuotationBrandingDefaults() {
  const locale = useLocale()
  const { user, isUserLoading } = useUser()
  const { profile, isLoading: isProfileLoading } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const { orgId, profile: crmProfile, isLoading: isCrmProfileLoading } = useCrmOrgProfile()

  const logoUrl = crmProfile?.quotationLogoUrl ?? null
  const email = user?.email ?? null
  const branding = useMemo(
    () =>
      brandingFromProfile(profile as Record<string, unknown> | null, {
        logoUrl,
        email,
        cityLabel: (city) => displayCity(city, locale),
      }),
    [profile, logoUrl, email, locale]
  )

  return {
    orgId,
    branding,
    isLoading: isUserLoading || !user || isProfileLoading || isCrmProfileLoading,
  }
}
