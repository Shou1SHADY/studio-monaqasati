"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarDays, Check, Pencil, Trash2 } from "lucide-react"
import { IconButton } from "@/components/module-ui/IconButton"
import { buttonVariants } from "@/components/ui/button"
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
import { activityState, formatCrmDate, type CrmActivity } from "@/lib/admin-crm"
import { cn } from "@/lib/utils"

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
  detail,
  onToggle,
  onEdit,
  onDelete,
}: {
  a: CrmActivity
  today: string
  /** Shown under the title when the list mixes several clients. */
  context?: string
  /** Under a platform line: what it did (the conversion: what moved over from the lead). */
  detail?: string
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
  // A stage change carries the reason the team agreed to record, and a conversion is the platform's own line: history, never deleted.
  const history = Boolean(a.system) || a.type === "stage"
  const [confirming, setConfirming] = useState(false)
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
        {done && <Check size={14} aria-hidden="true" />}
      </button>
      {/* Never narrower than a title: on a phone the date and actions wrap under it instead. */}
      <div className="min-w-[12rem] flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
          {/* The outcome rides on the type — «call · replied» — as on the subscribers' list. */}
          <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", a.system ? "bg-indigo/10 text-indigo" : TYPE_STYLE[a.type] ?? TYPE_STYLE.note)}>
            {[t(a.system ? "type_system" : a.type === "stage" ? "type_stage" : `type_${a.type}`), a.result ? t(`result_${a.result}`) : ""].filter(Boolean).join(" · ")}
          </span>
          <span className={cn(done && !a.system && "text-muted-foreground")}>{title}</span>
        </p>
        {a.type === "stage" && a.note && <p className="mt-0.5 text-xs text-muted-foreground">{a.note}</p>}
        {a.system && detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
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
        {!history && <IconButton icon={Trash2} iconSize={14} label={t("delete")} onClick={() => setConfirming(true)} className="hover:text-destructive" />}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("activity_delete_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("activity_delete_desc", { title })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={() => onDelete(a)}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
