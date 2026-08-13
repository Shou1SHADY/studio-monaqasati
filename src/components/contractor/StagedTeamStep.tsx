"use client"

// Project-creation wizard's team step: assigns EXISTING org members to the
// project being created. Selections live in local state only — nothing is
// written to Firestore until the wizard's final commit (see projects/new/page.tsx).
// Mirrors src/components/project-team.tsx's UI/query pattern, but that
// component writes immediately since it operates on an already-created project.

import { useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"
import { Users, UserPlus, Trash2, Shield } from "lucide-react"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { usePermissions } from "@/hooks/usePermissions"
import type { TeamGroup } from "@/lib/permissions"

export interface StagedMember {
  userId: string
  groupId: string
}

interface StagedTeamStepProps {
  organizationId: string | undefined
  staged: StagedMember[]
  onChange: (staged: StagedMember[]) => void
}

export function StagedTeamStep({ organizationId, staged, onChange }: StagedTeamStepProps) {
  const t = useTranslations("Portal.Shared")
  const { orgMembers } = useOrgMembers(organizationId)
  const { groups } = usePermissions()

  const [addUserId, setAddUserId] = useState("")
  const [addGroupId, setAddGroupId] = useState("")

  const displayGroupName = (g: TeamGroup) => (g.key ? t(`team_group_${g.key}`) : g.name)
  const memberById = (id: string) => orgMembers.find((m) => m.id === id)

  const stagedIds = new Set(staged.map((s) => s.userId))
  const assignable = orgMembers.filter((m) => !stagedIds.has(m.id) && m.organizationRole !== "owner")

  const handleAdd = () => {
    if (!addUserId || !addGroupId) return
    onChange([...staged, { userId: addUserId, groupId: addGroupId }])
    setAddUserId("")
    setAddGroupId("")
  }

  const handleChangeGroup = (userId: string, groupId: string) => {
    onChange(staged.map((s) => (s.userId === userId ? { ...s, groupId } : s)))
  }

  const handleRemove = (userId: string) => {
    onChange(staged.filter((s) => s.userId !== userId))
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-bold text-lg flex items-center gap-2">
          <Users size={18} className="text-primary" />
          {t("proj_team_title")}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{t("proj_team_desc")}</p>
      </div>

      <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200/60 text-amber-800 text-sm">
        <Shield size={15} className="shrink-0" />
        {t("proj_team_owner_note")}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={addUserId} onValueChange={setAddUserId}>
          <SelectTrigger className="sm:flex-1">
            <SelectValue placeholder={t("proj_team_pick_member")} />
          </SelectTrigger>
          <SelectContent>
            {assignable.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">{t("proj_team_no_assignable")}</div>
            ) : (
              assignable.map((m) => (
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
        <Button type="button" onClick={handleAdd} disabled={!addUserId || !addGroupId} className="gap-1.5">
          <UserPlus size={15} />
          {t("proj_team_add_btn")}
        </Button>
      </div>

      {staged.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <Users size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{t("proj_team_empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {staged.map((sm) => {
            const memberProfile = memberById(sm.userId)
            return (
              <div key={sm.userId} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200/70 bg-white">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-xs shrink-0">
                    {(memberProfile?.name || "U").substring(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{memberProfile?.name || sm.userId}</p>
                    <p className="text-xs text-muted-foreground truncate" dir="ltr">
                      {memberProfile?.email || ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Select value={sm.groupId} onValueChange={(v) => handleChangeGroup(sm.userId, v)}>
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
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    aria-label={t("proj_team_remove")}
                    onClick={() => handleRemove(sm.userId)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
