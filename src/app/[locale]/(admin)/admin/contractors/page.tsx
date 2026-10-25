"use client"

import { useState, useEffect, useMemo } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { NewContractorDialog } from "@/components/admin/packages/NewContractorDialog"
import { PackageChips } from "@/components/admin/packages/PackageIcons"
import { PackageKpis } from "@/components/admin/packages/PackageKpis"
import { PackageVersionCell } from "@/components/admin/packages/PackageVersionCell"
import { SubscriptionStatusPill } from "@/components/admin/packages/SubscriptionStatusPill"
import { useOrgMemberCounts } from "@/hooks/useOrgMemberCounts"
import { FULL_COMPANY_PACKAGE, useCompanyPackages } from "@/hooks/useCompanyPackages"
import { Link, useRouter } from "@/i18n/routing"
import { AccountRowActions } from "@/components/admin/AccountRowActions"
import { companiesOfRole, type CompanyOrgDoc, type CompanyUserDoc, type ListedCompany } from "@/lib/admin-accounts"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { ShowMoreRow } from "@/components/module-ui/ShowMoreRow"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Building2,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  ExternalLink,
  AlertCircle,
  Award,
  Plus,
  Trash2
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { useFirestore, useCollection, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, updateDoc, doc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useIdentityOverlays } from "@/hooks/useIdentityOverlays"
import { identityDocRef } from "@/lib/org-identity"
import { useTranslations, useLocale } from 'next-intl'
import { cn } from "@/lib/utils"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { SAUDI_CITIES, displayCity } from "@/lib/constants"
import {
  filterContractorsByStatus,
  filterContractorsByCity,
  searchContractors,
  type ContractorRow,
  type ContractorStatusFilter,
} from "@/utils/contractor-filters"

/** «منذ …» on a contractor's row (AD-02): the account's creation day, Latin digits in both scripts. */
const joinedOn = (ts: unknown, locale: string): string => {
  const v = ts as { seconds?: number; toDate?: () => Date } | string | null | undefined
  const date = typeof v === "string" ? new Date(v) : v && typeof v.toDate === "function" ? v.toDate() : v && typeof v.seconds === "number" ? new Date(v.seconds * 1000) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { year: "numeric", month: "short", day: "numeric" }) : ""
}

/** Companies shown before «show more». */
const PAGE = 20

type CompanyListRow = ContractorRow & {
  source: ListedCompany["source"]
  ownerUserId: string | null
  status: string
  legalDocuments: Record<string, any>
  uploadedDocKeys: string[]
  hasUploadedDocs: boolean
  hasAllRequiredDocs: boolean
  hasCr: boolean
  certificates: any[]
  hasCerts: boolean
  createdAt: unknown
}

