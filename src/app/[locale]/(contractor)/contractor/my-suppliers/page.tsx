"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, updateDoc, addDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Loader2, Users, CheckCircle, XCircle, LinkIcon, Calendar, Mail, Send, Building2 } from "lucide-react"

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
  supplierOrgId?: string
  supplierName?: string
  status?: string
  categories?: string[]
  requestedAt?: unknown
  connectedAt?: unknown
  contractorOrgId?: string
  requestedBy?: string
}

type Invitation = {
  id: string
  email?: string
  companyName?: string
  status?: string
  createdAt?: unknown
  invitedBy?: string
}

export default function MySuppliersPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const [processingId, setProcessingId] = useState<string | null>(null)

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteCompanyName, setInviteCompanyName] = useState("")
  const [isSendingInvite, setIsSendingInvite] = useState(false)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const typedProfile = profile as { organizationId?: string; companyName?: string; name?: string } | null
  const myOrgId = typedProfile?.organizationId || user?.uid

  // My contractor-supplier links
  const linksQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !myOrgId) return null
    return query(
      collection(firestore, "contractorSupplierLinks"),
      where("contractorOrgId", "==", myOrgId)
    )
  }, [firestore, user, isUserLoading, myOrgId])
  const { data: allLinks, isLoading } = useCollection(linksQuery)

  // Invitations sent by this contractor
  const invitationsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "invitations"), where("invitedBy", "==", user.uid))
  }, [firestore, user, isUserLoading])
  const { data: allInvitations, isLoading: invLoading } = useCollection(invitationsQuery)

  // Only show supplier-side pending requests under "pending" (not contractor-sent invites)
  const pendingLinks = ((allLinks || []) as SupplierLink[]).filter(
    (l) => l.status === "pending" && l.requestedBy === "supplier"
  )
  const activeLinks = ((allLinks || []) as SupplierLink[]).filter((l) => l.status === "active")
  const sentInvitations = ((allInvitations || []) as Invitation[]).filter(
    (inv) => inv.status !== "accepted"
  )

  const handleAccept = async (linkId: string) => {
    if (!firestore) return
    setProcessingId(linkId)
    try {
      await updateDoc(doc(firestore, "contractorSupplierLinks", linkId), {
        status: "active",
        connectedAt: serverTimestamp(),
      })
      toast({ title: t("my_sup_toast_accepted") })
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    } finally {
      setProcessingId(null)
    }
  }

  const handleReject = async (linkId: string) => {
    if (!firestore) return
    setProcessingId(linkId)
    try {
      await updateDoc(doc(firestore, "contractorSupplierLinks", linkId), { status: "rejected" })
      toast({ title: t("my_sup_toast_rejected") })
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    } finally {
      setProcessingId(null)
    }
  }

  const handleRemove = async (linkId: string) => {
    if (!firestore) return
    setProcessingId(linkId)
    try {
      await updateDoc(doc(firestore, "contractorSupplierLinks", linkId), { status: "rejected" })
      toast({ title: t("my_sup_toast_removed") })
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    } finally {
      setProcessingId(null)
    }
  }

  const handleSendInvitation = async () => {
    if (!firestore || !user || !myOrgId) return
    const email = inviteEmail.trim().toLowerCase()
    if (!email) {
      toast({ title: t("my_sup_invite_empty_email"), variant: "destructive" })
      return
    }
    setIsSendingInvite(true)
    try {
      await addDoc(collection(firestore, "invitations"), {
        email,
        companyName: inviteCompanyName.trim() || null,
        invitedBy: user.uid,
        contractorOrgId: myOrgId,
        contractorName: typedProfile?.companyName || typedProfile?.name || "",
        status: "pending",
        type: "supplier_invite",
        createdAt: serverTimestamp(),
      })
      toast({ title: t("my_sup_invite_success"), description: t("my_sup_invite_success_desc") })
      setInviteEmail("")
      setInviteCompanyName("")
    } catch (err) {
      console.error(err)
      toast({ title: t("my_sup_invite_error"), variant: "destructive" })
    } finally {
      setIsSendingInvite(false)
    }
  }

  const pageLoading = isUserLoading || (isLoading && !allLinks)

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("my_sup_title")}</h1>
          <p className="text-muted-foreground mt-1">{t("my_sup_desc")}</p>
        </div>

        {pageLoading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="animate-spin text-muted-foreground" size={40} />
          </div>
        ) : (
          <Tabs defaultValue="active" dir={isRtl ? "rtl" : "ltr"}>
            <TabsList className="mb-4">
              <TabsTrigger value="active" className="gap-2">
                {t("my_sup_active_tab")}
                {activeLinks.length > 0 && (
                  <Badge className="bg-success text-white text-[10px] px-1.5 py-0 h-4 min-w-4 ms-1">
                    {activeLinks.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="pending" className="gap-2 relative">
                {t("my_sup_pending_tab")}
                {pendingLinks.length > 0 && (
                  <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 h-4 min-w-4 ms-1">
                    {pendingLinks.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="invite" className="gap-2">
                <Mail size={14} />
                {t("my_sup_invite_tab")}
              </TabsTrigger>
            </TabsList>

            {/* Active suppliers */}
            <TabsContent value="active">
              {activeLinks.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                  <Users size={48} className="text-muted-foreground/30" />
                  <div>
                    <p className="text-muted-foreground font-medium">{t("my_sup_active_empty")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("my_sup_active_empty_desc")}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeLinks.map((link) => (
                    <Card key={link.id} className="border-success/20 bg-success/5">
                      <CardContent className="p-5" dir={isRtl ? "rtl" : "ltr"}>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center">
                                <LinkIcon size={14} className="text-success" />
                              </div>
                              <p className="font-bold text-slate-800 text-lg">
                                {link.supplierName || link.supplierOrgId || "—"}
                              </p>
                            </div>
                            <div className={cn("flex items-center gap-1 text-xs text-muted-foreground mt-1", isRtl ? "flex-row-reverse ps-10" : "ms-10")}>
                              <Calendar size={11} />
                              <span>{t("my_sup_connected_since")}: {fmtDate(link.connectedAt, locale)}</span>
                            </div>
                          </div>
                          <Badge className="bg-success/10 text-success border-success/20 text-xs font-semibold shrink-0">
                            {t("my_sup_active_tab")}
                          </Badge>
                        </div>
                        {link.categories && link.categories.length > 0 && (
                          <div className="mb-4">
                            <p className="text-xs text-slate-500 mb-1.5 font-semibold">{t("my_sup_categories")}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {link.categories.map((cat) => (
                                <Badge key={cat} variant="secondary" className="text-[11px] bg-white text-slate-600 border border-slate-200">{cat}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full gap-1.5 text-destructive border-destructive/30 hover:bg-destructive hover:text-white hover:border-destructive"
                          onClick={() => handleRemove(link.id)}
                          disabled={processingId === link.id}
                        >
                          {processingId === link.id ? <Loader2 className="animate-spin" size={14} /> : <XCircle size={14} />}
                          {t("my_sup_remove")}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Pending requests from suppliers */}
            <TabsContent value="pending">
              {pendingLinks.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                  <Users size={48} className="text-muted-foreground/30" />
                  <p className="text-muted-foreground font-medium">{t("my_sup_pending_empty")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {pendingLinks.map((link) => (
                    <Card key={link.id} className="border-amber-200 bg-amber-50/30">
                      <CardContent className="p-5" dir={isRtl ? "rtl" : "ltr"}>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div>
                            <p className="font-bold text-slate-800 text-lg">
                              {link.supplierName || link.supplierOrgId || "—"}
                            </p>
                            <Badge className="mt-1 bg-amber-100 text-amber-700 border-amber-200 text-xs font-semibold">
                              {t("my_sup_pending_badge")}
                            </Badge>
                          </div>
                          <div className={cn("flex items-center gap-1 text-xs text-muted-foreground", isRtl ? "flex-row-reverse" : "")}>
                            <Calendar size={12} />
                            <span>{t("my_sup_requested_at")}: {fmtDate(link.requestedAt, locale)}</span>
                          </div>
                        </div>
                        {link.categories && link.categories.length > 0 && (
                          <div className="mb-4">
                            <p className="text-xs text-slate-500 mb-1.5 font-semibold">{t("my_sup_categories")}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {link.categories.map((cat) => (
                                <Badge key={cat} variant="secondary" className="text-[11px] bg-white text-slate-600 border border-slate-200">{cat}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className={cn("flex gap-2", isRtl ? "flex-row-reverse" : "")}>
                          <Button
                            size="sm"
                            className="flex-1 gap-1.5 bg-success hover:bg-success/90"
                            onClick={() => handleAccept(link.id)}
                            disabled={processingId === link.id}
                          >
                            {processingId === link.id ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle size={14} />}
                            {t("my_sup_accept")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive hover:text-white hover:border-destructive"
                            onClick={() => handleReject(link.id)}
                            disabled={processingId === link.id}
                          >
                            {processingId === link.id ? <Loader2 className="animate-spin" size={14} /> : <XCircle size={14} />}
                            {t("my_sup_reject")}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Invite Supplier tab */}
            <TabsContent value="invite">
              <div className="max-w-lg space-y-6">
                {/* Invite form */}
                <Card className="border-accent/20">
                  <CardContent className="p-6 space-y-4" dir={isRtl ? "rtl" : "ltr"}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-9 w-9 rounded-xl bg-accent/10 flex items-center justify-center">
                        <Mail size={18} className="text-accent" />
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{t("my_sup_invite_tab")}</p>
                        <p className="text-xs text-muted-foreground">{t("my_sup_invite_success_desc")}</p>
                      </div>
                    </div>
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
                  </CardContent>
                </Card>

                {/* Sent invitations list */}
                <div>
                  <p className="font-bold text-slate-700 mb-3">{t("my_sup_sent_invitations")}</p>
                  {invLoading ? (
                    <div className="flex items-center justify-center p-10">
                      <Loader2 className="animate-spin text-muted-foreground" size={28} />
                    </div>
                  ) : sentInvitations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-10 bg-slate-50 rounded-xl border border-dashed text-center gap-2">
                      <Building2 size={32} className="text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">{t("my_sup_no_sent")}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sentInvitations.map((inv) => (
                        <Card key={inv.id} className="border-slate-200/60">
                          <CardContent className="p-4" dir={isRtl ? "rtl" : "ltr"}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-800 truncate text-sm">{inv.companyName || inv.email}</p>
                                {inv.companyName && (
                                  <p className="text-xs text-muted-foreground truncate">{inv.email}</p>
                                )}
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {t("my_sup_inv_sent_at")}: {fmtDate(inv.createdAt, locale)}
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
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </PortalLayout>
  )
}
