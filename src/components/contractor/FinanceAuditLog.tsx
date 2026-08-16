"use client"

// "Project Passport" — the project's chronological trail of significant
// financial events: IPC claims submitted/collected, and budget-exception
// overrides logged when a contractor accepts an offer above the project
// budget. One shared reader (useFinanceAuditLog) + one shared renderer, so
// every screen that needs project history (the overview tab today, IPC tab
// previously) shows the exact same trail instead of keeping its own copy.

import { useTranslations, useLocale } from "next-intl"
import { BookMarked, Receipt, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react"
import { useFinanceAuditLog, type FinanceAuditLogEntry } from "@/hooks/useFinanceAuditLog"
import { formatCurrency } from "@/utils/invoice-utils"
import { cn } from "@/lib/utils"

function fmtDateTime(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  if (isNaN(d.getTime())) return "–"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { year: "numeric", month: "short", day: "numeric" })
}

function EntryRow({ entry, locale, t }: { entry: FinanceAuditLogEntry; locale: string; t: ReturnType<typeof useTranslations<"Portal.Contractor">> }) {
  const isException = entry.action === "budget_exception_override"
  const isCollected = entry.action === "ipc_collected"
  const meta = entry.meta || {}

  const Icon = isException ? AlertTriangle : isCollected ? CheckCircle2 : Receipt
  const label =
    entry.action === "ipc_submitted" ? t("finance_audit_ipc_submitted") :
    entry.action === "ipc_collected" ? t("finance_audit_ipc_collected") :
    t("finance_audit_budget_override")

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-xl border text-sm",
        isException ? "bg-amber-50/70 border-amber-200/70" : "bg-slate-50 border-slate-100"
      )}
    >
      <div className={cn(
        "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
        isException ? "bg-amber-100 text-amber-700" : isCollected ? "bg-success/10 text-success" : "bg-primary/10 text-primary"
      )}>
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-slate-700">
            <span className="font-bold text-slate-900">{entry.actorName}</span>{" "}
            {label}{" "}
            <span className="font-semibold" dir="ltr">{formatCurrency(entry.amount, locale)}</span>
          </p>
          <span className="text-xs text-slate-400 shrink-0" suppressHydrationWarning>{fmtDateTime(entry.createdAt, locale)}</span>
        </div>
        {isException && (
          <div className="mt-1.5 space-y-1">
            {typeof meta.rfqTitle === "string" && meta.rfqTitle && (
              <p className="text-xs text-slate-500 truncate">{meta.rfqTitle}</p>
            )}
            {typeof meta.overageAmount === "number" && (
              <p className="text-xs font-semibold text-amber-700" dir="ltr">
                {t("passport_overage_label")} {formatCurrency(meta.overageAmount, locale)}
              </p>
            )}
            {entry.reason && (
              <p className="text-xs text-slate-600 bg-white/70 rounded-lg px-2.5 py-1.5 border border-amber-100">
                <span className="font-bold text-amber-800">{t("passport_reason_label")}</span> {entry.reason}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function FinanceAuditLog({ projectId }: { projectId: string }) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const { entries, isLoading } = useFinanceAuditLog(projectId)

  return (
    <div className="space-y-3" dir={isRtl ? "rtl" : "ltr"}>
      <div>
        <h3 className="font-bold text-base flex items-center gap-2 text-slate-800">
          <BookMarked size={16} className="text-primary" />
          {t("passport_title")}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t("passport_desc")}</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="animate-spin text-muted-foreground" size={22} />
        </div>
      ) : entries.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground border border-dashed rounded-xl text-sm">
          {t("passport_empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} locale={locale} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}
