"use client"

import { useTranslations } from "next-intl"
import { ListChecks } from "lucide-react"
import { useUser } from "@/firebase"
import { useMyActivities } from "@/hooks/useActivities"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { Link } from "@/i18n/routing"
import type { ActivityPortal } from "@/lib/activity-writes"
import { cn } from "@/lib/utils"

/** Header shortcut to "My to-dos", with what is overdue or due today. */
export function ActivityBell({ portal }: { portal: ActivityPortal }) {
  const t = useTranslations("Portal.Activities")
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const { counts } = useMyActivities(organizationId || null, user?.uid)
  return (
    <Link
      href={`/${portal}/activities`}
      aria-label={counts.due > 0 ? t("bell_due", { n: counts.due }) : t("title")}
      title={t("title")}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ListChecks size={20} aria-hidden="true" />
      {counts.due > 0 && (
        <span className={cn("absolute top-0 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white end-0", counts.overdue > 0 ? "bg-destructive" : "bg-warning")}>{counts.due}</span>
      )}
    </Link>
  )
}
