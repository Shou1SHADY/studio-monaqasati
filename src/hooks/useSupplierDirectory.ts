"use client"

// The Suppliers tab's two lists, gathered once (PRD 3.0 §7.2): every supplier
// company on the platform — one entry per company, not per logged-in account —
// with its platform profile, its contractor reviews, and, for the ones that are
// ours, our connection and our record of it. The screens derive the rest.
//
// A supplier company can have several accounts (the owner and invited members);
// reviews and links written against any of them count for the company, and the
// owner's own document is the base because it is the one onboarding filled in.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useCompanyNamesForMembers } from "@/hooks/useActiveCompanyName"
import { useIdentityOverlays } from "@/hooks/useIdentityOverlays"
import { stripIdentityFields } from "@/lib/identity-fields"
import { SUPPLIER_RECORDS, isInternationalSupplier, starAverage, type SupplierRecord } from "@/lib/procurement/supplier-file"
import type { ProcOffer } from "@/hooks/useProcurementWorld"

export interface SupplierCertificate {
  id?: string
  name?: string
  issuer?: string
  expiryDate?: string
  documentUrl?: string
}

interface SupplierUserDoc {
  id: string
  organizationId?: string
  organizationRole?: string
  companyName?: string
  name?: string
  city?: string
  location?: string
  coverageCities?: string[]
  specializations?: string[]
  certificates?: SupplierCertificate[]
  projects?: unknown[]
  description?: string
  phone?: string
  email?: string
  createdAt?: unknown
  isVerified?: boolean
  taxNumber?: string | number
  legalDocuments?: { cr?: { expiryDate?: string } }
  [key: string]: unknown
}

interface ReviewDoc {
  id: string
  revieweeId?: string
  rating?: number
  comment?: string
  createdAt?: unknown
}

interface LinkDoc {
  id: string
  supplierOrgId?: string
  status?: string
  requestedBy?: string
}

export interface PlatformReview {
  id: string
  rating: number
  comment: string | null
  day: string | null
}

export interface PlatformSupplier {
  orgId: string
  memberIds: string[]
  name: string
  city: string | null
  coverageCities: string[]
  categories: string[]
  certificates: SupplierCertificate[]
  worksCount: number
  bio: string | null
  phone: string | null
  email: string | null
  international: boolean
  since: string | null
  platformVerified: boolean
  profileVat: string | null
  profileCrExpiry: string | null
  reviews: PlatformReview[]
  rating: { avg: number; n: number } | null
  isMine: boolean
  isFavorite: boolean
  isExplicitFavorite: boolean
  linkId: string | null
  linkRequestedBy: string | null
  record: SupplierRecord | null
}

const asDay = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v.slice(0, 10)
  if (typeof v === "number") return new Date(v).toISOString().slice(0, 10)
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString().slice(0, 10) : null
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : ""
  return s || null
}

const ACCEPTED = "مقبول"

