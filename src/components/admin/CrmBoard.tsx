"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { CalendarClock, GripVertical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { NativeSelect } from "@/components/module-ui/NativeSelect"

export type CrmBoardItem = {
  id: string
  name: string
  subtitle: string
  stage: string
  stageLocked: boolean
  ownerName: string
  nextFollowUp: string
  daysSinceContact: number | null
  followUpDue: boolean
  stale: boolean
}

export type CrmBoardColumn = {
  id: string
  label: string
  badgeClass: string
  accepts: boolean
}

type Props = {
  items: CrmBoardItem[]
  columns: CrmBoardColumn[]
  onMove: (id: string, stage: string) => void
  onOpen: (id: string) => void
}

export function CrmBoard({ items, columns, onMove, onOpen }: Props) {
  const t = useTranslations("Portal.Admin.Crm")
  const [dragId, setDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)

  const dragging = items.find((i) => i.id === dragId) ?? null
  const droppable = (column: CrmBoardColumn) => column.accepts && !!dragging && dragging.stage !== column.id

  const drop = (column: CrmBoardColumn) => {
    if (dragging && droppable(column)) onMove(dragging.id, column.id)
    setDragId(null)
    setOverColumn(null)
  }

  return (
    <div className="flex gap-3 overflow-x-auto p-4">
      {columns.map((column) => {
        const cards = items.filter((i) => i.stage === column.id)
        const highlighted = overColumn === column.id && droppable(column)
        return (
          <section
            key={column.id}
            aria-label={column.label}
            onDragOver={(e) => {
              if (!droppable(column)) return
              e.preventDefault()
              setOverColumn(column.id)
            }}
            onDragLeave={() => setOverColumn((c) => (c === column.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault()
              drop(column)
            }}
            className={cn(
              "flex min-w-60 flex-1 flex-col gap-2 rounded-lg border bg-muted/30 p-2 transition-colors",
              highlighted && "border-primary bg-primary/5",
            )}
          >
            <header className="flex items-center justify-between gap-2 px-1 py-1">
              <Badge variant="outline" className={column.badgeClass}>{column.label}</Badge>
              <span className="text-xs font-semibold text-muted-foreground" dir="ltr">{cards.length}</span>
            </header>
            {cards.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                {column.accepts ? t("board_empty_drop") : t("board_empty")}
              </p>
            ) : (
              cards.map((card) => (
                <article
                  key={card.id}
                  draggable={!card.stageLocked}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move"
                    e.dataTransfer.setData("text/plain", card.id)
                    setDragId(card.id)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setOverColumn(null)
                  }}
                  className={cn(
                    "space-y-2 rounded-md border bg-background p-3 shadow-sm",
                    !card.stageLocked && "cursor-grab active:cursor-grabbing",
                    dragId === card.id && "opacity-50",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!card.stageLocked && <GripVertical size={14} className="mt-1 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <button
                      type="button"
                      onClick={() => onOpen(card.id)}
                      className="min-w-0 flex-1 rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <p className="truncate text-sm font-bold">{card.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{card.subtitle}</p>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{card.ownerName || t("unassigned")}</span>
                    {card.daysSinceContact === null ? (
                      <span className="font-medium text-warning">{t("never_contacted")}</span>
                    ) : (
                      <span className={cn(card.stale && "font-medium text-warning")}>{t("days_ago", { n: card.daysSinceContact })}</span>
                    )}
                    {card.nextFollowUp && (
                      <span className={cn("inline-flex items-center gap-1", card.followUpDue && "font-medium text-warning")} dir="ltr">
                        <CalendarClock size={12} aria-hidden="true" />
                        {card.nextFollowUp}
                      </span>
                    )}
                  </div>
                  {!card.stageLocked && (
                    <NativeSelect
                      aria-label={t("board_move_to")}
                      value={card.stage}
                      onChange={(e) => onMove(card.id, e.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {columns
                        .filter((c) => c.accepts || c.id === card.stage)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                    </NativeSelect>
                  )}
                </article>
              ))
            )}
          </section>
        )
      })}
    </div>
  )
}
