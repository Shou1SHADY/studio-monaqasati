"use client"

import { useState, useEffect, useRef } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc } from "@/firebase"
import {
  collection,
  query,
  where,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  addDoc,
  serverTimestamp,
  getDocsFromServer,
} from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useTranslations, useLocale } from "next-intl"
import {
  Users,
  UserPlus,
  Trash2,
  Mail,
  Shield,
  ShieldCheck,
  Loader2,
  Search,
  Layers,
  Pencil,
  Send,
  XCircle,
  Lock,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { logTeamActivity, type TeamActivityType } from "@/lib/team-activity"
import { History } from "lucide-react"
import {
  PERMISSION_IDS,
  permissionLabelKey,
  SEEDED_GROUPS,
  seededGroupDocId,
  isSuperAdminGroup,
  ALL_PERMISSION,
  type TeamGroup,
  type PermissionValue,
} from "@/lib/permissions"

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
  const [inviteGroupId, setInviteGroupId] = useState<string>("none")
  const [isInviting, setIsInviting] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)

  // Group editor dialog state
  const [groupDialog, setGroupDialog] = useState<"closed" | "new" | string>("closed") // string = editing group id
  const [groupName, setGroupName] = useState("")
  const [groupPerms, setGroupPerms] = useState<Set<string>>(new Set())
  const [isSavingGroup, setIsSavingGroup] = useState(false)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const orgId = profile?.organizationId as string | undefined
  const isOwner = profile?.organizationRole === "owner"

  const membersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "users"), where("organizationId", "==", orgId))
  }, [firestore, orgId])

  const groupsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "teamGroups"), where("organizationId", "==", orgId))
  }, [firestore, orgId])

  const myInvitationsQuery = useMemoFirebase(() => {
    if (!firestore || !user?.email) return null
    return query(collection(firestore, "invitations"), where("email", "==", user.email.toLowerCase()))
  }, [firestore, user?.email])

  // Invitations I sent (owner: manage pending team invites)
  const sentInvitationsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !isOwner) return null
    return query(collection(firestore, "invitations"), where("invitedBy", "==", user.uid))
  }, [firestore, user, isOwner])

  const activityQuery = useMemoFirebase(() => {
    if (!firestore || !orgId || !isOwner) return null
    return query(collection(firestore, "teamActivity"), where("organizationId", "==", orgId))
  }, [firestore, orgId, isOwner])

  const { data: members, isLoading } = useCollection(membersQuery)
  const { data: groupsRaw, isLoading: groupsLoading } = useCollection(groupsQuery)
  const { data: myInvitations } = useCollection(myInvitationsQuery)
  const { data: sentInvitationsRaw } = useCollection(sentInvitationsQuery)
  const { data: activityRaw } = useCollection(activityQuery)

  const activities = ((activityRaw || []) as any[])
    .slice()
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 50)

  const logActivity = (type: TeamActivityType, targetName?: string) => {
    if (!firestore || !orgId || !user) return
    logTeamActivity(firestore, {
      organizationId: orgId,
      type,
      actorId: user.uid,
      actorName: (profile?.name as string) || user.email || "",
      targetName,
    })
  }

  const groups = ((groupsRaw || []) as TeamGroup[]).slice().sort((a, b) => {
    // System group first, then seeded, then custom by name
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1
    return (a.name || "").localeCompare(b.name || "")
  })

  // Incoming team invitations addressed to me: new token-based format + legacy
  // email-doc-id format (no type/status fields).
  const incomingInvites = ((myInvitations || []) as any[]).filter(
    (inv) =>
      (inv.type === "team_invite" && inv.status === "pending") ||
      (!inv.type && !inv.status && inv.organizationId)
  )

  const sentTeamInvitations = ((sentInvitationsRaw || []) as any[])
    .filter((inv) => inv.type === "team_invite")
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))

  // Seed the default permission groups once per organization (owner only).
  // Deterministic doc ids make concurrent seeding idempotent. The local
  // snapshot can come from an empty offline cache, so confirm against the
  // server before writing — re-running setDoc on existing docs would be an
  // update, which the rules (rightly) reject for the Super Admin group.
  const seededRef = useRef(false)
  useEffect(() => {
    if (!firestore || !orgId || !isOwner || groupsLoading || seededRef.current) return
    if ((groupsRaw || []).length > 0) return
    seededRef.current = true
    const seed = async () => {
      try {
        const serverSnap = await getDocsFromServer(
          query(collection(firestore, "teamGroups"), where("organizationId", "==", orgId))
        )
        if (!serverSnap.empty) return
        await Promise.all(
          SEEDED_GROUPS.map((g) =>
            setDoc(doc(firestore, "teamGroups", seededGroupDocId(orgId, g.key)), {
              organizationId: orgId,
              key: g.key,
              name: g.name,
              permissions: g.permissions,
              isSystem: g.isSystem,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          )
        )
      } catch (err) {
        console.error("Failed to seed default groups:", err)
      }
    }
    seed()
  }, [firestore, orgId, isOwner, groupsLoading, groupsRaw])

  const displayGroupName = (g: TeamGroup) => (g.key ? t(`team_group_${g.key}`) : g.name)
  const groupById = (id: string | null | undefined) => groups.find((g) => g.id === id)

  // ----- Invite flow (server route: email + token + group) -----
  const handleInvite = async () => {
    if (!user || !inviteEmail) return
    setIsInviting(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/invitations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          type: "team_invite",
          email: inviteEmail.trim(),
          name: inviteName.trim() || undefined,
          groupId: inviteGroupId !== "none" ? inviteGroupId : undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        const code = data?.code
        let message = data?.message || t("team_unknown_error")
        if (code === "ALREADY_MEMBER") message = t("team_user_already_in_org")
        if (code === "TARGET_IN_OTHER_ORG") message = t("team_user_already_in_org")
        if (code === "SELF_INVITE") message = t("team_self_invite")
        toast({ title: t("team_error"), description: message, variant: "destructive" })
        return
      }
      toast({
        title: t("team_invitation_sent"),
        description: data.data?.emailSent ? t("team_email_sent_desc") : t("team_email_skipped_desc"),
      })
      setIsInviteOpen(false)
      setInviteEmail("")
      setInviteName("")
      setInviteGroupId("none")
    } catch (error: any) {
      console.error("❌ Invitation error:", error)
      toast({
        title: t("team_error"),
        description: t("team_invite_failed", { message: error.message || t("team_unknown_error") }),
        variant: "destructive",
      })
    } finally {
      setIsInviting(false)
    }
  }

  const handleResendInvite = async (inv: any) => {
    if (!user) return
    setProcessingId(inv.id)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/invitations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          type: "team_invite",
          email: inv.email,
          name: inv.name || undefined,
          groupId: inv.groupId || undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success) {
        toast({
          title: t("team_invitation_sent"),
          description: data.data?.emailSent ? t("team_email_sent_desc") : t("team_email_skipped_desc"),
        })
      } else {
        toast({ title: t("team_error"), description: data?.message || t("team_unknown_error"), variant: "destructive" })
      }
    } catch {
      toast({ title: t("team_error"), description: t("team_unknown_error"), variant: "destructive" })
    } finally {
      setProcessingId(null)
    }
  }

  const handleCancelInvite = async (inv: any) => {
    if (!firestore) return
    setProcessingId(inv.id)
    try {
      await updateDoc(doc(firestore, "invitations", inv.id), { status: "cancelled" })
      toast({ title: t("team_invite_cancelled") })
    } catch {
      toast({ title: t("team_error"), description: t("team_unknown_error"), variant: "destructive" })
    } finally {
      setProcessingId(null)
    }
  }

  // ----- Member management -----
  const confirmRemoveMember = async () => {
    if (!firestore || !profile || !removeTarget || removeTarget.id === user?.uid) return
    try {
      // Revert user to their own organization (solo)
      await updateDoc(doc(firestore, "users", removeTarget.id), {
        organizationId: removeTarget.id,
        organizationRole: "owner",
        defaultGroupId: null,
      })
      logActivity("member_removed", removeTarget.name)
      toast({ title: t("team_removed"), description: t("team_removed_desc") })
    } catch {
      toast({ title: t("team_error"), description: t("team_remove_failed"), variant: "destructive" })
    } finally {
      setRemoveTarget(null)
    }
  }

  const handleSetMemberGroup = async (memberId: string, groupId: string) => {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, "users", memberId), {
        defaultGroupId: groupId === "none" ? null : groupId,
      })
      const memberName = (members || []).find((m: any) => m.id === memberId)?.name || ""
      logActivity("member_group_changed", memberName)
      toast({ title: t("team_group_assigned") })
    } catch {
      toast({ title: t("team_error"), description: t("team_unknown_error"), variant: "destructive" })
    }
  }

  // ----- Incoming invitation actions -----
  const handleAcceptInvitation = async (invitation: any) => {
    if (!firestore || !user || !profile) return
    setIsInviting(true)
    try {
      if (invitation.inviteToken) {
        // Token-based invite: server-side accept (Admin SDK sets org fields).
        const idToken = await user.getIdToken()
        const res = await fetch("/api/invitations/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ token: invitation.inviteToken }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) throw new Error(data?.message || "accept failed")
      } else {
        // Legacy invite (email-as-doc-id, no token): client-side accept.
        await updateDoc(doc(firestore, "users", user.uid), {
          organizationId: invitation.organizationId,
          organizationRole: invitation.organizationRole || "member",
          role: invitation.role || profile.role,
        })
        await deleteDoc(doc(firestore, "invitations", invitation.id))
      }
      toast({ title: t("team_joined"), description: t("team_joined_desc") })
    } catch (error) {
      console.error("❌ Accept invitation error:", error)
      toast({ title: t("team_error"), description: t("team_join_failed"), variant: "destructive" })
    } finally {
      setIsInviting(false)
    }
  }

  const handleDeclineInvitation = async (invitation: any) => {
    if (!firestore) return
    try {
      if (invitation.type === "team_invite") {
        await updateDoc(doc(firestore, "invitations", invitation.id), { status: "declined" })
      } else {
        await deleteDoc(doc(firestore, "invitations", invitation.id))
      }
      toast({ title: t("team_declined"), description: t("team_declined_desc") })
    } catch {
      toast({ title: t("team_error"), description: t("team_decline_failed"), variant: "destructive" })
    }
  }

  // ----- Group editor -----
  const openGroupDialog = (g?: TeamGroup) => {
    if (g) {
      setGroupDialog(g.id)
      setGroupName(g.key ? displayGroupName(g) : g.name)
      setGroupPerms(new Set(g.permissions.filter((p) => p !== ALL_PERMISSION)))
    } else {
      setGroupDialog("new")
      setGroupName("")
      setGroupPerms(new Set())
    }
  }

  const handleSaveGroup = async () => {
    if (!firestore || !orgId || !groupName.trim()) return
    setIsSavingGroup(true)
    try {
      const permissions = Array.from(groupPerms) as PermissionValue[]
      if (groupDialog === "new") {
        await addDoc(collection(firestore, "teamGroups"), {
          organizationId: orgId,
          key: null,
          name: groupName.trim(),
          permissions,
          isSystem: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        logActivity("group_created", groupName.trim())
        toast({ title: t("team_group_created") })
      } else {
        const existing = groupById(groupDialog)
        await updateDoc(doc(firestore, "teamGroups", groupDialog), {
          // Renaming a seeded group turns it into a custom-named group
          ...(existing?.key && groupName.trim() !== displayGroupName(existing)
            ? { name: groupName.trim(), key: null }
            : { name: groupName.trim() }),
          permissions,
          updatedAt: serverTimestamp(),
        })
        logActivity("group_updated", groupName.trim())
        toast({ title: t("team_group_updated") })
      }
      setGroupDialog("closed")
    } catch (err) {
      console.error("Failed to save group:", err)
      toast({ title: t("team_error"), description: t("team_unknown_error"), variant: "destructive" })
    } finally {
      setIsSavingGroup(false)
    }
  }

  const handleDeleteGroup = async (g: TeamGroup) => {
    if (!firestore) return
    const inUse = (members || []).some((m: any) => m.defaultGroupId === g.id)
    if (inUse) {
      toast({ title: t("team_error"), description: t("team_group_delete_in_use"), variant: "destructive" })
      return
    }
    try {
      await deleteDoc(doc(firestore, "teamGroups", g.id))
      logActivity("group_deleted", displayGroupName(g))
      toast({ title: t("team_group_deleted") })
    } catch {
      toast({ title: t("team_error"), description: t("team_unknown_error"), variant: "destructive" })
    }
  }

  const togglePerm = (perm: string) => {
    setGroupPerms((prev) => {
      const next = new Set(prev)
      if (next.has(perm)) next.delete(perm)
      else next.add(perm)
      return next
    })
  }

  const filteredMembers =
    members?.filter(
      (m) =>
        m.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.email?.toLowerCase().includes(searchQuery.toLowerCase())
    ) || []

  const memberJoinDate = (member: any): string => {
    const raw = member.joinedAt?.toDate ? member.joinedAt.toDate() : member.createdAt ? new Date(member.createdAt) : null
    if (!raw || isNaN(raw.getTime())) return "-"
    return raw.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US")
  }

  const editedGroup = typeof groupDialog === "string" && groupDialog !== "closed" && groupDialog !== "new" ? groupById(groupDialog) : undefined
  const editingSystemGroup = editedGroup ? isSuperAdminGroup(editedGroup) : false

  const invStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-amber-100 text-amber-700 border-none">{t("team_status_pending")}</Badge>
      case "accepted":
        return <Badge className="bg-green-100 text-green-700 border-none">{t("team_status_accepted")}</Badge>
      case "declined":
        return <Badge className="bg-red-100 text-red-700 border-none">{t("team_status_declined")}</Badge>
      case "cancelled":
        return <Badge className="bg-slate-100 text-slate-500 border-none">{t("team_status_cancelled")}</Badge>
      default:
        return <Badge className="bg-slate-100 text-slate-500 border-none">{status}</Badge>
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("team_page_title")}</h1>
            <p className="text-muted-foreground mt-1">
              {(profile?.role || role) === "Contractor" ? t("team_page_desc_contractor") : t("team_page_desc_supplier")}
            </p>
          </div>
          {isOwner && (
            <Button
              onClick={() => setIsInviteOpen(true)}
              className="gap-2 bg-primary hover:bg-primary/90 text-white rounded-xl"
            >
              <UserPlus size={18} />
              {t("team_add_member")}
            </Button>
          )}
        </div>

        {/* Incoming invitations for the current user */}
        {incomingInvites.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-secondary flex items-center gap-2">
              <Mail className="text-primary" size={20} />
              {t("team_pending_invitations")}
            </h2>
            {incomingInvites.map((invite: any) => (
              <Card key={invite.id} className="border-primary/20 bg-primary/5 shadow-none overflow-hidden">
                <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <Users size={24} />
                    </div>
                    <div>
                      <p className="font-bold text-lg">
                        {t("team_invitation_to_join", {
                          name: invite.organizationName || invite.invitedByName || t("team_new_org"),
                        })}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {invite.organizationRole === "owner" ? t("team_invited_as_owner") : t("team_invited_as_member")}
                      </p>
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
                      onClick={() => handleDeclineInvitation(invite)}
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

        <Tabs defaultValue="members" dir={locale === "ar" ? "rtl" : "ltr"}>
          <TabsList className="mb-4 max-w-full justify-start overflow-x-auto scrollbar-hide">
            <TabsTrigger value="members" className="gap-2">
              <Users size={14} />
              {t("team_tab_members")}
              {(members || []).length > 0 && (
                <Badge className="bg-primary/10 text-primary text-[10px] px-1.5 py-0 h-4 min-w-4 ms-1 border-none">
                  {(members || []).length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="groups" className="gap-2">
              <Layers size={14} />
              {t("team_tab_groups")}
            </TabsTrigger>
            {isOwner && (
              <TabsTrigger value="sent" className="gap-2">
                <Send size={14} />
                {t("team_tab_sent")}
                {sentTeamInvitations.filter((i) => i.status === "pending").length > 0 && (
                  <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 h-4 min-w-4 ms-1 border-none">
                    {sentTeamInvitations.filter((i) => i.status === "pending").length}
                  </Badge>
                )}
              </TabsTrigger>
            )}
            {isOwner && (
              <TabsTrigger value="activity" className="gap-2">
                <History size={14} />
                {t("team_tab_activity")}
              </TabsTrigger>
            )}
          </TabsList>

          {/* ================= MEMBERS ================= */}
          <TabsContent value="members">
            <Card className="border-none shadow-sm">
              <CardHeader className="bg-white border-b flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="text-primary" size={20} />
                  <CardTitle className="text-lg">{t("team_team_members")}</CardTitle>
                </div>
                <div className="relative w-64">
                  <Search
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground",
                      locale === "ar" ? "right-3" : "left-3"
                    )}
                  />
                  <Input
                    placeholder={t("team_search_member")}
                    className={cn("h-9", locale === "ar" ? "pr-10" : "pl-10")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
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
                        <TableHead className={cn(locale === "ar" ? "text-right" : "text-left")}>{t("team_name")}</TableHead>
                        <TableHead className={cn(locale === "ar" ? "text-right" : "text-left")}>{t("team_email")}</TableHead>
                        <TableHead className={cn(locale === "ar" ? "text-right" : "text-left")}>{t("team_role")}</TableHead>
                        <TableHead className={cn(locale === "ar" ? "text-right" : "text-left")}>{t("team_group_column")}</TableHead>
                        <TableHead className={cn(locale === "ar" ? "text-right" : "text-left")}>{t("team_join_date")}</TableHead>
                        {isOwner && (
                          <TableHead className={cn(locale === "ar" ? "text-right" : "text-left")}>{t("team_actions")}</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMembers.map((member: any) => {
                        const memberGroup = groupById(member.defaultGroupId)
                        const memberIsOwner = member.organizationRole === "owner"
                        return (
                          <TableRow key={member.id} className="hover:bg-slate-50/50 transition-colors">
                            <TableCell className={cn("font-bold", locale === "ar" ? "text-right" : "text-left")}>
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-xs">
                                  {member.name?.substring(0, 1) || "U"}
                                </div>
                                {member.name || t("team_new_user")}
                              </div>
                            </TableCell>
                            <TableCell className={cn(locale === "ar" ? "text-right" : "text-left")}>{member.email}</TableCell>
                            <TableCell className={cn(locale === "ar" ? "text-right" : "text-left")}>
                              {memberIsOwner ? (
                                <Badge className="bg-amber-100 text-amber-700 border-none gap-1">
                                  <Shield size={12} /> {t("team_ceo")}
                                </Badge>
                              ) : (
                                <Badge className="bg-blue-100 text-blue-700 border-none gap-1">
                                  <ShieldCheck size={12} /> {t("team_team_member")}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className={cn(locale === "ar" ? "text-right" : "text-left")}>
                              {memberIsOwner ? (
                                <Badge className="bg-purple-100 text-purple-700 border-none gap-1">
                                  <Layers size={12} /> {t("team_group_all_permissions")}
                                </Badge>
                              ) : isOwner ? (
                                <Select
                                  value={member.defaultGroupId || "none"}
                                  onValueChange={(v) => handleSetMemberGroup(member.id, v)}
                                >
                                  <SelectTrigger className="h-8 w-44 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">{t("team_no_group")}</SelectItem>
                                    {groups.map((g) => (
                                      <SelectItem key={g.id} value={g.id}>
                                        {displayGroupName(g)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : memberGroup ? (
                                <Badge className="bg-accent/15 text-cta border-none">{displayGroupName(memberGroup)}</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">{t("team_no_group")}</span>
                              )}
                            </TableCell>
                            <TableCell
                              className={cn("text-xs text-muted-foreground", locale === "ar" ? "text-right" : "text-left")}
                              suppressHydrationWarning
                            >
                              {memberJoinDate(member)}
                            </TableCell>
                            {isOwner && (
                              <TableCell className={cn(locale === "ar" ? "text-right" : "text-left")}>
                                {member.id !== user?.uid && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive hover:bg-destructive/10"
                                    aria-label={t("team_remove_confirm_action")}
                                    onClick={() => setRemoveTarget({ id: member.id, name: member.name || member.email || "" })}
                                  >
                                    <Trash2 size={16} />
                                  </Button>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= GROUPS ================= */}
          <TabsContent value="groups">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{t("team_groups_desc")}</p>
                {isOwner && (
                  <Button onClick={() => openGroupDialog()} variant="outline" className="gap-2 rounded-xl">
                    <Layers size={16} />
                    {t("team_new_group")}
                  </Button>
                )}
              </div>
              {groupsLoading ? (
                <div className="p-16 flex items-center justify-center">
                  <Loader2 className="animate-spin text-muted-foreground" size={32} />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {groups.map((g) => {
                    const superAdmin = isSuperAdminGroup(g)
                    const count = (members || []).filter((m: any) =>
                      m.organizationRole === "owner" ? superAdmin : m.defaultGroupId === g.id
                    ).length
                    return (
                      <Card key={g.id} className={cn("shadow-sm", superAdmin ? "border-amber-200 bg-amber-50/40" : "border-slate-200")}>
                        <CardContent className="p-5 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {superAdmin ? <Lock size={16} className="text-amber-600" /> : <Layers size={16} className="text-primary" />}
                              <p className="font-bold">{displayGroupName(g)}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-xs">
                                {t("team_group_members_count", { count })}
                              </Badge>
                              {isOwner && !superAdmin && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label={t("team_edit_group")}
                                    onClick={() => openGroupDialog(g)}
                                  >
                                    <Pencil size={14} />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                    aria-label={t("team_delete_group")}
                                    onClick={() => handleDeleteGroup(g)}
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {superAdmin ? (
                              <Badge className="bg-amber-100 text-amber-700 border-none">{t("team_group_all_permissions")}</Badge>
                            ) : g.permissions.length === 0 ? (
                              <span className="text-xs text-muted-foreground">{t("team_group_view_only")}</span>
                            ) : (
                              g.permissions
                                .filter((p): p is Exclude<PermissionValue, "*"> => p !== ALL_PERMISSION)
                                .map((p) => (
                                  <Badge key={p} variant="outline" className="text-xs font-normal">
                                    {t(permissionLabelKey(p))}
                                  </Badge>
                                ))
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ================= SENT INVITATIONS ================= */}
          {isOwner && (
            <TabsContent value="sent">
              {sentTeamInvitations.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                  <Send size={48} className="text-muted-foreground/30" />
                  <div>
                    <p className="text-muted-foreground font-medium">{t("team_sent_empty")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("team_sent_empty_desc")}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {sentTeamInvitations.map((inv: any) => {
                    const invGroup = groupById(inv.groupId)
                    return (
                      <div
                        key={inv.id}
                        className="p-4 rounded-xl border border-slate-200/70 bg-white flex flex-col md:flex-row md:items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{inv.name || inv.email}</p>
                          <p className="text-xs text-muted-foreground truncate" dir="ltr">
                            {inv.email}
                          </p>
                          {invGroup && (
                            <Badge variant="outline" className="text-xs mt-1">
                              {displayGroupName(invGroup)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {invStatusBadge(inv.status)}
                          {inv.status === "pending" && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1 rounded-lg"
                                disabled={processingId === inv.id}
                                onClick={() => handleResendInvite(inv)}
                              >
                                {processingId === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                {t("team_resend")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 rounded-lg text-destructive hover:bg-destructive/10"
                                disabled={processingId === inv.id}
                                onClick={() => handleCancelInvite(inv)}
                              >
                                <XCircle size={14} />
                                {t("team_cancel_invite")}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </TabsContent>
          )}

          {/* ================= ACTIVITY ================= */}
          {isOwner && (
            <TabsContent value="activity">
              {activities.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                  <History size={48} className="text-muted-foreground/30" />
                  <p className="text-muted-foreground font-medium">{t("team_activity_empty")}</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {activities.map((a: any) => (
                    <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg bg-white border border-slate-200/60">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                        <History size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-700">
                          {t(`activity_${a.type}`, { actor: a.actorName || "", target: a.targetName || "" })}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0" suppressHydrationWarning>
                        {a.createdAt?.toDate
                          ? a.createdAt.toDate().toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Invite Dialog */}
      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent className="sm:max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
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
            <div className="space-y-2">
              <Label>{t("team_group_label")}</Label>
              <Select value={inviteGroupId} onValueChange={setInviteGroupId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("team_no_group")}</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {displayGroupName(g)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("team_group_hint")}</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" onClick={() => setIsInviteOpen(false)} disabled={isInviting}>
              {t("team_cancel")}
            </Button>
            <Button onClick={handleInvite} disabled={!inviteEmail || isInviting} className="bg-primary text-white gap-2">
              {isInviting ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
              {t("team_send_invite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group editor dialog */}
      <Dialog open={groupDialog !== "closed"} onOpenChange={(open) => !open && setGroupDialog("closed")}>
        <DialogContent className="sm:max-w-lg" dir={locale === "ar" ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{groupDialog === "new" ? t("team_new_group") : t("team_edit_group")}</DialogTitle>
            <DialogDescription>{t("team_groups_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="group-name">{t("team_group_name_label")}</Label>
              <Input
                id="group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={t("team_group_name_placeholder")}
                disabled={editingSystemGroup}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("team_group_permissions_label")}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto rounded-lg border p-3">
                {PERMISSION_IDS.map((perm) => (
                  <label
                    key={perm}
                    className="flex items-center gap-2 text-sm cursor-pointer rounded-md p-1.5 hover:bg-slate-50"
                  >
                    <Checkbox
                      checked={groupPerms.has(perm)}
                      onCheckedChange={() => togglePerm(perm)}
                      disabled={editingSystemGroup}
                    />
                    <span>{t(permissionLabelKey(perm))}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" onClick={() => setGroupDialog("closed")} disabled={isSavingGroup}>
              {t("team_cancel")}
            </Button>
            <Button
              onClick={handleSaveGroup}
              disabled={!groupName.trim() || isSavingGroup || editingSystemGroup}
              className="bg-primary text-white"
            >
              {isSavingGroup ? <Loader2 size={16} className="animate-spin" /> : t("team_group_save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove-member confirmation */}
      <AlertDialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("team_remove_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("team_remove_confirm_desc", { name: removeTarget?.name || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel>{t("team_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("team_remove_confirm_action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  )
}
