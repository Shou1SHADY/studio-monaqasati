"use client"

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { companiesOfRole, type CompanyOrgDoc, type CompanyUserDoc, type ListedCompany } from "@/lib/admin-accounts"
import { freeCompanies, fullOrgIdsOf } from "@/lib/admin-free-suppliers"
import { COMPANY_PLANS } from "@/lib/supplier-plan"
import { useIdentityOverlays } from "@/hooks/useIdentityOverlays"

type Rec = Record<string, unknown>

/**
 * Every supplier COMPANY the admin can see, once, and which of them are on the full plan — four reads in all (the
 * accounts of the role, the owners whose primary company is a supplier's, the secondary companies, the plans), never one
 * per row. The free list and the subscribed list both start here, so a company is in exactly one of them.
 */
export function useSupplierCompanies() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const roleQuery = useMemoFirebase(() => (firestore && user && !isUserLoading ? query(collection(firestore, "users"), where("role", "==", "Supplier")) : null), [firestore, user, isUserLoading])
  const primaryQuery = useMemoFirebase(() => (firestore && user && !isUserLoading ? query(collection(firestore, "users"), where("primaryRole", "==", "Supplier")) : null), [firestore, user, isUserLoading])
  const orgsQuery = useMemoFirebase(() => (firestore && user && !isUserLoading ? query(collection(firestore, "organizations"), where("role", "==", "Supplier")) : null), [firestore, user, isUserLoading])
  const plansQuery = useMemoFirebase(() => (firestore && user && !isUserLoading ? collection(firestore, COMPANY_PLANS) : null), [firestore, user, isUserLoading])

  const { data: byRole, isLoading: roleLoading } = useCollection(roleQuery)
  const { data: byPrimary } = useCollection(primaryQuery)
  const { data: orgs } = useCollection(orgsQuery)
  const { data: plans } = useCollection(plansQuery)

  const accounts = useMemo(() => {
    const byId = new Map<string, CompanyUserDoc>()
    for (const u of [...((byRole || []) as CompanyUserDoc[]), ...((byPrimary || []) as CompanyUserDoc[])]) byId.set(u.id, u)
    return [...byId.values()]
  }, [byRole, byPrimary])
  const overlays = useIdentityOverlays(accounts as Array<{ id: string; organizationId?: string; organizationRole?: string }>)

  const companies = useMemo<ListedCompany[]>(
    () => companiesOfRole("Supplier", accounts, (orgs || []) as CompanyOrgDoc[], overlays),
    [accounts, orgs, overlays.size],
  )
  const usersById = useMemo(() => new Map(accounts.map((u) => [u.id, u as Rec])), [accounts])
  const fullOrgIds = useMemo(() => fullOrgIdsOf((plans || []) as Array<{ id: string; supplierPlan?: unknown }>), [plans])
  const free = useMemo(() => freeCompanies(companies, fullOrgIds), [companies, fullOrgIds])

  return { companies, freeCompanies: free, usersById, fullOrgIds, isLoading: roleLoading || byRole === null || plans === null }
}
