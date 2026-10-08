"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarClock, GripVertical, Pencil, Trash2, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { IconButton } from "@/components/module-ui/IconButton"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { ShowMoreRow } from "@/components/module-ui/ShowMoreRow"
import { Link } from "@/i18n/routing"
import { LEAD_STAGES, OPEN_STAGES, formatCrmDate, stageTotals, toDateKey, type LeadMatch, type LeadRow, type OpenStage } from "@/lib/admin-crm"
import { cn } from "@/lib/utils"
import { Money, STAGE_TONE } from "./parts"

const PAGE = 10

/** ADM-03: only the four open stages as columns; each shows its count and the money in it, and its first ten cards. */
export function LeadBoard({
  rows,
  matches,
  onMove,
  onRemove,
}: {
  rows: LeadRow[]
  matches: Map<string, LeadMatch>
  onMove: (crmId: string, stage: string) => void
  onRemove: (row: LeadRow) => void
}) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<OpenStage | null>(null)
  const [shown, setShown] = useState<Record<string, number>>({})
  const totals = stageTotals(rows)
  const today = toDateKey(new Date())
  const dragging = rows.find((r) => r.crmId === dragId) ?? null

  return (
    <div className="grid gap-3 overflow-x-auto p-4 md:grid-cols-4 [grid-auto-columns:minmax(16rem,1fr)] max-md:grid-flow-col">
      {OPEN_STAGES.map((stage) => {
        const cards = rows.filter((r) => r.stage === stage)
        const limit = shown[stage] ?? PAGE
        const canDrop = !!dragging && dragging.stage !== stage
        return (
          <section
            key={stage}
            aria-label={t(`stage_${stage}`)}
            onDragOver={(e) => {
              if (!canDrop) return
              e.preventDefault()
              setOver(stage)
            }}
            onDragLeave={() => setOver((c) => (c === stage ? null : c))}
            onDrop={(e) => {
              e.preventDefault()
              if (dragging && canDrop) onMove(dragging.crmId, stage)
              setDragId(null)
              setOver(null)
            }}
            className={cn("flex min-w-64 flex-col gap-2 rounded-lg border border-t-4 bg-muted/30 p-2 transition-colors", STAGE_TONE[stage].strip, over === stage && canDrop && "bg-primary/5 ring-1 ring-primary")}
          >
            <header className="flex items-center justify-between gap-2 px-1 py-1">
              <h3 className="text-sm font-bold">{t(`stage_${stage}`)}</h3>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-background px-2 font-semibold tabular-nums" dir="ltr">{totals[stage].count}</span>
                {totals[stage].value > 0 && <Money amount={totals[stage].value} />}
              </span>
            </header>
            {cards.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{t("board_empty_drop")}</p>
            ) : (
              cards.slice(0, limit).map((r) => {
                const m = matches.get(r.crmId)
                const late = r.nextFollowUp !== "" && r.nextFollowUp < today
                return (
                  <article
                    key={r.crmId}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move"
                      e.dataTransfer.setData("text/plain", r.crmId)
                      setDragId(r.crmId)
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setOver(null)
                    }}
                    className={cn("cursor-grab space-y-2 rounded-md border bg-background p-3 shadow-sm active:cursor-grabbing", dragId === r.crmId && "opacity-50")}
                  >
                    <div className="flex items-start gap-1.5">
                      <GripVertical size={14} className="mt-1 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <Link href={`/admin/crm/leads/${r.crmId}`} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        <p className="truncate text-sm font-bold">{r.name}</p>
                        {r.company && <p className="truncate text-xs text-muted-foreground">{r.company}</p>}
                      </Link>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {r.kind !== "unspecified" && <Badge variant="outline" className="text-[11px] font-medium">{t(`kind_${r.kind}`)}</Badge>}
                      <Badge variant="outline" className="text-[11px] font-medium">{t(`channel_${r.channel}`)}</Badge>
                      {r.plan && <Badge variant="outline" className="border-cta/30 bg-cta/10 text-[11px] font-medium text-cta">{t(`plan_${r.plan}`)}</Badge>}
                      {m?.duplicates.length ? <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[11px] font-medium text-warning">{t("flag_duplicate_short")}</Badge> : null}
                      {m?.client ? <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[11px] font-medium text-warning">{t("flag_client_short")}</Badge> : null}
                    </div>
                    {r.expectedValue > 0 && <Money amount={r.expectedValue} className="block text-sm font-black" />}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <UserRound size={12} aria-hidden="true" />
                        {r.ownerName || t("unassigned")}
                      </span>
                      {r.nextFollowUp && (
                        <span className={cn("inline-flex items-center gap-1", late && "font-semibold text-destructive")}>
                          <CalendarClock size={12} aria-hidden="true" />
                          {formatCrmDate(r.nextFollowUp, locale)}
                          {late && ` · ${t("activity_overdue")}`}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 border-t pt-2">
                      <NativeSelect aria-label={t("board_move_to")} value={r.stage} onChange={(e) => onMove(r.crmId, e.target.value)} className="h-9 min-w-0 flex-1 text-xs">
                        {LEAD_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {t(`stage_${s}`)}
                          </option>
                        ))}
                      </NativeSelect>
                      <Link href={`/admin/crm/leads/${r.crmId}`} aria-label={t("edit")} title={t("edit")} className="grid h-9 w-9 place-items-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Pencil size={14} aria-hidden="true" />
                      </Link>
                      <IconButton icon={Trash2} iconSize={14} label={t("remove_lead")} onClick={() => onRemove(r)} className="h-9 w-9 text-destructive" />
                    </div>
                  </article>
                )
              })
            )}
            {cards.length > limit && <ShowMoreRow onClick={() => setShown((s) => ({ ...s, [stage]: limit + PAGE }))}>{t("show_more", { n: cards.length - limit })}</ShowMoreRow>}
          </section>
        )
      })}
    </div>
  )
}
