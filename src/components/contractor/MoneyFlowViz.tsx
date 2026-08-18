"use client"

import { useTranslations, useLocale } from "next-intl"
import { cn } from "@/lib/utils"
import { PROJECT_STATUS_BADGE_CLASSES, projectStatusLabelKey, resolveProjectStatus } from "@/lib/project-status"
import { useProjectMoneyFlow } from "@/hooks/useProjectMoneyFlow"
import { formatCurrency } from "@/utils/invoice-utils"
import { Loader2, Info } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface MoneyFlowVizProps {
  projectId: string
}

function ProjectStatusBadge({ status, t }: { status: string | null; t: (key: string) => string }) {
  if (!status) return null
  const resolved = resolveProjectStatus(status)
  return (
    <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full border", PROJECT_STATUS_BADGE_CLASSES[resolved])}>
      {t(projectStatusLabelKey(resolved))}
    </span>
  )
}

function Stage({
  label,
  value,
  locale,
  approxNote,
  muted,
}: {
  label: string
  value: number | null
  locale: string
  approxNote?: string
  muted?: boolean
}) {
  return (
    <div className={cn("flex-1 min-w-[104px] text-center", muted && "opacity-40")}>
      <p className="text-[11px] text-muted-foreground mb-1 flex items-center justify-center gap-1">
        {label}
        {approxNote && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info size={11} className="text-muted-foreground/70 cursor-help" />
            </TooltipTrigger>
            <TooltipContent>{approxNote}</TooltipContent>
          </Tooltip>
        )}
      </p>
      <p className="text-sm font-black text-foreground" dir="ltr">
        {muted || value == null ? "—" : formatCurrency(value, locale)}
      </p>
    </div>
  )
}

function Arrow() {
  return <div className="w-4 h-px bg-slate-200 shrink-0 mt-4" />
}

export function MoneyFlowViz({ projectId }: MoneyFlowVizProps) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const flow = useProjectMoneyFlow(projectId)

  if (flow.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    )
  }

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between gap-3 flex-wrap p-3 rounded-xl bg-slate-50 border border-slate-200/70">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground">{t("moneyflow_status_label")}</span>
          <ProjectStatusBadge status={flow.status} t={t} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground">{t("moneyflow_remaining_label")}</span>
          <span className="text-sm font-black text-foreground" dir="ltr">
            {flow.remaining == null ? "—" : formatCurrency(flow.remaining, locale)}
          </span>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">{t("moneyflow_out_label")}</p>
        <div className="flex items-start overflow-x-auto pb-1">
          <Stage label={t("moneyflow_stage_budget")} value={flow.budget} locale={locale} />
          <Arrow />
          <Stage label={t("moneyflow_stage_priced")} value={flow.priced} locale={locale} />
          <Arrow />
          <Stage label={t("moneyflow_stage_commit")} value={flow.committed} locale={locale} />
          <Arrow />
          <Stage label={t("moneyflow_stage_recv")} value={flow.received} locale={locale} approxNote={t("moneyflow_stage_recv_approx_note")} />
          <Arrow />
          <Stage label={t("moneyflow_stage_inv")} value={flow.invoiced} locale={locale} />
          <Arrow />
          <Stage label={t("moneyflow_stage_paid")} value={flow.paid} locale={locale} />
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">{t("moneyflow_in_label")}</p>
        <div className="flex items-start overflow-x-auto pb-1">
          <Stage label={t("moneyflow_stage_claim")} value={flow.claimed} locale={locale} />
          <Arrow />
          <Stage label={t("moneyflow_stage_coll")} value={flow.collected} locale={locale} />
        </div>
      </div>
    </div>
  )
}
