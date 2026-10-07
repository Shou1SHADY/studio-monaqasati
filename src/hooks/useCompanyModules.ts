"use client"

import { useMemo } from "react"
import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { COMPANY_MODULES, applyModuleSwitches, offSet, type ModulePortal, type OptionalModule } from "@/lib/company-modules"
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
