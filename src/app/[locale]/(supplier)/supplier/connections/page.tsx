"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Loader2, Users, Search, Link2, XCircle, Calendar, Building2, MapPin, Send, CheckCircle2 } from "lucide-react"

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

type SupplierLink = {
  id: string
  contractorOrgId?: string
  supplierOrgId?: string
  status?: string
  requestedAt?: unknown
  connectedAt?: unknown
}

type ContractorUser = {
  id: string
  name?: string
  companyName?: string
  city?: string
  organizationId?: string
  organizationRole?: string
  role?: string
}

export default function SupplierConnectionsPage() {
  const t = useTranslations("Portal.Supplier")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const [searchTerm, setSearchTerm] = useState("")
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const typedProfile = profile as { organizationId?: string; companyName?: string; name?: string; specializations?: string[] } | null
  const myOrgId = typedProfile?.organizationId || user?.uid

  // My links (as supplier)
  const linksQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !myOrgId) return null
    return query(collection(firestore, "contractorSupplierLinks"), where("supplierOrgId", "==", myOrgId))
  }, [firestore, user, isUserLoading, myOrgId])
  const { data: allLinks, isLoading: linksLoading } = useCollection(linksQuery)

  const activeLinks = ((allLinks || []) as SupplierLink[]).filter((l) => l.status === "active")
  const pendingLinks = ((allLinks || []) as SupplierLink[]).filter((l) => l.status === "pending")
  const linkedContractorOrgIds = new Set(((allLinks || []) as SupplierLink[]).filter(l => l.status !== "rejected").map((l) => l.contractorOrgId))

  // Contractors directory (for "find" tab)
  const contractorsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "users"), where("role", "==", "Contractor"))
  }, [firestore, user, isUserLoading])
  const { data: allContractors, isLoading: contractorsLoading } = useCollection(contractorsQuery)

  // Resolve contractor org display info for active/pending links
  const contractorOrgIdsToFetch = Array.from(new Set(((allLinks || []) as SupplierLink[]).map((l) => l.contractorOrgId).filter(Boolean)))
  const contractorsByOrgId = new Map<string, ContractorUser>()
  ;((allContractors || []) as ContractorUser[]).forEach((c) => {
    const orgId = c.organizationId || c.id
    if (!contractorsByOrgId.has(orgId)) contractorsByOrgId.set(orgId, c)
  })

  const filteredContractors = ((allContractors || []) as ContractorUser[]).filter((c) => {
    if (!searchTerm.trim()) return true
    const q = searchTerm.trim().toLowerCase()
    return (c.name || "").toLowerCase().includes(q) || (c.companyName || "").toLowerCase().includes(q)
  }).slice(0, 20)

  const handleSendRequest = async (contractor: ContractorUser) => {
    if (!firestore || !user || !myOrgId) return
    const targetOrgId = contractor.organizationId || contractor.id
    setSendingId(contractor.id)
    try {
      await addDoc(collection(firestore, "contractorSupplierLinks"), {
        contractorOrgId: targetOrgId,
        supplierOrgId: myOrgId,
        supplierName: typedProfile?.companyName || typedProfile?.name || t("generic_supplier"),
        supplierCategories: typedProfile?.specializations || [],
        status: "pending",
        requestedBy: "supplier",
        requestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        connectedAt: null,
      })
      toast({ title: t("conn_request_sent") })
    } catch (err) {
      console.error(err)
      toast({ title: t("error_title"), variant: "destructive" })
    } finally {
      setSendingId(null)
    }
  }

  const handleCancelRequest = async (linkId: string) => {
    if (!firestore) return
    setCancelingId(linkId)
    try {
      await updateDoc(doc(firestore, "contractorSupplierLinks", linkId), { status: "rejected" })
      toast({ title: t("conn_cancel_request") })
    } catch (err) {
      console.error(err)
      toast({ title: t("error_title"), variant: "destructive" })
    } finally {
      setCancelingId(null)
    }
  }

  const pageLoading = isUserLoading || (linksLoading && !allLinks)

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("conn_title")}</h1>
          <p className="text-muted-foreground mt-1">{t("conn_desc")}</p>
        </div>

        {pageLoading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="animate-spin text-muted-foreground" size={40} />
          </div>
        ) : (
          <Tabs defaultValue="active" dir={isRtl ? "rtl" : "ltr"}>
            <TabsList className="mb-4">
              <TabsTrigger value="active" className="gap-2">
                {t("conn_active_tab")}
                {activeLinks.length > 0 && (
                  <Badge className="bg-success text-white text-[10px] px-1.5 py-0 h-4 min-w-4 ms-1">{activeLinks.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="requests" className="gap-2">
                {t("conn_requests_tab")}
                {pendingLinks.length > 0 && (
                  <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 h-4 min-w-4 ms-1">{pendingLinks.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="find" className="gap-2">
                <Search size={14} />
                {t("conn_find_tab")}
              </TabsTrigger>
            </TabsList>

            {/* Active connections */}
            <TabsContent value="active">
              {activeLinks.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                  <Users size={48} className="text-muted-foreground/30" />
                  <div>
                    <p className="text-muted-foreground font-medium">{t("conn_active_empty")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("conn_active_empty_desc")}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeLinks.map((link) => {
                    const contractor = link.contractorOrgId ? contractorsByOrgId.get(link.contractorOrgId) : undefined
                    return (
                      <Card key={link.id} className="border-success/20 bg-success/5">
                        <CardContent className="p-5" dir={isRtl ? "rtl" : "ltr"}>
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div className="flex items-center gap-2">
                              <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center">
                                <Link2 size={14} className="text-success" />
                              </div>
                              <p className="font-bold text-slate-800 text-lg">
                                {contractor?.companyName || contractor?.name || t("conn_contractor_label")}
                              </p>
                            </div>
                            <Badge className="bg-success/10 text-success border-success/20 text-xs font-semibold shrink-0">
                              {t("conn_active_tab")}
                            </Badge>
                          </div>
                          <div className={cn("flex items-center gap-1 text-xs text-muted-foreground", isRtl ? "flex-row-reverse ps-10" : "ms-10")}>
                            <Calendar size={11} />
                            <span>{t("conn_connected_since")}: {fmtDate(link.connectedAt, locale)}</span>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </TabsContent>

            {/* My sent requests */}
            <TabsContent value="requests">
              {pendingLinks.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                  <Send size={48} className="text-muted-foreground/30" />
                  <p className="text-muted-foreground font-medium">{t("conn_requests_empty")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {pendingLinks.map((link) => {
                    const contractor = link.contractorOrgId ? contractorsByOrgId.get(link.contractorOrgId) : undefined
                    return (
                      <Card key={link.id} className="border-amber-200 bg-amber-50/30">
                        <CardContent className="p-5" dir={isRtl ? "rtl" : "ltr"}>
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div>
                              <p className="font-bold text-slate-800 text-lg">
                                {contractor?.companyName || contractor?.name || t("conn_contractor_label")}
                              </p>
                              <Badge className="mt-1 bg-amber-100 text-amber-700 border-amber-200 text-xs font-semibold">
                                {t("conn_pending_badge")}
                              </Badge>
                            </div>
                            <div className={cn("flex items-center gap-1 text-xs text-muted-foreground", isRtl ? "flex-row-reverse" : "")}>
                              <Calendar size={12} />
                              <span>{fmtDate(link.requestedAt, locale)}</span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full gap-1.5 text-destructive border-destructive/30 hover:bg-destructive hover:text-white hover:border-destructive"
                            onClick={() => handleCancelRequest(link.id)}
                            disabled={cancelingId === link.id}
                          >
                            {cancelingId === link.id ? <Loader2 className="animate-spin" size={14} /> : <XCircle size={14} />}
                            {t("conn_cancel_request")}
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </TabsContent>

            {/* Find a contractor */}
            <TabsContent value="find">
              <div className="space-y-4">
                <div className="relative max-w-md">
                  <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder={t("conn_find_placeholder")}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pe-10"
                  />
                </div>

                {contractorsLoading ? (
                  <div className="flex items-center justify-center p-16">
                    <Loader2 className="animate-spin text-muted-foreground" size={32} />
                  </div>
                ) : filteredContractors.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-16 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                    <Building2 size={40} className="text-muted-foreground/30" />
                    <p className="text-muted-foreground font-medium">{t("conn_no_results")}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredContractors.map((contractor) => {
                      const targetOrgId = contractor.organizationId || contractor.id
                      const isConnected = linkedContractorOrgIds.has(targetOrgId) && activeLinks.some(l => l.contractorOrgId === targetOrgId)
                      const isPending = pendingLinks.some((l) => l.contractorOrgId === targetOrgId)
                      return (
                        <Card key={contractor.id} className="border-slate-200/60">
                          <CardContent className="p-5" dir={isRtl ? "rtl" : "ltr"}>
                            <div className="flex items-start gap-3 mb-4">
                              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                <Building2 size={18} className="text-primary" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-bold text-slate-800 truncate">
                                  {contractor.companyName || contractor.name || t("conn_contractor_label")}
                                </p>
                                {contractor.city && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                    <MapPin size={11} />
                                    <span>{contractor.city}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            {isConnected ? (
                              <Button size="sm" disabled className="w-full gap-1.5 bg-success/10 text-success border border-success/20 hover:bg-success/10" variant="outline">
                                <CheckCircle2 size={14} />
                                {t("conn_already_connected")}
                              </Button>
                            ) : isPending ? (
                              <Button size="sm" disabled className="w-full gap-1.5" variant="outline">
                                <Send size={14} />
                                {t("conn_request_sent")}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                className="w-full gap-1.5"
                                onClick={() => handleSendRequest(contractor)}
                                disabled={sendingId === contractor.id}
                              >
                                {sendingId === contractor.id ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                                {t("conn_send_request")}
                              </Button>
                            )}
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </PortalLayout>
  )
}