export default function AdminContractorsPage() {
  const t = useTranslations("Portal.Admin.Contractors")
  const tPkg = useTranslations("Portal.AdminPackages")
  const tProc = useTranslations("Portal.ProcPackage")
  const router = useRouter()
  const { byOrg } = useCompanyPackages()
  const locale = useLocale()
  const docLabels: Record<string, string> = {
    cr: t("doc_cr"),
    vat: t("doc_vat"),
  }
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedContractor, setSelectedContractor] = useState<any>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ContractorStatusFilter>("all")
  const [cityFilter, setCityFilter] = useState("all")
  const [sortBy, setSortBy] = useState<"verification" | "latest">("verification")

  // Every contractor account: by its active role, and by the primary role of an owner switched into another company.
  const contractorsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "users"), where("role", "==", "Contractor"))
  }, [firestore, user, isUserLoading])
  const primaryContractorsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "users"), where("primaryRole", "==", "Contractor"))
  }, [firestore, user, isUserLoading])
  // Secondary companies (added from the company switcher) are companies too, whether or not their owner is in them now.
  const orgsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "organizations"), where("role", "==", "Contractor"))
  }, [firestore, user, isUserLoading])

  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"))
  }, [firestore, user, isUserLoading])

  const { data: contractors, isLoading } = useCollection(contractorsQuery)
  const { data: primaryContractors } = useCollection(primaryContractorsQuery)
  const { data: contractorOrgs } = useCollection(orgsQuery)
  const { data: allRfqs } = useCollection(rfqsQuery)
  const [localContractors, setLocalContractors] = useState<CompanyListRow[]>([])
  const [shownCount, setShownCount] = useState(PAGE)
  const accounts = useMemo(() => {
    const byId = new Map<string, CompanyUserDoc>()
    for (const u of [...((contractors || []) as CompanyUserDoc[]), ...((primaryContractors || []) as CompanyUserDoc[])]) byId.set(u.id, u)
    return [...byId.values()]
  }, [contractors, primaryContractors])
  // An owner switched into a secondary company whose doc predates the `role` field: its identity still comes from it.
  const contractorIdentityOverlays = useIdentityOverlays(accounts as { id: string; organizationId?: string; organizationRole?: string }[])

  useEffect(() => {
    if (!contractors) return
    const companies = companiesOfRole("Contractor", accounts, (contractorOrgs || []) as CompanyOrgDoc[], contractorIdentityOverlays)
    setLocalContractors(companies.map((company): CompanyListRow => {
        const c = company.doc as Record<string, any>
        const legalDocs = c.legalDocuments || {}
        const uploadedDocKeys = Object.keys(legalDocs).filter(
          k => legalDocs[k]?.url && legalDocs[k].url.length > 0
        )
        const rfqCount = allRfqs?.filter((r: any) => r.organizationId === company.orgId).length || 0

        return {
          id: company.orgId,
          source: company.source,
          ownerUserId: company.ownerUserId,
          name: c.name || c.companyName || t("unspecified"),
          contact: c.phone || t("unspecified"),
          email: c.email || "",
          city: c.city || "",
          crNumber: c.crNumber || "",
          taxNumber: c.taxNumber || "",
          verified: c.isVerified || false,
          verificationRequested: c.verificationRequested || false,
          status: c.isVerified ? t("status_active") : c.verificationRequested ? t("status_pending") : t("status_review"),
          legalDocuments: legalDocs,
          uploadedDocKeys,
          hasUploadedDocs: uploadedDocKeys.length > 0,
          hasAllRequiredDocs: !!(legalDocs.cr?.url?.length > 0 && legalDocs.vat?.url?.length > 0),
          hasCr: !!c.crNumber,
          certificates: c.certificates || [],
          hasCerts: (c.certificates?.length || 0) > 0,
          rfqCount,
          createdAt: c.createdAt,
        }
      }).sort((a, b) => {
        if (sortBy === "latest") {
          const getTs = (ts: any) => ts?.seconds ? ts.seconds * 1000 : ts?.toDate ? ts.toDate().getTime() : new Date(ts || 0).getTime()
          return getTs(b.createdAt) - getTs(a.createdAt)
        }
        if (a.verificationRequested === b.verificationRequested) return 0
        return a.verificationRequested ? -1 : 1
      }))
  }, [contractors, accounts, contractorOrgs, allRfqs, sortBy, contractorIdentityOverlays.size])

  const handleVerify = async (id: string, verify: boolean) => {
    if (!firestore) return
    const row = localContractors.find((c) => c.id === id)
    // Verification is the COMPANY's: a secondary company's lives on organizations/{id}, a primary one's on its owner's
    // users/{id} doc.
    const targetRef = row?.source === "org" ? identityDocRef(firestore, id) : doc(firestore, "users", id)
    try {
      await updateDoc(targetRef, {
        isVerified: verify,
        verificationRequested: false
      })
      setLocalContractors(prev =>
        prev.map(c => c.id === id
          ? { ...c, verified: verify, verificationRequested: false, status: verify ? t("status_active") : t("status_review") }
          : c
        )
      )
      if (selectedContractor?.id === id) {
        setSelectedContractor((prev: any) =>
          prev ? { ...prev, verified: verify, verificationRequested: false, status: verify ? t("status_active") : t("status_review") } : prev
        )
      }
      toast({ title: verify ? t("verified_success") : t("unverified_success"), description: t("update_desc") })
    } catch (e: any) {
      toast({ title: t("error"), description: e.message, variant: "destructive" })
    }
  }

  const handleDeleteContractor = async () => {
    if (!user || !selectedContractor || selectedContractor.source !== "user") return
    setIsDeleting(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/admin/users/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ uid: selectedContractor.id }),
      })
      if (!res.ok) throw new Error((await res.json()).message)
      setLocalContractors(prev => prev.filter(c => c.id !== selectedContractor.id))
      setShowDeleteDialog(false)
      setSelectedContractor(null)
      toast({ title: t("delete_success") })
    } catch (e: any) {
      toast({ title: t("error"), description: e.message, variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case t("status_active"): return <Badge className="whitespace-nowrap bg-success/10 text-success border-success/20">{t("verified_label")}</Badge>
      case t("status_pending"): return <Badge className="whitespace-nowrap bg-warning/10 text-warning border-warning/20">{t("status_pending")}</Badge>
      default: return <Badge variant="secondary" className="whitespace-nowrap">{t("status_review")}</Badge>
    }
  }

  const filtered = filterContractorsByCity(
    filterContractorsByStatus(
      searchContractors(localContractors, searchQuery),
      statusFilter
    ),
    cityFilter
  )
  const shown = filtered.slice(0, shownCount)

  // «{city} · {N} users · since {date}» under each name (AD-02).
  const owners = useMemo(() => new Map(localContractors.map((c) => [c.id, c.ownerUserId])), [localContractors])
  const memberCounts = useOrgMemberCounts(localContractors.map((c) => c.id), owners)

  // The strip counts the SAME rows as the table: companies, before the search and filters.
  const companyPackages = localContractors.map((c) => byOrg.get(c.id) ?? FULL_COMPANY_PACKAGE)
  const verificationKpis = [
    { id: "verified", label: tPkg("kpi.verified"), n: localContractors.filter((c) => c.verified).length },
    { id: "awaiting", label: tPkg("kpi.awaiting"), n: localContractors.filter((c) => !c.verified && c.verificationRequested).length, warn: true },
  ]

  const activeFilterCount = [statusFilter !== "all", cityFilter !== "all"].filter(Boolean).length

  const clearFilters = () => {
    setStatusFilter("all")
    setCityFilter("all")
  }

  const columns: DataColumn<CompanyListRow>[] = [
    {
      key: "company",
      header: t("company_name"),
      cell: (c) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-bold">{c.name}</span>
          {c.email && <span className="truncate text-xs text-muted-foreground" dir="ltr">{c.email}</span>}
          {c.crNumber && <span className="text-xs text-muted-foreground">{t("cr_number")}: <bdi>{c.crNumber}</bdi></span>}
          <span className="text-xs text-muted-foreground" data-testid="contractor-subline">
            {[c.city ? displayCity(c.city, locale) : "", memberCounts.has(c.id) ? tPkg("list.users", { count: memberCounts.get(c.id) ?? 1 }) : "", joinedOn(c.createdAt, locale) && tPkg("list.since", { date: joinedOn(c.createdAt, locale) })].filter(Boolean).join(" · ")}
          </span>
        </div>
      ),
    },
    {
      key: "package",
      header: tPkg("list.package"),
      cell: (c) => {
        const pkg = byOrg.get(c.id) ?? FULL_COMPANY_PACKAGE
        return (
          <div className="flex flex-col items-start gap-1.5">
            <Link
              href={`/admin/contractors/${c.id}`}
              aria-label={tPkg("list.open_package", { name: c.name })}
              className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PackageChips
                pkg={pkg.pkg}
                labels={{ core: tProc("base.core.short"), inv: tProc("base.inv.short"), pm: tProc("conn.pm.short"), fin: tProc("conn.fin.short"), mfg: tProc("conn.mfg.short") }}
              />
            </Link>
            <SubscriptionStatusPill status={pkg.subscription} />
          </div>
        )
      },
    },
    {
      key: "version",
      header: tPkg("list.version"),
      hideBelow: "xl",
      cardHidden: true,
      cell: (c) => (
        <Link href={`/admin/contractors/${c.id}`} className="inline-flex rounded-lg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <PackageVersionCell company={byOrg.get(c.id) ?? FULL_COMPANY_PACKAGE} />
        </Link>
      ),
    },
    { key: "rfqs", header: t("tenders_count"), hideBelow: "xl", numeric: true, cell: (c) => c.rfqCount },
    {
      key: "docs",
      header: t("documents"),
      hideBelow: "xl",
      cell: (c) =>
        c.uploadedDocKeys.length > 0 ? (
          <Badge className="whitespace-nowrap bg-success/10 text-success border-success/20 text-xs">{t("pdf_badge", { count: c.uploadedDocKeys.length })}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{t("not_available")}</span>
        ),
    },
    { key: "status", header: t("status"), cell: (c) => <span data-testid="verification-status">{getStatusBadge(c.status)}</span> },
    {
      key: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      label: t("actions"),
      className: "w-px",
      cell: (c) => (
        <AccountRowActions
          labels={{ view: t("view"), components: tPkg("list.open"), verify: t("verify"), unverify: t("unverify"), needsDocs: t("verify_needs_docs") }}
          verified={c.verified}
          canVerify={c.hasAllRequiredDocs}
          onView={() => { setSelectedContractor(c); setShowDetailDialog(true) }}
          onComponents={() => router.push(`/admin/contractors/${c.id}`)}
          onVerify={(verify) => handleVerify(c.id, verify)}
        />
      ),
    },
  ]

  return (
    <PortalLayout>
      <div className="space-y-6 text-start">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-black text-foreground font-headline">{tPkg("page.title")}</h1>
            <p className="text-muted-foreground mt-1">{tPkg("page.subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <Button onClick={() => setNewOpen(true)} className="gap-2 shrink-0">
              <Plus size={18} aria-hidden="true" />
              {tPkg("page.new")}
            </Button>
            <div className="relative min-w-[12rem] flex-1 sm:w-64 sm:flex-none">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder={t("search_placeholder")}
                aria-label={t("search_placeholder")}
                className="ps-10"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setShownCount(PAGE) }}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setShowFilters(v => !v)}
              className={cn("gap-2 shrink-0", (showFilters || activeFilterCount > 0) && "border-primary/40 bg-primary/5 text-primary")}
            >
              <Filter size={18} />
              {t("filter")}
              {activeFilterCount > 0 && (
                <span className="h-5 w-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {showFilters && (
          <Card className="border-none shadow-sm">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
              <div className="w-full sm:w-48">
                <SearchableSelect
                  value={statusFilter}
                  onChange={v => { setStatusFilter(v as ContractorStatusFilter); setShownCount(PAGE) }}
                  options={[
                    { value: "all", label: t("filter_status_all") },
                    { value: "verified", label: t("verified_label") },
                    { value: "pending", label: t("status_pending") },
                    { value: "review", label: t("status_review") },
                  ]}
                  placeholder={t("filter_status_label")}
                  searchPlaceholder={t("filter_status_label")}
                  noResultsText={t("filter_status_label")}
                  size="md"
                />
              </div>
              <div className="w-full sm:w-48">
                <SearchableSelect
                  value={cityFilter}
                  onChange={v => { setCityFilter(v); setShownCount(PAGE) }}
                  options={[
                    { value: "all", label: t("filter_city_all") },
                    ...SAUDI_CITIES.map(c => ({ value: c, label: displayCity(c, locale) })),
                  ]}
                  placeholder={t("filter_city_label")}
                  searchPlaceholder={t("filter_city_label")}
                  noResultsText={t("filter_city_label")}
                  size="md"
                />
              </div>
              <div className="flex gap-1.5 ms-auto">
                <Button
                  variant={sortBy === "verification" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("verification")}
                  className="text-xs"
                >
                  {t("sort_verification")}
                </Button>
                <Button
                  variant={sortBy === "latest" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("latest")}
                  className="text-xs"
                >
                  {t("sort_latest")}
                </Button>
              </div>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground gap-1.5">
                  <XCircle size={14} />
                  {t("filter_clear")}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        <PackageKpis companies={companyPackages} extra={verificationKpis} />

        {/* Table — one row per company */}
        <section className="space-y-3" aria-labelledby="companies-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="companies-heading" className="text-lg font-bold">{t("contractors_list")}</h2>
            {!isLoading && filtered.length > 0 && (
              <p className="text-sm text-muted-foreground" data-testid="companies-count">
                {t("companies_shown", { shown: shown.length, total: filtered.length })}
              </p>
            )}
          </div>
          {isLoading ? (
            <div className="flex justify-center rounded-xl border bg-card p-20">
              <Loader2 className="animate-spin text-primary" size={32} />
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <DataTable
                columns={columns}
                rows={shown}
                rowKey={(c) => c.id}
                caption={t("contractors_list")}
                labels={{ sortBy: (column) => t("sort_by", { column }), showMore: (count) => t("show_more_count", { count }) }}
                bordered={false}
                empty={
                  <div className="p-16 text-center text-muted-foreground">
                    <Building2 className="mx-auto h-12 w-12 opacity-20 mb-3" />
                    <p className="font-medium">{t("no_contractors_found")}</p>
                  </div>
                }
              />
              {filtered.length > shown.length && (
                <ShowMoreRow onClick={() => setShownCount((n) => n + PAGE)}>
                  {t("show_more_count", { count: Math.min(PAGE, filtered.length - shown.length) })}
                </ShowMoreRow>
              )}
            </div>
          )}
        </section>

        {/* Detail Dialog */}
        <NewContractorDialog open={newOpen} onOpenChange={setNewOpen} />
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Building2 size={22} className="text-primary" />
                {t("contractor_details")}
              </DialogTitle>
              <DialogDescription>
                {t("details_subtitle")}
              </DialogDescription>
            </DialogHeader>

            {selectedContractor && (
              <div className="space-y-5 py-2">
                {/* Basic Info */}
                <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-lg text-slate-800">{selectedContractor.name}</h4>
                    {getStatusBadge(selectedContractor.status)}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <div><span className="text-muted-foreground">{t("email_label")}</span><span className="mr-2 font-medium text-xs">{selectedContractor.email || "—"}</span></div>
                    <div><span className="text-muted-foreground">{t("phone_label")}</span><span className="mr-2 font-medium">{selectedContractor.contact || "—"}</span></div>
                    <div><span className="text-muted-foreground">{t("city_label")}</span><span className="mr-2 font-medium">{selectedContractor.city ? displayCity(selectedContractor.city, locale) : "—"}</span></div>
                    <div><span className="text-muted-foreground">{t("cr_label")}</span><span className="mr-2 font-medium">{selectedContractor.crNumber || "—"}</span></div>
                    <div><span className="text-muted-foreground">{t("tax_label")}</span><span className="mr-2 font-medium">{selectedContractor.taxNumber || "—"}</span></div>
                    <div><span className="text-muted-foreground">{t("tenders_number")}</span><span className="mr-2 font-bold text-primary">{selectedContractor.rfqCount}</span></div>
                  </div>
                </div>

                <Separator />

                {/* Legal Documents */}
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2">
                    <FileText size={18} className="text-primary" />
                    {t("legal_docs_title")}
                  </h4>
                  {Object.entries(docLabels).map(([key, label]) => {
                    const docData = selectedContractor.legalDocuments?.[key]
                    const hasUrl = docData?.url && docData.url.length > 0
                    return (
                      <div
                        key={key}
                        className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${hasUrl ? "bg-emerald-50/60 border-emerald-200" : "bg-slate-50 border-slate-200"}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${hasUrl ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                            <FileText size={18} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-800">{label}</p>
                            {hasUrl ? (
                              <p className="text-xs text-emerald-700 font-medium mt-0.5">
                                {t("uploaded")}
                                {docData.expiryDate && <span className="text-slate-500 mr-2">{t("expires", { date: docData.expiryDate })}</span>}
                              </p>
                            ) : (
                              <p className="text-xs text-slate-400 mt-0.5">{t("not_uploaded")}</p>
                            )}
                          </div>
                        </div>
                        {hasUrl ? (
                          <a href={docData.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                            <Button size="sm" variant="outline" className="gap-1.5 text-xs font-bold border-emerald-300 hover:bg-emerald-50">
                              <ExternalLink size={13} />
                              {t("open_file")}
                            </Button>
                          </a>
                        ) : (
                          <Badge variant="secondary" className="text-xs shrink-0">{t("not_found_doc")}</Badge>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Certificates */}
                {selectedContractor.certificates?.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <h4 className="font-bold text-slate-800 flex items-center gap-2">
                        <Award size={18} className="text-purple-500" />
                        {t("certificates_title", { count: selectedContractor.certificates.length })}
                      </h4>
                      {selectedContractor.certificates.map((cert: any, idx: number) => (
                        <div key={idx} className="p-3 rounded-xl border bg-purple-50/40 border-purple-100 flex items-center justify-between">
                          <div>
                            <p className="font-bold text-sm">{cert.name}</p>
                            <p className="text-xs text-muted-foreground">{cert.issuer}{cert.expiryDate && ` • ${t("expires", { date: cert.expiryDate })}`}</p>
                          </div>
                          {cert.documentUrl && (
                            <a href={cert.documentUrl} target="_blank" rel="noopener noreferrer">
                                <Button size="sm" variant="outline" className="gap-1 text-xs">
                                  <ExternalLink size={12} />
                                  {t("view")}
                                </Button>
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Warning if no docs at all */}
                {!selectedContractor.hasAllRequiredDocs && (
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="text-destructive shrink-0 mt-0.5" size={18} />
                    <p className="text-sm text-destructive font-bold">
                      {t("cannot_verify")}
                    </p>
                  </div>
                )}

                <Separator />

                {/* Actions */}
                <div className="flex gap-3 pt-1 flex-wrap">
                  <Button variant="outline" className="flex-1" onClick={() => setShowDetailDialog(false)}>
                    {t("close")}
                  </Button>
                  {selectedContractor.verified ? (
                    <Button
                      variant="outline"
                      className="flex-1 text-destructive border-destructive/20 hover:bg-destructive/5"
                      onClick={() => { handleVerify(selectedContractor.id, false); setShowDetailDialog(false) }}
                    >
                      {t("unverify_account")}
                    </Button>
                  ) : (
                    <Button
                      className="flex-1 gap-2"
                      disabled={!selectedContractor.hasAllRequiredDocs}
                      onClick={() => { handleVerify(selectedContractor.id, true); setShowDetailDialog(false) }}
                    >
                      <CheckCircle2 size={16} />
                      {t("verify_account")}
                    </Button>
                  )}
                  {selectedContractor.source === "user" && (
                    <Button
                      variant="outline"
                      className="gap-2 text-destructive border-destructive/20 hover:bg-destructive/5"
                      onClick={() => { setShowDetailDialog(false); setShowDeleteDialog(true) }}
                    >
                      <Trash2 size={15} />
                      {t("delete_account")}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("delete_confirm_title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("delete_confirm_desc", { name: selectedContractor?.name || "" })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>{t("close")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteContractor}
                disabled={isDeleting}
                className="bg-destructive hover:bg-destructive/90 gap-2"
              >
                {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {t("delete_account")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PortalLayout>
  )
}
