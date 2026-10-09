"use client"

import { useMemo } from "react"
import { usePathname } from "next/navigation"
import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { COMPANY_MODULES, applyModuleSwitches, moduleOffFor, offSet, type ModulePortal, type OptionalModule } from "@/lib/company-modules"
import { CONTRACTOR_COMPONENTS, SUPPLIER_COMPONENTS, type PortalComponentDef } from "@/lib/portal-components"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"

/** What the signed-in company has switched off. A company nobody has switched anything for has everything on. */
export function useCompanyModules(portal: ModulePortal | null): { off: ReadonlySet<OptionalModule>; loading: boolean } {
  const firestore = useFirestore()
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const ref = useMemoFirebase(() => (firestore && organizationId && portal ? doc(firestore, COMPANY_MODULES, organizationId) : null), [firestore, organizationId, portal])
  const { data, isLoading } = useDoc(ref)
  const off = useMemo(() => offSet(data as { off?: unknown } | null, portal), [data, portal])
  return { off, loading: Boolean(portal) && (isLoading || (!ref && Boolean(user))) }
}

/** The portal's component registry as THIS company sees it (its switched-off modules left out). */
export function useModuleComponents(portal: ModulePortal | null): PortalComponentDef[] {
  const { off } = useCompanyModules(portal)
  return useMemo(() => (portal ? applyModuleSwitches(portal === "supplier" ? SUPPLIER_COMPONENTS : CONTRACTOR_COMPONENTS, off, portal) : []), [off, portal])
}

/**
 * What a screen outside the optional modules asks: "is this module on for my company?" and "may I link to this
 * address?". The portal comes from the address bar, so the same call works on both sides.
 */
export function useModules(): { on: (id: OptionalModule) => boolean; off: ReadonlySet<OptionalModule>; loading: boolean; linkable: (href: string | null | undefined) => boolean } {
  const pathname = usePathname() || ""
  const portal: ModulePortal | null = pathname.startsWith("/contractor") ? "contractor" : pathname.startsWith("/supplier") ? "supplier" : null
  const { off, loading } = useCompanyModules(portal)
  const all = portal === "supplier" ? SUPPLIER_COMPONENTS : CONTRACTOR_COMPONENTS
  return useMemo(
    () => ({
      on: (id: OptionalModule) => !off.has(id),
      off,
      loading,
      linkable: (href: string | null | undefined) => moduleOffFor(href, all, off, portal) === null,
    }),
    [off, loading, all, portal]
  )
}