export function useSupplierDirectory(orgId: string, favoriteIds: string[], offers: ProcOffer[]) {
  const firestore = useFirestore()

  const usersQ = useMemoFirebase(() => (firestore ? query(collection(firestore, "users"), where("role", "==", "Supplier")) : null), [firestore])
  const linksQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "contractorSupplierLinks"), where("contractorOrgId", "==", orgId)) : null), [firestore, orgId])
  const reviewsQ = useMemoFirebase(() => (firestore ? query(collection(firestore, "reviews"), where("revieweeRole", "==", "Supplier")) : null), [firestore])
  const recordsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, SUPPLIER_RECORDS), where("organizationId", "==", orgId)) : null), [firestore, orgId])

  const { data: userDocs, isLoading: usersLoading } = useCollection<Omit<SupplierUserDoc, "id">>(usersQ)
  const { data: linkDocs, isLoading: linksLoading } = useCollection<Omit<LinkDoc, "id">>(linksQ)
  const { data: reviewDocs } = useCollection<Omit<ReviewDoc, "id">>(reviewsQ)
  const { data: recordDocs } = useCollection<Omit<SupplierRecord, "id">>(recordsQ)

  const users = useMemo(() => (userDocs || []) as SupplierUserDoc[], [userDocs])
  const companyNames = useCompanyNamesForMembers(users)
  const overlays = useIdentityOverlays(users)

  const suppliers = useMemo<PlatformSupplier[]>(() => {
    const orgOf = new Map<string, string>()
    const byOrg = new Map<string, SupplierUserDoc[]>()
    for (const u of users) {
      const org = u.organizationId || u.id
      orgOf.set(u.id, org)
      byOrg.set(org, [...(byOrg.get(org) || []), u])
    }
    const reviewsByOrg = new Map<string, PlatformReview[]>()
    for (const r of (reviewDocs || []) as ReviewDoc[]) {
      if (!r.revieweeId) continue
      const org = orgOf.get(r.revieweeId) || r.revieweeId
      reviewsByOrg.set(org, [...(reviewsByOrg.get(org) || []), { id: r.id, rating: Number(r.rating) || 0, comment: str(r.comment), day: asDay(r.createdAt) }])
    }
    const activeLinks = new Map<string, LinkDoc>()
    for (const l of (linkDocs || []) as LinkDoc[]) if (l.status === "active" && l.supplierOrgId) activeLinks.set(l.supplierOrgId, l)
    const records = new Map<string, SupplierRecord>()
    for (const r of (recordDocs || []) as SupplierRecord[]) if (r.supplierOrgId) records.set(r.supplierOrgId, r)
    const implicitFav = new Set(offers.filter((o) => o.status === ACCEPTED).flatMap((o) => [o.supplierId, o.organizationId]).filter((x): x is string => Boolean(x)))
    const explicitFav = new Set(favoriteIds)

    return Array.from(byOrg.entries()).map(([org, members]) => {
      const raw = members.find((m) => !m.organizationRole || m.organizationRole === "owner") || members[0]
      const overlay = overlays.get(raw.id)
      const owner = (overlay ? { ...stripIdentityFields(raw), ...overlay } : raw) as SupplierUserDoc
      const pick = <K extends keyof SupplierUserDoc>(k: K): SupplierUserDoc[K] | undefined => owner[k] || members.find((m) => m[k])?.[k]
      const ids = [org, ...members.map((m) => m.id)]
      const link = ids.map((id) => activeLinks.get(id)).find(Boolean) || null
      const reviews = (reviewsByOrg.get(org) || []).sort((a, b) => (b.day || "").localeCompare(a.day || ""))
      const isExplicitFavorite = ids.some((id) => explicitFav.has(id))
      const isFavorite = isExplicitFavorite || ids.some((id) => implicitFav.has(id))
      const record = records.get(org) || null
      return {
        orgId: org,
        memberIds: members.map((m) => m.id),
        name: companyNames.get(owner.id) || str(owner.companyName) || str(owner.name) || org,
        city: str(pick("city")) || str(pick("location")),
        coverageCities: (pick("coverageCities") as string[] | undefined) || [],
        categories: (pick("specializations") as string[] | undefined) || [],
        certificates: (pick("certificates") as SupplierCertificate[] | undefined) || [],
        worksCount: ((pick("projects") as unknown[] | undefined) || []).length,
        bio: str(pick("description")),
        phone: str(pick("phone")),
        email: str(pick("email")),
        international: isInternationalSupplier({ phone: str(pick("phone")), record }),
        since: asDay(raw.createdAt),
        platformVerified: Boolean(owner.isVerified),
        profileVat: str(pick("taxNumber")),
        profileCrExpiry: asDay(owner.legalDocuments?.cr?.expiryDate),
        reviews,
        rating: starAverage(reviews.map((r) => r.rating)),
        isMine: Boolean(link) || isFavorite,
        isFavorite,
        isExplicitFavorite,
        linkId: link?.id || null,
        linkRequestedBy: link?.requestedBy || null,
        record,
      }
    })
  }, [users, reviewDocs, linkDocs, recordDocs, offers, favoriteIds, overlays, companyNames])

  return { suppliers, loading: usersLoading || linksLoading }
}
