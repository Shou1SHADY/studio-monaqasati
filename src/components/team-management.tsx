"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, updateDoc, deleteDoc, setDoc, getDocs, addDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useTranslations, useLocale } from 'next-intl'
import { Users, UserPlus, Trash2, Mail, Shield, ShieldCheck, Loader2, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface TeamPageProps {
  role: "Contractor" | "Supplier"
}

export default function TeamManagementPage({ role }: TeamPageProps) {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteName, setInviteName] = useState("")
  const [isInviting, setIsInviting] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const membersQuery = useMemoFirebase(() => {
    if (!firestore || !profile?.organizationId) return null
    return query(
      collection(firestore, "users"),
      where("organizationId", "==", profile.organizationId)
    )
  }, [firestore, profile?.organizationId])

  const myInvitationsQuery = useMemoFirebase(() => {
    if (!firestore || !user?.email) return null
    return query(
      collection(firestore, "invitations"),
      where("email", "==", user.email.toLowerCase())
    )
  }, [firestore, user?.email])

  const { data: members, isLoading } = useCollection(membersQuery)
  const { data: myInvitations } = useCollection(myInvitationsQuery)

  const handleInvite = async () => {
    if (!firestore || !profile || !inviteEmail) return
    setIsInviting(true)
    try {
      const emailLower = inviteEmail.toLowerCase().trim()
      // 1. Check if user already exists
      const q = query(collection(firestore, "users"), where("email", "==", emailLower))
      const snap = await getDocs(q)
      
      if (!snap.empty) {
        const targetUser = snap.docs[0]
        const targetData = targetUser.data()
        
        if (targetData.organizationId && targetData.organizationId !== targetUser.id) {
           toast({ title: t("team_error"), description: t("team_user_already_in_org"), variant: "destructive" })
           setIsInviting(false)
           return
        }

        // Create an invitation record
        await setDoc(doc(firestore, "invitations", emailLower), {
          email: emailLower,
          name: inviteName || targetData.name || "",
          organizationId: profile.organizationId,
          organizationRole: "member",
          role: profile.role,
          invitedBy: user?.uid,
          invitedByName: profile.name,
          createdAt: new Date().toISOString(),
          isExistingUser: true
        })

        // Create notification for the user
        await addDoc(collection(firestore, "users", targetUser.id, "notifications"), {
          title: t("team_pending_invitations"),
          message: `${profile.name} ${t("team_invitation_to_join", { name: profile.companyName || profile.name || "" }).trim()}`,
          type: "invitation",
          organizationId: profile.organizationId,
          createdAt: new Date().toISOString(),
          read: false
        })

        toast({ title: t("team_invitation_sent"), description: t("team_invitation_sent_desc") })
      } else {
        // Create an invitation record for new user
        await setDoc(doc(firestore, "invitations", emailLower), {
          email: emailLower,
          name: inviteName,
          organizationId: profile.organizationId,
          organizationRole: "member",
          role: profile.role,
          invitedBy: user?.uid,
          invitedByName: profile.name,
          createdAt: new Date().toISOString(),
          isExistingUser: false
        })
        toast({ title: t("team_invite_sent"), description: t("team_invite_sent_desc") })
      }
      
      setIsInviteOpen(false)
      setInviteEmail("")
      setInviteName("")
    } catch (error: any) {
      console.error("❌ Invitation error:", error)
      toast({ 
        title: t("team_error"), 
        description: t("team_invite_failed", { message: error.message || t("team_unknown_error") }), 
        variant: "destructive" 
      })
    } finally {
      setIsInviting(false)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    if (!firestore || !profile || memberId === user?.uid) return
    try {
      // Revert user to their own organization (solo)
      await updateDoc(doc(firestore, "users", memberId), {
        organizationId: memberId,
        organizationRole: "owner"
      })
      toast({ title: t("team_removed"), description: t("team_removed_desc") })
    } catch (error) {
      toast({ title: t("team_error"), description: t("team_remove_failed"), variant: "destructive" })
    }
  }

  const handleAcceptInvitation = async (invitation: any) => {
    if (!firestore || !user || !profile) return
    setIsInviting(true)
    try {
      await updateDoc(doc(firestore, "users", user.uid), {
        organizationId: invitation.organizationId,
        organizationRole: invitation.organizationRole || "member",
        role: invitation.role || profile.role
      })
      await deleteDoc(doc(firestore, "invitations", user.email!.toLowerCase()))
      toast({ title: t("team_joined"), description: t("team_joined_desc") })
    } catch (error) {
      toast({ title: t("team_error"), description: t("team_join_failed"), variant: "destructive" })
    } finally {
      setIsInviting(false)
    }
  }

  const handleDeclineInvitation = async () => {
    if (!firestore || !user?.email) return
    try {
      await deleteDoc(doc(firestore, "invitations", user.email.toLowerCase()))
      toast({ title: t("team_declined"), description: t("team_declined_desc") })
    } catch (error) {
      toast({ title: t("team_error"), description: t("team_decline_failed"), variant: "destructive" })
    }
  }

  const filteredMembers = members?.filter(m => 
    m.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    m.email?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || []

  const isOwner = profile?.organizationRole === "owner"

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("team_page_title")}</h1>
            <p className="text-muted-foreground mt-1">{profile?.role === "Contractor" ? t("team_page_desc_contractor") : t("team_page_desc_supplier")}</p>
          </div>
          {isOwner && (
            <Button onClick={() => setIsInviteOpen(true)} className="gap-2 bg-primary hover:bg-primary/90 text-white rounded-xl">
              <UserPlus size={18} />
              {t("team_add_member")}
            </Button>
          )}
        </div>

        {myInvitations && myInvitations.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-secondary flex items-center gap-2">
              <Mail className="text-primary" size={20} />
              {t("team_pending_invitations")}
            </h2>
            {myInvitations.map((invite: any) => (
              <Card key={invite.id} className="border-primary/20 bg-primary/5 shadow-none overflow-hidden">
                <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <Users size={24} />
                    </div>
                    <div>
                      <p className="font-bold text-lg">{t("team_invitation_to_join", { name: invite.invitedByName || t("team_new_org") })}</p>
                      <p className="text-sm text-muted-foreground">{invite.organizationRole === "owner" ? t("team_invited_as_owner") : t("team_invited_as_member")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      onClick={() => handleAcceptInvitation(invite)} 
                      disabled={isInviting}
                      className="bg-primary text-white hover:bg-primary/90 rounded-xl px-6"
                    >
                      {t("team_accept")}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => handleDeclineInvitation()}
                      disabled={isInviting}
                      className="rounded-xl"
                    >
                      {t("team_decline")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card className="border-none shadow-sm">
          <CardHeader className="bg-white border-b flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="text-primary" size={20} />
              <CardTitle className="text-lg">{t("team_team_members")}</CardTitle>
            </div>
            <div className="relative w-64">
              <Search className={cn("absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground", locale === 'ar' ? 'right-3' : 'left-3')} />
              <Input 
                placeholder={t("team_search_member")} 
                className={cn("h-9", locale === 'ar' ? 'pr-10' : 'pl-10')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
            {isLoading ? (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="animate-spin" size={40} />
                <p>{t("team_loading")}</p>
              </div>
            ) : filteredMembers.length === 0 ? (
              <div className="p-20 text-center flex flex-col items-center gap-3 text-muted-foreground">
                <Users size={48} className="opacity-20" />
                <p className="text-lg font-bold">{t("team_no_members")}</p>
                <p className="text-sm">{t("team_no_members_desc")}</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className={cn(locale === 'ar' ? 'text-right' : 'text-left')}>{t("team_name")}</TableHead>
                    <TableHead className={cn(locale === 'ar' ? 'text-right' : 'text-left')}>{t("team_email")}</TableHead>
                    <TableHead className={cn(locale === 'ar' ? 'text-right' : 'text-left')}>{t("team_role")}</TableHead>
                    <TableHead className={cn(locale === 'ar' ? 'text-right' : 'text-left')}>{t("team_join_date")}</TableHead>
                    {isOwner && <TableHead className={cn(locale === 'ar' ? 'text-right' : 'text-left')}>{t("team_actions")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((member: any) => (
                    <TableRow key={member.id} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className={cn("font-bold", locale === 'ar' ? 'text-right' : 'text-left')}>
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-xs">
                            {member.name?.substring(0, 1) || "U"}
                          </div>
                          {member.name || t("team_new_user")}
                        </div>
                      </TableCell>
                      <TableCell className={cn(locale === 'ar' ? 'text-right' : 'text-left')}>{member.email}</TableCell>
                      <TableCell className={cn(locale === 'ar' ? 'text-right' : 'text-left')}>
                        {member.organizationRole === "owner" ? (
                          <Badge className="bg-amber-100 text-amber-700 border-none gap-1">
                            <Shield size={12} /> {t("team_ceo")}
                          </Badge>
                        ) : (
                          <Badge className="bg-blue-100 text-blue-700 border-none gap-1">
                            <ShieldCheck size={12} /> {t("team_team_member")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className={cn("text-xs text-muted-foreground", locale === 'ar' ? 'text-right' : 'text-left')} suppressHydrationWarning>
                        {member.createdAt ? new Date(member.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US') : "-"}
                      </TableCell>
                      {isOwner && (
                        <TableCell className={cn(locale === 'ar' ? 'text-right' : 'text-left')}>
                          {member.id !== user?.uid && (
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="text-destructive hover:bg-destructive/10"
                              onClick={() => handleRemoveMember(member.id)}
                            >
                              <Trash2 size={16} />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invite Dialog */}
      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent className="sm:max-w-md" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t("team_dialog_title")}</DialogTitle>
            <DialogDescription>
              {t("team_dialog_desc", { company: profile?.companyName || t("team_your_org") })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-name">{t("team_name_label")}</Label>
              <Input 
                id="invite-name" 
                value={inviteName} 
                onChange={(e) => setInviteName(e.target.value)} 
                placeholder={t("team_name_placeholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t("team_email_label")}</Label>
              <Input 
                id="invite-email" 
                type="email"
                value={inviteEmail} 
                onChange={(e) => setInviteEmail(e.target.value)} 
                placeholder="email@example.com"
                className="dir-ltr text-left"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsInviteOpen(false)} disabled={isInviting}>{t("team_cancel")}</Button>
            <Button onClick={handleInvite} disabled={!inviteEmail || isInviting} className="bg-primary text-white">
              {isInviting ? <Loader2 size={16} className="animate-spin ml-2" /> : <Mail size={16} className="ml-2" />}
              {t("team_send_invite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  )
}
