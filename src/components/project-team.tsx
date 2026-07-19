"use client"

// Per-project team assignments: which org members work on this project and
// with which permission group. A project-level group overrides the member's
// default group for everything inside this project.

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUser, useFirestore, useCollection, useMemoFirebase } from "@/firebase"
import { collection, query, where, doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useTranslations } from "next-intl"
import { Users, UserPlus, Trash2, Shield, Loader2 } from "lucide-react"
import { usePermissions } from "@/hooks/usePermissions"
import { type TeamGroup } from "@/lib/permissions"
import { logTeamActivity } from "@/lib/team-activity"

interface ProjectTeamSectionProps {
  projectId: string
  organizationId: string
}

export function ProjectTeamSection({ projectId, organizationId }: ProjectTeamSectionProps) {
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const t = useTranslations("Portal.Shared")
  const { isOrgOwner, groups, profile } = usePermissions()

  const logActivity = (type: "project_member_added" | "project_member_removed", targetName: string) => {
    if (!firestore || !user || !organizationId) return
    logTeamActivity(firestore, {
      organizationId,
      type,
      actorId: user.uid,
      actorName: (profile?.name as string) || user.email || "",
      targetName,
    })
  }

  const [addUserId, setAddUserId] = useState<string>("")
  const [addGroupId, setAddGroupId] = useState<string>("")
  const [isAdding, setIsAdding] = useState(false)

  const membersQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "users"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: orgMembers } = useCollection(membersQuery)

  const projectMembersQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return collection(firestore, "projects", projectId, "members")
  }, [firestore, projectId])
  const { data: projectMembers, isLoading } = useCollection(projectMembersQuery)

  const displayGroupName = (g: TeamGroup) => (g.key ? t(`team_group_${g.key}`) : g.name)
  const groupById = (id: string | null | undefined) => groups.find((g) => g.id === id)
  const orgMemberById = (id: string) => (orgMembers || []).find((m: any) => m.id === id)

  // Org members not yet assigned to this project (owners are implicit super admins)
  const assignedIds = new Set((projectMembers || []).map((pm: any) => pm.id))
  const assignable = ((orgMembers || []) as any[]).filter(
    (m) => !assignedIds.has(m.id) && m.organizationRole !== "owner"
  )

  const handleAdd = async () => {
    if (!firestore || !user || !addUserId || !addGroupId) return
    setIsAdding(true)
    try {
      await setDoc(doc(firestore, "projects", projectId, "members", addUserId), {
        userId: addUserId,
        groupId: addGroupId,
        organizationId,
        addedBy: user.uid,
        createdAt: serverTimestamp(),
      })
      logActivity("project_member_added", orgMemberById(addUserId)?.name || "")
      toast({ title: t("proj_team_added") })
      setAddUserId("")
      setAddGroupId("")
    } catch (err) {
      console.error("Failed to add project member:", err)
      toast({ title: t("team_error"), description: t("team_unknown_error"), variant: "destructive" })
    } finally {
      setIsAdding(false)
    }
  }

  const handleChangeGroup = async (memberId: string, groupId: string) => {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, "projects", projectId, "members", memberId), { groupId })
      toast({ title: t("team_group_assigned") })
    } catch {
      toast({ title: t("team_error"), description: t("team_unknown_error"), variant: "destructive" })
    }
  }

  const handleRemove = async (memberId: string) => {
    if (!firestore) return
    try {
      await deleteDoc(doc(firestore, "projects", projectId, "members", memberId))
      logActivity("project_member_removed", orgMemberById(memberId)?.name || "")
      toast({ title: t("proj_team_removed") })
    } catch {
      toast({ title: t("team_error"), description: t("team_unknown_error"), variant: "destructive" })
    }
  }

  return (
    <Card className="border-primary/15">
      <CardContent className="p-6 space-y-5">
        <div>
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Users size={18} className="text-primary" />
            {t("proj_team_title")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">{t("proj_team_desc")}</p>
        </div>

        {/* Owners note: they always have full access */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200/60 text-amber-800 text-sm">
          <Shield size={15} className="shrink-0" />
          {t("proj_team_owner_note")}
        </div>

        {/* Add member (owner only) */}
        {isOrgOwner && (
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={addUserId} onValueChange={setAddUserId}>
              <SelectTrigger className="sm:flex-1">
                <SelectValue placeholder={t("proj_team_pick_member")} />
              </SelectTrigger>
              <SelectContent>
                {assignable.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">{t("proj_team_no_assignable")}</div>
                ) : (
                  assignable.map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name || m.email}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Select value={addGroupId} onValueChange={setAddGroupId}>
              <SelectTrigger className="sm:w-52">
                <SelectValue placeholder={t("proj_team_pick_group")} />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {displayGroupName(g)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAdd} disabled={!addUserId || !addGroupId || isAdding} className="gap-1.5">
              {isAdding ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
              {t("proj_team_add_btn")}
            </Button>
          </div>
        )}

        {/* Assigned members */}
        {isLoading ? (
          <div className="p-10 flex items-center justify-center">
            <Loader2 className="animate-spin text-muted-foreground" size={28} />
          </div>
        ) : (projectMembers || []).length === 0 ? (
          <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
            <Users size={36} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">{t("proj_team_empty")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(projectMembers || []).map((pm: any) => {
              const memberProfile = orgMemberById(pm.id)
              const group = groupById(pm.groupId)
              return (
                <div
                  key={pm.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200/70 bg-white"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-xs shrink-0">
                      {(memberProfile?.name || "U").substring(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{memberProfile?.name || pm.userId}</p>
                      <p className="text-xs text-muted-foreground truncate" dir="ltr">
                        {memberProfile?.email || ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isOrgOwner ? (
                      <>
                        <Select value={pm.groupId || ""} onValueChange={(v) => handleChangeGroup(pm.id, v)}>
                          <SelectTrigger className="h-8 w-40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {groups.map((g) => (
                              <SelectItem key={g.id} value={g.id}>
                                {displayGroupName(g)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          aria-label={t("proj_team_remove")}
                          onClick={() => handleRemove(pm.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </>
                    ) : group ? (
                      <Badge className="bg-accent/15 text-cta border-none">{displayGroupName(group)}</Badge>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
