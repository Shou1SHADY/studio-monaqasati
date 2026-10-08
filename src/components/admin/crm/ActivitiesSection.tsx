"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ClipboardList, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { toDateKey, sortActivities, type CrmActivity } from "@/lib/admin-crm"
import { deleteActivity, setActivityDone, type Actor } from "@/lib/admin-crm-writes"
import type { StaffUser } from "@/hooks/useAdminCrm"
import { ActivityDialog, type Party } from "./ActivityDialog"
import { ActivityRow } from "./ActivityRow"
import { Section } from "./parts"

/** The activities of one lead or client, with the button that logs a new one (ADM-05, ADM-08). */
export function ActivitiesSection({
  recordId,
  activities,
  parties,
  staff,
  actor,
  systemDetail,
}: {
  recordId: string
  activities: CrmActivity[]
  parties: Party[]
  staff: StaffUser[]
  actor: Actor
  /** Under the platform's conversion line: what came over from the lead. */
  systemDetail?: string
}) {
  const t = useTranslations("Portal.Admin.Crm")
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = toDateKey(new Date())
  const [dialog, setDialog] = useState<{ open: boolean; activity: CrmActivity | null }>({ open: false, activity: null })

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  return (
    <Section
      icon={ClipboardList}
      title={t("activities_title")}
      count={activities.length}
      action={
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog({ open: true, activity: null })}>
          <Plus size={14} aria-hidden="true" />
          {t("activity_log")}
        </Button>
      }
    >
      {activities.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{t("history_empty")}</p>
      ) : (
        <ul className="divide-y">
          {sortActivities(activities).map((a) => (
            <ActivityRow
              key={a.id}
              a={a}
              today={today}
              detail={a.system ? systemDetail : undefined}
              onToggle={(x) => firestore && run(() => setActivityDone(firestore, x.id, x.status === "scheduled", today, x.type))}
              onEdit={(x) => setDialog({ open: true, activity: x })}
              onDelete={(x) => firestore && run(() => deleteActivity(firestore, x.id))}
            />
          ))}
        </ul>
      )}
      <ActivityDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        parties={parties}
        staff={staff}
        actor={actor}
        presetClientId={recordId}
        activity={dialog.activity}
      />
    </Section>
  )
}
