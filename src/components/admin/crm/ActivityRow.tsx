"use client"

import { useTranslations } from "next-intl"
import { CalendarDays, Check, Circle, Pencil, Trash2 } from "lucide-react"
import { IconButton } from "@/components/module-ui/IconButton"
import { activityState, formatCrmDate, type CrmActivity } from "@/lib/admin-crm"
import { cn } from "@/lib/utils"
import { useLocale } from "next-intl"

const TYPE_STYLE: Record<string, string> = {
  call: "bg-cta/10 text-cta",
  whatsapp: "bg-success/10 text-success",
  meeting: "bg-warning/10 text-warning",
  email: "bg-primary/10 text-primary",
  task: "bg-secondary/10 text-secondary",
  note: "bg-muted text-muted-foreground",
}

/** One activity: type, what, who it is with and who owns it, its date (red when late), and the tick that completes it. */
export function ActivityRow({
  a,
  today,
  context,
  onToggle,
  onEdit,
  onDelete,
}: {
  a: CrmActivity
  today: string
  /** Shown under the title when the list mixes several clients. */
  context?: string
  onToggle: (a: CrmActivity) => void
  onEdit: (a: CrmActivity) => void
  onDelete: (a: CrmActivity) => void
}) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const state = activityState(a, today)
  const done = state === "done"
  const day = a.dueDate || (a.createdAt?.seconds ? new Date(a.createdAt.seconds * 1000) : "")
  const title = a.system === "converted" ? t("activity_system_converted") : a.type === "stage" && a.from && a.to ? t("history_stage", { from: t(`stage_${a.from}`), to: t(`stage_${a.to}`) }) : a.title?.trim() || a.note
  const sub = [context, a.withName ? t("activity_with_name", { name: a.withName }) : "", a.ownerName || a.authorName].filter(Boolean).join(" · ")
  const legacy = a.status === undefined || Boolean(a.system) || a.type === "stage" // an old log line or a system line: nothing to tick or edit
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <button
        type="button"
        aria-label={t(done ? "activity_reopen" : "activity_complete")}
        aria-pressed={done}
        disabled={legacy}
        onClick={() => onToggle(a)}
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60",
          done ? "border-success bg-success text-success-foreground" : "border-muted-foreground/40 hover:border-success",
        )}
      >
        {done ? <Check size={14} aria-hidden="true" /> : <Circle size={0} aria-hidden="true" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TYPE_STYLE[a.type] ?? TYPE_STYLE.note)}>{t(a.system ? "type_system" : a.type === "stage" ? "type_stage" : `type_${a.type}`)}</span>
          <span className={cn(done && "text-muted-foreground")}>{title}</span>
          {a.result && <span className="text-xs font-medium text-muted-foreground">· {t(`result_${a.result}`)}</span>}
        </p>
        {a.type === "stage" && a.note && <p className="mt-0.5 text-xs text-muted-foreground">{a.note}</p>}
        {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      <span className={cn("inline-flex items-center gap-1 text-xs tabular-nums", state === "overdue" ? "font-semibold text-destructive" : state === "today" ? "font-semibold text-warning" : "text-muted-foreground")}>
        <CalendarDays size={12} aria-hidden="true" />
        {formatCrmDate(day, locale)}
        {a.dueTime && !done && <bdi dir="ltr">{a.dueTime}</bdi>}
        {state === "overdue" && ` · ${t("activity_overdue")}`}
        {state === "today" && ` · ${t("activity_today")}`}
      </span>
      <div className="flex shrink-0 gap-1">
        {!legacy && <IconButton icon={Pencil} iconSize={14} label={t("edit")} onClick={() => onEdit(a)} />}
        <IconButton icon={Trash2} iconSize={14} label={t("delete")} onClick={() => onDelete(a)} />
      </div>
    </li>
  )
}
