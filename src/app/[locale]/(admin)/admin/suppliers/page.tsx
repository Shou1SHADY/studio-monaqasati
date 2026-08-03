"use client"

import { useState, useEffect } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import {
  Users,
  Search,
  ShieldCheck,
  ShieldAlert,
  Filter,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  FileText,
  Building,
  Award,
  ExternalLink,
  AlertCircle,
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
import { collection, query, where, updateDoc, deleteDoc, doc, limit } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useTranslations, useLocale } from 'next-intl'
import { cn } from "@/lib/utils"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { CATEGORIES_DATA, SAUDI_CITIES, displayCategory, displayCity } from "@/lib/constants"
import {
  filterSuppliersByStatus,
  filterSuppliersByCity,
  filterSuppliersBySpecialization,
  searchSuppliers,
  type SupplierStatusFilter,
} from "@/utils/supplier-filters"

const DOC_LABELS: Record<string, string> = {
  cr: "السجل التجاري (CR)",
  vat: "شهادة ضريبة القيمة المضافة (VAT)",
}

export default function AdminSuppliersPage() {
  const t = useTranslations("Portal.Admin.Suppliers")
  const locale = useLocale()
  const docLabels: Record<string, string> = {
    cr: t("doc_cr"),
    vat: t("doc_vat"),
  }
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")
  const [limitCount, setLimitCount] = useState(20)
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null)
  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [statusFilter, setStatusFilter] = useState<SupplierStatusFilter>("all")
  const [cityFilter, setCityFilter] = useState("all")
  const [specializationFilter, setSpecializationFilter] = useState("all")
  const [sortBy, setSortBy] = useState<"verification" | "latest">("verification")

  const suppliersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "users"),
      where("role", "==", "Supplier"),
      limit(limitCount)
    )
  }, [firestore, user, isUserLoading, limitCount])

  const { data: suppliers, isLoading } = useCollection(suppliersQuery)
  const [localSuppliers, setLocalSuppliers] = useState<any[]>([])

  useEffect(() => {
    if (suppliers) {
      setLocalSuppliers(suppliers.map((s: any) => {
        const legalDocs = s.legalDocuments || {}
        // Count how many legal docs have an actual uploaded URL
        const uploadedDocKeys = Object.keys(legalDocs).filter(
          k => legalDocs[k]?.url && legalDocs[k].url.length > 0
        )
        return {
          id: s.id,
          name: s.name || t("unspecified"),
          contact: s.phone || t("unspecified"),
          email: s.email || "",
          city: s.city || "",
          crNumber: s.crNumber || "",
          taxNumber: s.taxNumber || "",
          category: s.specializations?.[0] || t("unspecified"),
          specializations: s.specializations || [],
          verified: s.isVerified || false,
          verificationRequested: s.verificationRequested || false,
          status: s.isVerified ? t("status_active") : s.verificationRequested ? t("status_pending") : t("status_review"),
          // Legal documents — the actual uploaded PDFs
          legalDocuments: legalDocs,
          uploadedDocKeys,
          hasUploadedDocs: uploadedDocKeys.length > 0,
          hasAllRequiredDocs: !!(legalDocs.cr?.url?.length > 0 && legalDocs.vat?.url?.length > 0),
          // Legacy fields (for backwards compat)
          hasCr: !!s.crNumber,
          certificates: s.certificates || [],
          hasCerts: (s.certificates?.length || 0) > 0,
          createdAt: s.createdAt,
        }
      }).sort((a: any, b: any) => {
        if (sortBy === "latest") {
          const getTs = (ts: any) => ts?.seconds ? ts.seconds * 1000 : ts?.toDate ? ts.toDate().getTime() : new Date(ts || 0).getTime()
          return getTs(b.createdAt) - getTs(a.createdAt)
        }
        if (a.verificationRequested === b.verificationRequested) return 0
        return a.verificationRequested ? -1 : 1
      }))
    }
  }, [suppliers, sortBy])

  const handleVerify = async (id: string, verify: boolean) => {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, "users", id), {
        isVerified: verify,
        verificationRequested: false
      })
      setLocalSuppliers(prev =>
        prev.map(s => s.id === id
          ? { ...s, verified: verify, verificationRequested: false, status: verify ? t("status_active") : t("status_review") }
          : s
        )
      )
      if (selectedSupplier?.id === id) {
        setSelectedSupplier((prev: any) => prev ? { ...prev, verified: verify, verificationRequested: false, status: verify ? t("status_active") : t("status_review") } : prev)
      }
      toast({ title: verify ? t("verified_success") : t("unverified_success"), description: t("update_desc") })
    } catch (e: any) {
      toast({ title: t("error"), description: e.message, variant: "destructive" })
    }
  }

  const handleDeleteSupplier = async () => {
    if (!firestore || !selectedSupplier) return
    setIsDeleting(true)
    try {
      await deleteDoc(doc(firestore, "users", selectedSupplier.id))
      setLocalSuppliers(prev => prev.filter(s => s.id !== selectedSupplier.id))
      setShowDeleteDialog(false)
      setShowDetailDialog(false)
      setSelectedSupplier(null)
      toast({ title: t("delete_success") })
    } catch (e: any) {
      toast({ title: t("error"), description: e.message, variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case t("status_active"): return <Badge className="bg-success/10 text-success border-success/20">{t("status_active")}</Badge>
      case t("status_pending"): return <Badge className="bg-amber-50 text-amber-600 border-amber-100">{t("status_pending")}</Badge>
      case t("status_review"): return <Badge variant="secondary">{t("status_review")}</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  const filteredSuppliers = filterSuppliersBySpecialization(
    filterSuppliersByCity(
      filterSuppliersByStatus(
        searchSuppliers(localSuppliers, searchQuery),
        statusFilter
      ),
      cityFilter
    ),
    specializationFilter
  )

  const activeFilterCount = [statusFilter !== "all", cityFilter !== "all", specializationFilter !== "all"].filter(Boolean).length

  const clearFilters = () => {
    setStatusFilter("all")
    setCityFilter("all")
    setSpecializationFilter("all")
  }

  const specializationOptions = Array.from(
    new Set(localSuppliers.flatMap(s => s.specializations))
  )

  return (
    <PortalLayout>
      <div className="space-y-6 text-right">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("page_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("page_subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("search_placeholder")}
                className="pr-10"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
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
                  onChange={v => setStatusFilter(v as SupplierStatusFilter)}
                  options={[
                    { value: "all", label: t("filter_status_all") },
                    { value: "verified", label: t("status_active") },
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
                  onChange={setCityFilter}
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
              <div className="w-full sm:w-52">
                <SearchableSelect
                  value={specializationFilter}
                  onChange={setSpecializationFilter}
                  options={[
                    { value: "all", label: t("filter_specialization_all") },
                    ...specializationOptions.map(s => ({ value: s, label: displayCategory(s, locale) })),
                  ]}
                  placeholder={t("filter_specialization_label")}
                  searchPlaceholder={t("filter_specialization_label")}
                  noResultsText={t("filter_specialization_label")}
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

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-none shadow-sm bg-blue-50/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                <Users size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("total_count")}</p>
                <p className="text-2xl font-bold">{localSuppliers.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-success/5">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center text-success">
                <ShieldCheck size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("verified_count")}</p>
                <p className="text-2xl font-bold">{localSuppliers.filter(s => s.verified).length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-amber-50/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                <ShieldAlert size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("pending_count")}</p>
                <p className="text-2xl font-bold">{localSuppliers.filter(s => s.verificationRequested).length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="text-lg">{t("suppliers_list")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-20 flex justify-center">
                <Loader2 className="animate-spin text-primary" size={32} />
              </div>
            ) : filteredSuppliers.length === 0 ? (
              <div className="p-16 text-center text-muted-foreground">
                <Users className="mx-auto h-12 w-12 opacity-20 mb-3" />
                <p className="font-medium">{t("no_suppliers_found")}</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-right hidden md:table-cell">{t("id")}</TableHead>
                    <TableHead className="text-right">{t("supplier_name")}</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">{t("specialization")}</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">{t("documents")}</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">{t("verification_req")}</TableHead>
                    <TableHead className="text-right">{t("status")}</TableHead>
                    <TableHead className="text-left">{t("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSuppliers.map((s) => (
                    <TableRow key={s.id} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="font-mono text-xs hidden md:table-cell">{s.id.substring(0, 8)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold">{s.name}</span>
                          <span className="text-xs text-muted-foreground">{s.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm">{s.category}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex gap-1 flex-wrap">
                          {s.hasCr && <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">{t("cr_badge")}</Badge>}
                          {s.uploadedDocKeys.length > 0 && (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                              {t("pdf_badge", { count: s.uploadedDocKeys.length })}
                            </Badge>
                          )}
                          {s.hasCerts && <Badge className="bg-purple-50 text-purple-700 border-purple-200 text-xs">{t("certs_badge")}</Badge>}
                          {!s.hasCr && s.uploadedDocKeys.length === 0 && (
                            <span className="text-xs text-muted-foreground">{t("not_available")}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {s.verificationRequested ? (
                          <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs">{t("request_submitted")}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(s.status)}</TableCell>
                      <TableCell className="text-left">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setSelectedSupplier(s); setShowDetailDialog(true) }}
                            className="gap-1"
                          >
                            <Eye size={14} />
                            {t("view")}
                          </Button>
                          {s.verified ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleVerify(s.id, false)}
                              className="text-destructive border-destructive/20 hover:bg-destructive/5"
                            >
                              {t("unverify")}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleVerify(s.id, true)}
                              disabled={!s.hasAllRequiredDocs}
                              className="gap-1"
                            >
                              <CheckCircle2 size={14} />
                              {t("verify")}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {suppliers && suppliers.length >= limitCount && (
              <div className="p-4 text-center border-t">
                <Button variant="outline" onClick={() => setLimitCount(limitCount + 20)}>
                  {t("show_more")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail Dialog */}
        <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Building size={22} className="text-primary" />
                {t("supplier_details")}
              </DialogTitle>
              <DialogDescription>
                {t("details_subtitle")}
              </DialogDescription>
            </DialogHeader>

            {selectedSupplier && (
              <div className="space-y-5 py-2">
                {/* Basic Info */}
                <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-lg text-slate-800">{selectedSupplier.name}</h4>
                    {getStatusBadge(selectedSupplier.status)}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <div><span className="text-muted-foreground">{t("email_label")}</span><span className="mr-2 font-medium text-xs">{selectedSupplier.email || "—"}</span></div>
                    <div><span className="text-muted-foreground">{t("phone_label")}</span><span className="mr-2 font-medium">{selectedSupplier.contact || "—"}</span></div>
                    <div><span className="text-muted-foreground">{t("city_label")}</span><span className="mr-2 font-medium">{selectedSupplier.city || "—"}</span></div>
                    <div><span className="text-muted-foreground">{t("cr_label")}</span><span className="mr-2 font-medium">{selectedSupplier.crNumber || "—"}</span></div>
                    <div><span className="text-muted-foreground">{t("tax_label")}</span><span className="mr-2 font-medium">{selectedSupplier.taxNumber || "—"}</span></div>
                    <div><span className="text-muted-foreground">{t("spec_label")}</span><span className="mr-2 font-medium">{selectedSupplier.category || "—"}</span></div>
                  </div>
                  {selectedSupplier.specializations?.length > 1 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {selectedSupplier.specializations.map((spec: string) => (
                        <Badge key={spec} variant="secondary" className="text-xs">{spec}</Badge>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Legal Documents — Uploaded PDFs */}
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2">
                    <FileText size={18} className="text-primary" />
                    {t("legal_docs_title")}
                  </h4>

                  {Object.entries(docLabels).map(([key, label]) => {
                    const docData = selectedSupplier.legalDocuments?.[key]
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
                          <a
                            href={docData.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0"
                          >
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
                {selectedSupplier.certificates?.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <h4 className="font-bold text-slate-800 flex items-center gap-2">
                        <Award size={18} className="text-purple-500" />
                        {t("certificates_title", { count: selectedSupplier.certificates.length })}
                      </h4>
                      <div className="space-y-2">
                        {selectedSupplier.certificates.map((cert: any, idx: number) => (
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
                    </div>
                  </>
                )}

                {/* Warning if no docs at all */}
                {!selectedSupplier.hasAllRequiredDocs && (
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
                  {selectedSupplier.verified ? (
                    <Button
                      variant="outline"
                      className="flex-1 text-destructive border-destructive/20 hover:bg-destructive/5"
                      onClick={() => { handleVerify(selectedSupplier.id, false); setShowDetailDialog(false) }}
                    >
                      {t("unverify_account")}
                    </Button>
                  ) : (
                    <Button
                      className="flex-1 gap-2"
                      disabled={!selectedSupplier.hasAllRequiredDocs}
                      onClick={() => { handleVerify(selectedSupplier.id, true); setShowDetailDialog(false) }}
                    >
                      <CheckCircle2 size={16} />
                      {t("verify_account")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="gap-2 text-destructive border-destructive/20 hover:bg-destructive/5"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    <Trash2 size={15} />
                    {t("delete_account")}
                  </Button>
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
                {t("delete_confirm_desc", { name: selectedSupplier?.name || "" })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>{t("close")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteSupplier}
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
