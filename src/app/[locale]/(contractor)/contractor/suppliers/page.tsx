"use client"

import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Search,
  MapPin,
  Star,
  ShieldCheck,
  Filter,
  ChevronLeft,
  Briefcase,
  Loader2,
  X,
  Heart,
  FolderOpen,
  Mail,
  Send,
  XCircle,
  Calendar,
  UserPlus,
} from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, query, where, doc, addDoc, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from "firebase/firestore"
import { useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCompanyNamesForMembers } from "@/hooks/useActiveCompanyName"
import { displayCategory, displayCity } from "@/lib/constants"

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}
 
export default function SuppliersDirectory() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()

  const { user, isUserLoading } = useUser()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterCity, setFilterCity] = useState<string>("all")
  const [filterSpecialization, setFilterSpecialization] = useState<string>("all")
  const [showFilters, setShowFilters] = useState(false)
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteCompanyName, setInviteCompanyName] = useState("")
  const [isSendingInvite, setIsSendingInvite] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; supplierName?: string } | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user!.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const { can } = usePermissions()
  const canManageSuppliers = can("suppliers.manage")

  const suppliersQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return query(collection(firestore, "users"), where("role", "==", "Supplier"))
  }, [firestore])

  const { data: fbSuppliers, isLoading: suppliersLoading } = useCollection(suppliersQuery)
  const supplierCompanyNames = useCompanyNamesForMembers((fbSuppliers || []) as any[])

  // Fetch contractor's RFQs
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), where("organizationId", "==", profile?.organizationId || user!.uid))
  }, [firestore, user, isUserLoading, profile?.organizationId])
  
  const { data: myRfqs } = useCollection(rfqsQuery)
  const myRfqIds = myRfqs?.map((r: any) => r.id) || []

  // Suppliers this contractor has an active connection with (invited/accepted via My Suppliers)
  const myOrgId = profile?.organizationId || user?.uid
  const linksQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !myOrgId) return null
    return query(
      collection(firestore, "contractorSupplierLinks"),
      where("contractorOrgId", "==", myOrgId)
    )
  }, [firestore, user, isUserLoading, myOrgId])
  const { data: supplierLinks, isLoading: linksLoading } = useCollection(linksQuery)
  const connectedSupplierOrgIds = (supplierLinks || [])
    .filter((l: any) => l.status === "active")
    .map((l: any) => l.supplierOrgId)
    .filter(Boolean)

  // Invitations this contractor has sent (to track pending/accepted/declined status)
  const invitationsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "invitations"), where("invitedBy", "==", user.uid))
  }, [firestore, user, isUserLoading])
  const { data: allInvitations } = useCollection(invitationsQuery)
  const sentInvitations = (allInvitations || []).filter(
    (inv: any) => inv.type === "supplier_invite"
  )

  const handleSendInvitation = async () => {
    if (!user || !myOrgId) return
    const email = inviteEmail.trim().toLowerCase()
    if (!email) {
      toast({ title: t("my_sup_invite_empty_email"), variant: "destructive" })
      return
    }
    setIsSendingInvite(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/invitations/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email, companyName: inviteCompanyName.trim() || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to send invitation")
      }
      toast({
        title: t("my_sup_invite_success"),
        description: data.data?.emailSent
          ? t("my_sup_invite_email_sent_desc")
          : t("my_sup_invite_email_skipped_desc"),
      })
      setInviteEmail("")
      setInviteCompanyName("")
      setShowInviteDialog(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("my_sup_invite_error"), variant: "destructive" })
    } finally {
      setIsSendingInvite(false)
    }
  }

  const handleRemoveConnection = async (linkId: string) => {
    if (!firestore) return
    setIsRemoving(true)
    try {
      await updateDoc(doc(firestore, "contractorSupplierLinks", linkId), { status: "rejected" })
      toast({ title: t("my_sup_toast_removed") })
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    } finally {
      setIsRemoving(false)
      setRemoveTarget(null)
    }
  }

  // Fetch accepted offers for these RFQs
  const acceptedOffersQuery = useMemoFirebase(() => {
    if (!firestore || myRfqIds.length === 0) return null
    // We fetch all offers for these RFQs and filter locally to avoid complex composite indexes
    return query(
      collection(firestore, "offers"),
      where("rfqId", "in", myRfqIds.slice(0, 30)) // Firestore 'in' is limited to 30 elements
    )
  }, [firestore, myRfqIds.join(",")])
  
  const { data: offersData } = useCollection(acceptedOffersQuery)
  
  // Fetch supplier reviews when a supplier is selected (for detail modal)
  const supplierReviewsQuery = useMemoFirebase(() => {
    if (!firestore || !selectedSupplier) return null
    return query(
      collection(firestore, "reviews"),
      where("revieweeId", "==", selectedSupplier.id)
    )
  }, [firestore, selectedSupplier])
  const { data: supplierReviews } = useCollection(supplierReviewsQuery)

  // Fetch ALL supplier reviews to compute live averages for the cards
  const allSupplierReviewsQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return query(
      collection(firestore, "reviews"),
      where("revieweeRole", "==", "Supplier")
    )
  }, [firestore])
  const { data: allSupplierReviews } = useCollection(allSupplierReviewsQuery)

  // A supplier "company" can have several logged-in accounts (the owner + invited
  // team members). Reviews and directory listings both used to key off the
  // individual account that happened to submit/fulfil an offer, so a company's
  // reputation and presence in the directory were split across its team instead
  // of being one entry. canonicalOrgIdByUserId maps every individual account to
  // its company's canonical id (the owner's own uid) so both can be aggregated.
  const canonicalOrgIdByUserId = new Map<string, string>()
  ;(fbSuppliers || []).forEach((s: any) => {
    canonicalOrgIdByUserId.set(s.id, s.organizationId || s.id)
  })
  const suppliersByOrg = new Map<string, any[]>()
  ;(fbSuppliers || []).forEach((s: any) => {
    const orgId = s.organizationId || s.id
    if (!suppliersByOrg.has(orgId)) suppliersByOrg.set(orgId, [])
    suppliersByOrg.get(orgId)!.push(s)
  })

  // Ratings aggregated by canonical org id — this also correctly combines reviews
  // written before this fix (against an individual team member) with ones written
  // after it (against the company), since both resolve through the same map.
  const supplierRatingsMap = (allSupplierReviews || []).reduce((acc: Record<string, { sum: number; count: number }>, r: any) => {
    if (!r.revieweeId) return acc
    const orgId = canonicalOrgIdByUserId.get(r.revieweeId) || r.revieweeId
    if (!acc[orgId]) acc[orgId] = { sum: 0, count: 0 }
    acc[orgId].sum += r.rating || 0
    acc[orgId].count += 1
    return acc
  }, {})

  // Compute set of supplier IDs that have an accepted offer
  const implicitFavoriteIds = offersData
    ?.filter((o: any) => o.status === "مقبول")
    .map((o: any) => o.supplierId) || []
  const explicitFavoriteIds = profile?.favoriteSuppliers || []
  const favoriteSupplierIds = new Set([...implicitFavoriteIds, ...explicitFavoriteIds])

  const toggleFavorite = async (e: React.MouseEvent, supplier: any) => {
    e.stopPropagation();
    if (!userDocRef || !profile || !myOrgId) return;
    const supplierId = supplier.id
    const isExplicit = explicitFavoriteIds.includes(supplierId);
    try {
      // Marking a not-yet-connected supplier as favorite auto-connects them immediately
      // (skips the invite-and-wait flow) — favoriting is treated as "I already work with them."
      const isConnected = connectedSupplierOrgIds.includes(supplier.id) || connectedSupplierOrgIds.includes(supplier.organizationId)
      if (!isExplicit && !isConnected && firestore) {
        await addDoc(collection(firestore, "contractorSupplierLinks"), {
          contractorOrgId: myOrgId,
          supplierOrgId: supplier.organizationId || supplier.id,
          supplierName: supplier.name || supplier.companyName || "",
          supplierCategories: supplier.specializations || [],
          status: "active",
          requestedBy: "contractor_favorite",
          requestedAt: serverTimestamp(),
          connectedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
      await updateDoc(userDocRef!, {
        favoriteSuppliers: isExplicit ? arrayRemove(supplierId) : arrayUnion(supplierId)
      });
      toast({
        title: isExplicit ? t("suppliers_fav_removed") : t("suppliers_fav_added"),
        description: isExplicit ? t("suppliers_fav_removed_desc") : (!isConnected ? t("suppliers_fav_added_connected_desc") : t("suppliers_fav_added_desc")),
      });
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
      toast({
        title: t("offers_toast_error"),
        description: t("suppliers_fav_error"),
        variant: "destructive"
      });
    }
  }
  
  const isLoading = suppliersLoading || isUserLoading || linksLoading;

  // Only show suppliers this contractor has actually invited and connected with — matches the
  // active contractorSupplierLinks docs (the only way a link is ever created is a supplier
  // accepting this contractor's email invitation, so "active link" already means "invited by us").
  const knownSupplierIds = new Set(connectedSupplierOrgIds)
  const linkIdBySupplierOrgId = new Map(
    (supplierLinks || [])
      .filter((l: any) => l.status === "active")
      .map((l: any) => [l.supplierOrgId, l.id])
  )

  const allCities = [...new Set([
    ...((fbSuppliers || []).map((s: any) => s.city).filter(Boolean) || []),
    ...((fbSuppliers || []).flatMap((s: any) => s.coverageCities || []).filter(Boolean) || [])
  ])].sort()

  const allSpecializations = [...new Set(
    (fbSuppliers || []).flatMap((s: any) => s.specializations || []).filter(Boolean) || []
  )].sort()

  // One card per company, not per logged-in account. Pick the org owner's own
  // doc as the base (it's the account that goes through onboarding, so its
  // fields are the most likely to be filled in); fall back to the first team
  // member with a non-empty value for any field the owner left blank.
  const displaySuppliers = (fbSuppliers || []).length > 0 ? Array.from(suppliersByOrg.entries())
    .map(([orgId, members]) => {
      const owner = members.find((m) => !m.organizationRole || m.organizationRole === "owner") || members[0]
      const memberIds = members.map((m) => m.id)
      const pick = (field: string) => owner[field] || members.find((m) => m[field])?.[field]
      const ratings = supplierRatingsMap[orgId]
      return {
        ...owner,
        id: orgId,
        name: supplierCompanyNames.get(owner.id) || owner.companyName || owner.name || t("suppliers_registered_supplier"),
        city: pick("city") || pick("location") || t("suppliers_not_set"),
        coverageCities: pick("coverageCities") || [],
        specializations: pick("specializations") || [],
        certificates: pick("certificates") || [],
        rating: ratings ? parseFloat((ratings.sum / ratings.count).toFixed(1)) : (owner.rating || 0),
        reviewsCount: ratings?.count ?? (owner.reviewsCount || 0),
        isFavorite: memberIds.some((id) => favoriteSupplierIds.has(id)) || favoriteSupplierIds.has(orgId),
        isExplicitFavorite: memberIds.some((id) => explicitFavoriteIds.includes(id)) || explicitFavoriteIds.includes(orgId),
        isConnected: knownSupplierIds.has(orgId) || memberIds.some((id) => knownSupplierIds.has(id)),
        linkId: linkIdBySupplierOrgId.get(orgId) || memberIds.map((id) => linkIdBySupplierOrgId.get(id)).find(Boolean),
      }
    })
    .filter((s: any) => {
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = s.name?.toLowerCase().includes(q);
        const cityMatch = s.city?.toLowerCase().includes(q);
        const specMatch = s.specializations?.some((spec: string) => spec.toLowerCase().includes(q));
        if (!nameMatch && !cityMatch && !specMatch) return false;
      }
      // City filter
      if (filterCity !== "all") {
        const cityMatch = s.city === filterCity || s.coverageCities?.includes(filterCity);
        if (!cityMatch) return false;
      }
      // Specialization filter
      if (filterSpecialization !== "all") {
        const specMatch = s.specializations?.includes(filterSpecialization);
        if (!specMatch) return false;
      }
      return true;
    }) : []

  const hasActiveFilters = filterCity !== "all" || filterSpecialization !== "all"
  const clearFilters = () => {
    setFilterCity("all")
    setFilterSpecialization("all")
  }

  const preferredSuppliers = displaySuppliers.filter((s: any) => s.isFavorite)
  const otherSuppliers = displaySuppliers.filter((s: any) => !s.isFavorite)

  return (
    <PortalLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("suppliers_page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("suppliers_page_desc")}</p>
          </div>
          <div className="flex gap-2">
            {canManageSuppliers && <Button variant="outline" className="gap-2" onClick={() => setShowInviteDialog(true)}>
              <UserPlus size={18} />
              {t("my_sup_invite_tab")}
              {sentInvitations.filter((inv: any) => inv.status === "pending").length > 0 && (
                <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 h-4 min-w-4">
                  {sentInvitations.filter((inv: any) => inv.status === "pending").length}
                </Badge>
              )}
            </Button>}
            <div className="relative w-64">
              <Search className={cn("absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground", locale === 'ar' ? 'right-3' : 'left-3')} />
              <Input 
                placeholder={t("suppliers_search")} 
                className={cn("pl-8", locale === 'ar' ? 'pr-10' : 'pl-10 pr-8')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className={cn("absolute top-1/2 -translate-y-1/2 text-slate-400 hover:text-destructive transition-colors", locale === 'ar' ? 'left-2' : 'right-2')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <Popover open={showFilters} onOpenChange={setShowFilters}>
              <PopoverTrigger asChild>
                <Button variant={hasActiveFilters ? "default" : "outline"} className="gap-2 relative">
                  <Filter size={18} />
                  {t("suppliers_filter")}
                  {hasActiveFilters && (
                    <span className={cn("absolute -top-1 h-4 w-4 bg-primary text-white text-[10px] rounded-full flex items-center justify-center", locale === 'ar' ? '-right-1' : '-left-1')}>
                      {(filterCity !== "all" ? 1 : 0) + (filterSpecialization !== "all" ? 1 : 0)}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm">{t("suppliers_filter_title")}</h4>
                    {hasActiveFilters && (
                      <button 
                        onClick={() => { clearFilters(); setShowFilters(false) }}
                        className="text-xs text-destructive hover:underline font-medium"
                      >
                        {t("suppliers_clear_all")}
                      </button>
                    )}
                  </div>
                  
                  {/* City Filter */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">{t("suppliers_filter_city")}</label>
                    <Select value={filterCity} onValueChange={setFilterCity}>
                      <SelectTrigger className="w-full h-9 text-sm">
                        <SelectValue placeholder={t("suppliers_all_cities")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 overflow-y-auto">
                        <SelectItem value="all">{t("suppliers_all_cities")}</SelectItem>
                        {allCities.map((city: string) => (
                          <SelectItem key={city} value={city}>{displayCity(city, locale)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Specialization Filter */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">{t("suppliers_filter_spec")}</label>
                    <Select value={filterSpecialization} onValueChange={setFilterSpecialization}>
                      <SelectTrigger className="w-full h-9 text-sm">
                        <SelectValue placeholder={t("suppliers_all_specs")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 overflow-y-auto">
                        <SelectItem value="all">{t("suppliers_all_specs")}</SelectItem>
                        {allSpecializations.map((spec: string) => (
                          <SelectItem key={spec} value={spec}>{displayCategory(spec, locale)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => setShowFilters(false)}
                  >
                    {t("suppliers_apply_filters")}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-20 text-muted-foreground">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p>{t("suppliers_loading")}</p>
          </div>
        ) : displaySuppliers.length === 0 ? (
          <div className="text-center p-20 bg-slate-50 rounded-xl border border-dashed text-muted-foreground">
            {searchQuery ? (
              <>
                <Search size={48} className="mx-auto mb-4 opacity-20" />
                <p className="font-bold text-lg">{t("suppliers_no_search_results")}</p>
                <p className="text-sm mt-1">{t("suppliers_no_search_results_desc")}</p>
              </>
            ) : (
              <>
                <Briefcase size={48} className="mx-auto mb-4 opacity-20" />
                <p className="font-bold text-lg">{t("suppliers_no_suppliers")}</p>
                <p className="text-sm mt-1">{t("suppliers_no_suppliers_desc")}</p>
                {canManageSuppliers && <Button variant="outline" className="mt-4 gap-2" onClick={() => setShowInviteDialog(true)}>
                  <UserPlus size={16} />
                  {t("my_sup_invite_tab")}
                </Button>}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-0">
            {preferredSuppliers.length > 0 && (
              <div className="flex items-center gap-3 mb-4">
                <Star size={20} className="text-amber-500 fill-amber-500 shrink-0" />
                <div>
                  <h2 className="text-lg font-bold leading-tight">{t("suppliers_preferred_section")}</h2>
                  <p className="text-xs text-muted-foreground">{t("suppliers_preferred_section_desc")}</p>
                </div>
              </div>
            )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[...preferredSuppliers, ...(preferredSuppliers.length > 0 && otherSuppliers.length > 0 ? [{ id: "__divider__", isDivider: true }] : []), ...otherSuppliers].map((supplier: any) =>
              supplier.isDivider ? (
                <div key="__divider__" className="col-span-full flex items-center gap-3 py-4 text-sm font-semibold text-muted-foreground">
                  <div className="flex-1 border-t" />
                  <span>{t("suppliers_all_section")}</span>
                  <div className="flex-1 border-t" />
                </div>
              ) : (
              <Card key={supplier.id} className={`hover:shadow-md transition-shadow overflow-hidden group flex flex-col ${supplier.isFavorite ? 'border-amber-200 bg-amber-50/10' : 'border-slate-100'}`}>
                <CardContent className="p-6 flex-1 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                      <Briefcase size={28} />
                    </div>
                    <div className={cn("flex flex-col gap-1", locale === 'ar' ? 'items-end' : 'items-start')}>
                      <div className="flex items-center gap-1.5">
                        {supplier.linkId && canManageSuppliers && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setRemoveTarget({ id: supplier.linkId, supplierName: supplier.name })
                            }}
                            className="h-8 w-8 rounded-full flex items-center justify-center transition-all shadow-sm bg-white text-slate-300 hover:text-destructive hover:bg-destructive/5 border border-slate-100"
                            title={t("my_sup_remove")}
                          >
                            <XCircle size={16} />
                          </button>
                        )}
                        <button
                          onClick={(e) => toggleFavorite(e, supplier)}
                          className={`h-8 w-8 rounded-full flex items-center justify-center transition-all shadow-sm ${supplier.isExplicitFavorite ? 'bg-amber-100 text-amber-500' : 'bg-white text-slate-300 hover:text-amber-400 hover:bg-amber-50'} border border-slate-100`}
                          title={supplier.isExplicitFavorite ? t("suppliers_remove_fav") : t("suppliers_add_fav")}
                        >
                          <Heart size={16} className={supplier.isExplicitFavorite ? "fill-amber-500" : ""} />
                        </button>
                      </div>

                      {supplier.certificates?.length > 0 && (
                        <Badge className="bg-blue-50 text-blue-600 border-none px-2 py-0.5 h-6">
                          <ShieldCheck size={14} className={locale === 'ar' ? 'ml-1' : 'mr-1'} />
                          {t("suppliers_cert_count", { count: supplier.certificates.length })}
                        </Badge>
                      )}
                      {supplier.isFavorite && (
                        <Badge variant="outline" className="border-amber-200 text-amber-600 bg-amber-50 px-2 py-0.5 h-6">
                          <Star size={10} className={cn("fill-amber-500", locale === 'ar' ? 'ml-1' : 'mr-1')} />
                          {t("suppliers_fav_badge")}
                        </Badge>
                      )}
                      {!supplier.isConnected && (
                        <Badge variant="outline" className="border-slate-200 text-slate-500 bg-slate-50 px-2 py-0.5 h-6">
                          {t("suppliers_not_connected_badge")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-1">
                    <h3 className="font-bold text-lg text-slate-800">{supplier.name}</h3>
                    <div className="flex items-center gap-1 mt-1">
                      {supplier.rating > 0 ? (
                        <>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              size={13}
                              className={star <= Math.round(supplier.rating) ? "fill-amber-400 text-amber-400" : "text-slate-200 fill-slate-200"}
                            />
                          ))}
                          <span className={cn("text-sm font-bold text-slate-700", locale === 'ar' ? 'mr-1' : 'ml-1')}>{supplier.rating}</span>
                          <span className="text-[10px] text-muted-foreground">{t("suppliers_review_count", { count: supplier.reviewsCount || 0 })}</span>
                        </>
                      ) : (
                        <>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star key={star} size={13} className="text-slate-200 fill-slate-200" />
                          ))}
                          <span className={cn("text-[10px] text-muted-foreground", locale === 'ar' ? 'mr-1' : 'ml-1')}>{t("suppliers_no_reviews")}</span>
                        </>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 mt-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin size={14} className="text-primary" />
                        <span className="font-medium">{displayCity(supplier.city, locale)}</span>
                        <span className="text-[10px] bg-slate-100 px-1.5 rounded-sm">{t("suppliers_hq")}</span>
                      </div>
                      {supplier.coverageCities?.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <MapPin size={12} className="text-accent" />
                          <div className="flex flex-wrap gap-1">
                            {supplier.coverageCities.slice(0, 2).map((city: string) => (
                              <span key={city} className="bg-accent/10 text-accent px-1.5 py-0.5 rounded text-[10px]">{displayCity(city, locale)}</span>
                            ))}
                            {supplier.coverageCities.length > 2 && (
                              <span className="text-accent">+{supplier.coverageCities.length - 2}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Certificates badges */}
                  {supplier.certificates?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {supplier.certificates.slice(0, 3).map((cert: any) => (
                        <Badge key={cert.id} className="bg-green-50 text-green-700 border-green-100 text-[10px] px-2 font-normal gap-1">
                          <ShieldCheck size={10} />
                          {cert.name}
                        </Badge>
                      ))}
                      {supplier.certificates.length > 3 && (
                        <Badge variant="outline" className="text-[10px] px-2 text-slate-500">
                          +{supplier.certificates.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Specializations */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {supplier.specializations?.length > 0 ? (
                      supplier.specializations.slice(0, 3).map((spec: string) => (
                        <Badge key={spec} variant="secondary" className="text-[10px] bg-slate-100 text-slate-600 px-2 font-normal">
                          {displayCategory(spec, locale)}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">{t("suppliers_no_specs")}</span>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="p-0 border-t">
                  <Button 
                    variant="ghost" 
                    className="w-full h-12 rounded-none hover:bg-primary hover:text-white transition-colors gap-2"
                    onClick={() => setSelectedSupplier(supplier)}
                  >
                    {t("suppliers_view_profile")}
                    {locale === 'ar' ? <ChevronLeft size={16} /> : <ChevronLeft size={16} className="rotate-180" />}
                  </Button>
                </CardFooter>
              </Card>
              )
            )}
          </div>
          </div>
        )}
      </div>

      <Dialog open={!!selectedSupplier} onOpenChange={(open) => !open && setSelectedSupplier(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Briefcase className="text-primary" />
              {t("suppliers_dialog_title", { name: selectedSupplier?.name || "" })}
            </DialogTitle>
            <DialogDescription>
              {t("suppliers_dialog_desc")}
            </DialogDescription>
          </DialogHeader>
          
          {selectedSupplier && (
            <div className="space-y-6 py-4">
              <div className="flex flex-col gap-2">
                <h4 className="font-bold text-slate-800">{t("suppliers_coverage")}</h4>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-accent text-white flex items-center gap-1.5 px-3 py-1">
                    <MapPin size={14} />
                    {t("suppliers_hq")}: {displayCity(selectedSupplier.city, locale)}
                  </Badge>
                  {selectedSupplier.coverageCities?.map((city: string) => (
                    <Badge key={city} variant="outline" className="border-accent/30 text-accent bg-accent/5 flex items-center gap-1.5 px-3 py-1">
                      <MapPin size={14} />
                      {displayCity(city, locale)}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="font-bold text-slate-800">{t("suppliers_specs")}</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedSupplier.specializations?.length ? selectedSupplier.specializations.map((spec: string) => (
                    <Badge key={spec} className="bg-primary/10 text-primary border-none">{spec}</Badge>
                  )) : (
                    <span className="text-sm text-slate-500">{t("suppliers_no_specs_registered")}</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="font-bold text-slate-800">{t("suppliers_about")}</h4>
                <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                  {selectedSupplier.description || t("suppliers_no_description")}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="font-bold text-slate-800 flex items-center gap-2">
                  <FolderOpen size={18} className="text-primary" />
                  {t("suppliers_projects")}
                </h4>
                {selectedSupplier.projects?.length > 0 ? (
                  <div className="grid gap-3">
                    {selectedSupplier.projects.map((project: any) => (
                      <div key={project.id} className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                        <p className="font-bold text-sm text-slate-800">{project.name}</p>
                        {project.description && (
                          <p className="text-xs text-slate-600 mt-1 leading-relaxed">{project.description}</p>
                        )}
                        {project.images?.length > 0 && (
                          <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                            {project.images.map((img: string, idx: number) => (
                              <img
                                key={idx}
                                src={img}
                                alt={`${project.name} ${idx + 1}`}
                                className="h-20 w-28 object-cover rounded-lg border border-slate-200 shrink-0 hover:scale-105 transition-transform cursor-pointer"
                                onClick={() => window.open(img, '_blank')}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 p-4 border border-dashed rounded-lg text-center bg-slate-50">
                    {t("suppliers_no_projects")}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="font-bold text-slate-800 flex items-center gap-2">
                  <ShieldCheck size={18} className="text-success" />
                  {t("suppliers_certificates")}
                </h4>
                {selectedSupplier.certificates?.length > 0 ? (
                  <div className="grid gap-3">
                    {selectedSupplier.certificates.map((cert: any) => (
                      <div key={cert.id} className="p-3 bg-white border border-slate-200 rounded-lg flex items-start justify-between shadow-sm">
                        <div>
                          <p className="font-bold text-sm text-slate-800">{cert.name}</p>
                          <p className="text-xs text-slate-500 mt-1">{t("suppliers_cert_issuer")}: {cert.issuer}</p>
                          {(cert.issueDate || cert.expiryDate) && (
                            <p className="text-[10px] text-slate-400 mt-1">
                              {t("suppliers_cert_valid_until")}: {cert.expiryDate || t("suppliers_unknown")}
                            </p>
                          )}
                        </div>
                        {cert.documentUrl && (
                          <a 
                            href={cert.documentUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-full font-medium transition-colors"
                          >
                            {t("suppliers_view_doc")}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 p-4 border border-dashed rounded-lg text-center bg-slate-50">
                    {t("suppliers_no_certificates")}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="font-bold text-slate-800 flex items-center gap-2">
                  <Star size={18} className="text-amber-400 fill-amber-400" />
                  {t("suppliers_reviews_title", { count: supplierReviews?.length || 0 })}
                </h4>
                {(supplierReviews?.length ?? 0) > 0 ? (
                  <div className="grid gap-3">
                    {supplierReviews!.map((review: any) => (
                      <div key={review.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-sm text-slate-800">{t("suppliers_anonymous_reviewer")}</p>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-amber-600">{review.rating}</span>
                            <Star size={12} className="fill-amber-400 text-amber-400" />
                          </div>
                        </div>
                        {review.comment && (
                          <p className="text-xs text-slate-600 leading-relaxed bg-white p-3 rounded-lg border border-slate-100">
                            "{review.comment}"
                          </p>
                        )}
                        <p className={cn("text-[10px] text-slate-400", locale === 'ar' ? 'text-left' : 'text-right')}>
                          {new Date(review.createdAt).toLocaleDateString(locale)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 p-4 border border-dashed rounded-lg text-center bg-slate-50">
                    {t("suppliers_no_reviews_registered")}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail size={20} className="text-accent" />
              {t("my_sup_invite_tab")}
            </DialogTitle>
            <DialogDescription>{t("my_sup_invite_success_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t("my_sup_invite_email_label")} <span className="text-destructive">*</span></Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t("my_sup_invite_email_placeholder")}
                disabled={isSendingInvite}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-company">{t("my_sup_invite_name_label")}</Label>
              <Input
                id="invite-company"
                value={inviteCompanyName}
                onChange={(e) => setInviteCompanyName(e.target.value)}
                placeholder={t("my_sup_invite_name_placeholder")}
                disabled={isSendingInvite}
              />
            </div>
            <Button
              className="w-full gap-2"
              onClick={handleSendInvitation}
              disabled={isSendingInvite || !inviteEmail.trim()}
            >
              {isSendingInvite ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              {t("my_sup_invite_btn")}
            </Button>

            {sentInvitations.length > 0 && (
              <div className="pt-2">
                <p className="font-bold text-sm text-slate-700 mb-2">{t("my_sup_sent_invitations")}</p>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {sentInvitations.map((inv: any) => (
                    <div key={inv.id} className="p-3 rounded-lg border border-slate-200/60 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 truncate text-sm">{inv.companyName || inv.email}</p>
                        {inv.companyName && (
                          <p className="text-xs text-muted-foreground truncate">{inv.email}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Calendar size={10} />
                          {fmtDate(inv.createdAt, locale)}
                        </p>
                      </div>
                      <Badge className={cn(
                        "shrink-0 text-[11px] font-semibold",
                        inv.status === "accepted"
                          ? "bg-success/10 text-success border-success/20"
                          : inv.status === "declined"
                          ? "bg-destructive/10 text-destructive border-destructive/20"
                          : "bg-amber-100 text-amber-700 border-amber-200"
                      )}>
                        {inv.status === "accepted"
                          ? t("my_sup_inv_accepted")
                          : inv.status === "declined"
                          ? t("my_sup_inv_declined")
                          : t("my_sup_inv_pending")}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("my_sup_remove_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("my_sup_remove_confirm_desc", { supplier: removeTarget?.supplierName || "—" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={isRemoving}
              onClick={() => {
                if (removeTarget) handleRemoveConnection(removeTarget.id)
              }}
            >
              {isRemoving ? <Loader2 className="animate-spin" size={14} /> : null}
              {t("my_sup_remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  )
}
