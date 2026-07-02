"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Loader2, Users, Link2, Calendar, Building2, CheckCircle2, XCircle, Mail } from "lucide-react"

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
  organizationId?: string
  role?: string
}

type Invitation = {
  id: string
  email?: string
  companyName?: string
  contractorOrgId?: string
  contractorName?: string
  invitedBy?: string
  status?: string
  createdAt?: unknown
}

export default function SupplierConnectionsPage() {
  const t = useTranslations("Portal.Supplier")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const [processingId, setProcessingId] = useState<string | null>(null)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const typedProfile = profile as { organizationId?: string; companyName?: string; name?: string; specializations?: string[] } | null
  const myOrgId = typedProfile?.organizationId || user?.uid

  // My active links (as supplier)
  const linksQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !myOrgId) return null
    return query(collection(firestore, "contractorSupplierLinks"), where("supplierOrgId", "==", myOrgId))
  }, [firestore, user, isUserLoading, myOrgId])
  const { data: allLinks, isLoading: linksLoading } = useCollection(linksQuery)
  const activeLinks = ((allLinks || []) as SupplierLink[]).filter((l) => l.status === "active")

  // Pending invitations addressed to this supplier's email
  const invitationsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !user.email) return null
    return query(
      collection(firestore, "invitations"),
      where("email", "==", user.email.toLowerCase()),
      where("status", "==", "pending")
    )
  }, [firestore, user, isUserLoading])
  const { data: allInvitations, isLoading: invLoading } = useCollection(invitationsQuery)
  const pendingInvitations = (allInvitations || []) as Invitation[]

  // Fetch contractor info for active links display
  const contractorsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "users"), where("role", "==", "Contractor"))
  }, [firestore, user, isUserLoading])
  const { data: allContractors } = useCollection(contractorsQuery)
  const contractorsByOrgId = new Map<string, ContractorUser>()
  ;((allContractors || []) as ContractorUser[]).forEach((c) => {
    const orgId = c.organizationId || c.id
    if (!contractorsByOrgId.has(orgId)) contractorsByOrgId.set(orgId, c)
  })

  // Already linked contractor org IDs (to avoid duplicate links on accept)
  const linkedContractorOrgIds = new Set(
    ((allLinks || []) as SupplierLink[])
      .filter((l) => l.status === "active")
      .map((l) => l.contractorOrgId)
  )

  const handleAcceptInvitation = async (inv: Invitation) => {
    if (!firestore || !user || !myOrgId || !inv.contractorOrgId) return
    if (linkedContractorOrgIds.has(inv.contractorOrgId)) {
      // Already linked — just mark the invitation accepted
      setProcessingId(inv.id)
      try {
        await updateDoc(doc(firestore, "invitations", inv.id), { status: "accepted", acceptedAt: serverTimestamp() })
        toast({ title: t("conn_inv_accepted_toast") })
      } catch (err) {
        console.error(err)
        toast({ title: t("conn_inv_error"), variant: "destructive" })
      } finally {
        setProcessingId(null)
      }
      return
    }
    setProcessingId(inv.id)
    try {
      // Create the contractor-supplier link (contractor-initiated, already accepted)
      await addDoc(collection(firestore, "contractorSupplierLinks"), {
        contractorOrgId: inv.contractorOrgId,
        supplierOrgId: myOrgId,
        supplierName: typedProfile?.companyName || typedProfile?.name || "",
        supplierCategories: typedProfile?.specializations || [],
        status: "active",
        requestedBy: "contractor",
        requestedAt: serverTimestamp(),
        connectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      // Mark invitation as accepted
      await updateDoc(doc(firestore, "invitations", inv.id), { status: "accepted", acceptedAt: serverTimestamp() })
      toast({ title: t("conn_inv_accepted_toast") })
    } catch (err) {
      console.error(err)
      toast({ title: t("conn_inv_error"), variant: "destructive" })
    } finally {
      setProcessingId(null)
    }
  }

  const handleDeclineInvitation = async (invId: string) => {
    if (!firestore) return
    setProcessingId(invId)
    try {
      await updateDoc(doc(firestore, "invitations", invId), { status: "declined" })
      toast({ title: t("conn_inv_declined_toast") })
    } catch (err) {
      console.error(err)
      toast({ title: t("conn_inv_error"), variant: "destructive" })
    } finally {
      setProcessingId(null)
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
              <TabsTrigger value="invitations" className="gap-2">
                <Mail size={14} />
                {t("conn_invitations_tab")}
                {pendingInvitations.length > 0 && (
                  <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 h-4 min-w-4 ms-1">{pendingInvitations.length}</Badge>
                )}
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

            {/* Pending invitations */}
            <TabsContent value="invitations">
              {invLoading ? (
                <div className="flex items-center justify-center p-16">
                  <Loader2 className="animate-spin text-muted-foreground" size={32} />
                </div>
              ) : pendingInvitations.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                  <Mail size={48} className="text-muted-foreground/30" />
                  <div>
                    <p className="text-muted-foreground font-medium">{t("conn_invitations_empty")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("conn_invitations_empty_desc")}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {pendingInvitations.map((inv) => (
                    <Card key={inv.id} className="border-accent/20 bg-accent/5">
                      <CardContent className="p-5" dir={isRtl ? "rtl" : "ltr"}>
                        <div className="flex items-start gap-3 mb-4">
                          <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                            <Building2 size={18} className="text-accent" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-muted-foreground font-medium mb-0.5">{t("conn_inv_from")}</p>
                            <p className="font-bold text-slate-800 truncate">
                              {inv.contractorName || t("conn_contractor_label")}
                            </p>
                            {inv.companyName && (
                              <p className="text-xs text-muted-foreground truncate">{inv.companyName}</p>
                            )}
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                              <Calendar size={11} />
                              <span>{t("conn_inv_received_at")}: {fmtDate(inv.createdAt, locale)}</span>
                            </div>
                          </div>
                        </div>
                        <div className={cn("flex gap-2", isRtl ? "flex-row-reverse" : "")}>
                          <Button
                            size="sm"
                            className="flex-1 gap-1.5 bg-success hover:bg-success/90"
                            onClick={() => handleAcceptInvitation(inv)}
                            disabled={processingId === inv.id}
                          >
                            {processingId === inv.id ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                            {t("conn_inv_accept")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive hover:text-white hover:border-destructive"
                            onClick={() => handleDeclineInvitation(inv.id)}
                            disabled={processingId === inv.id}
                          >
                            {processingId === inv.id ? <Loader2 className="animate-spin" size={14} /> : <XCircle size={14} />}
                            {t("conn_inv_decline")}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </PortalLayout>
  )
}
