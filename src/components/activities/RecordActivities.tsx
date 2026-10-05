"use client"

// The follow-ups planned on one document, with a button to plan another. Drop it
// into any document's drawer or page with the document's `target`.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ListChecks, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/module-ui/Panel"
import { ActivityFormDialog } from "@/components/activities/ActivityFormDialog"
import { ActivityRow } from "@/components/activities/ActivityRow"
import { useUser } from "@/firebase"
import { useActivities } from "@/hooks/useActivities"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { forRecord, isOpen, targetKeyOf, type ActivityTarget } from "@/lib/activities"
import type { ActivityActor, ActivityPortal } from "@/lib/activity-writes"
import { todayDay } from "@/lib/pm/format"

export function RecordActivities({ target, portal, className }: { target: ActivityTarget; portal: ActivityPortal; className?: string }) {
  const t = useTranslations("Portal.Activities")
  const { user } = useUser()
  const { profile, organizationId } = useResolvedProfile(user?.uid)
  const { isOrgOwner } = usePermissions()
  const { activities } = useActivities(organizationId || null)
  const [adding, setAdding] = useState(false)
  const key = targetKeyOf(target)
  const rows = useMemo(() => (key ? forRecord(activities, key) : []), [activities, key])
  const openCount = rows.filter(isOpen).length
  const actor: ActivityActor = {
    uid: user?.uid ?? "",
    name: ((profile as { name?: string } | null)?.name || user?.displayName || user?.email || "") as string,
    isOwner: isOrgOwner,
  }

  return (
    <>
      <Panel
        className={className}
        title={t("record_title")}
        icon={ListChecks}
        count={openCount}
        bodyClassName="p-0"
        actions={
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={14} className="me-1" aria-hidden="true" />
            {t("record_add")}
          </Button>
        }
      >
        {rows.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-muted-foreground">{t("record_empty")}</p>
        ) : (
          <div className="divide-y">
            {rows.map((a) => (
              <ActivityRow key={a.id} activity={a} today={todayDay()} actor={actor} portal={portal} forOthers />
            ))}
          </div>
        )}
      </Panel>
      {adding && <ActivityFormDialog portal={portal} target={target} onClose={() => setAdding(false)} />}
    </>
  )
}
