"use client"

import { useLocale, useTranslations } from "next-intl"
import { ArrowUpRight, Inbox } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { BUCKET_TONE } from "@/components/activities/ActivityRow"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { Link } from "@/i18n/routing"
import { daysBetween, dueLabel } from "@/lib/activities"
import { pmDate } from "@/lib/pm/format"
import { taskTitle, type QueueTask } from "@/lib/work-queue-tasks"
import { cn } from "@/lib/utils"

const TONE: Record<QueueTask["bucket"], PillTone> = { overdue: "bad", today: "warn", planned: "ok" }

export function QueueTaskRow({ task, today, layout = "row" }: { task: QueueTask; today: string; layout?: "row" | "card" }) {
  const t = useTranslations("Portal.Activities")
  const tc = useTranslations("Portal.Contractor")
  const tsb = useTranslations("Portal.Sidebar")
  const locale = useLocale()
  const due = dueLabel(task, today)
  const waited = daysBetween(task.dueOn, today)
  const since = task.dated && !task.deadline

  const pill = task.deadline
    ? t(`due_${due.kind}`, { n: due.days })
    : !task.dated
      ? t("queue_now")
      : waited > 0
        ? t("queue_waiting", { n: waited })
        : t("queue_waiting_today")

  const card = layout === "card"

  return (
    <div className={cn(card ? "flex h-full flex-col gap-2 rounded-xl border border-dashed bg-card p-3 shadow-sm transition-shadow hover:shadow-md" : "flex flex-wrap items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30")}>
      <div className={cn("flex min-w-0 items-start gap-3", card ? "w-full" : "flex-1")}>
        <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", BUCKET_TONE[task.bucket])}>
          <Inbox size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" dir="auto">
            {taskTitle(task, tc)}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" dir="auto">
            <StatusPill tone="module">{tsb(task.moduleLabelKey)}</StatusPill>
            <span>
              {t("queue_hint")}
              {since ? ` · ${t("queue_since", { date: pmDate(task.dueOn, locale) })}` : ""}
            </span>
          </p>
        </div>
      </div>
      <div className={cn("flex shrink-0 flex-wrap items-center gap-2", card ? "mt-auto w-full justify-between border-t border-border/60 pt-2" : "justify-end")}>
        <StatusPill tone={TONE[task.bucket]}>{pill}</StatusPill>
        <Link href={task.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("queue_open")}
          <ArrowUpRight size={14} className="ms-1 rtl-flip" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
