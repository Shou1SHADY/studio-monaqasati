"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { TableColumnDef } from "@/hooks/useTableColumns"
import { SlidersHorizontal } from "lucide-react"

interface ColumnCustomizerProps {
  columns: TableColumnDef[]
  isVisible: (columnId: string) => boolean
  toggle: (columnId: string) => void
}

export function ColumnCustomizer({ columns, isVisible, toggle }: ColumnCustomizerProps) {
  const t = useTranslations("Portal.Shared")
  const toggleable = columns.filter((c) => !c.locked)

  if (toggleable.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
          <SlidersHorizontal size={13} />
          {t("columns_customize")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <p className="text-xs font-bold text-muted-foreground px-2 py-1.5">{t("columns_customize")}</p>
        <div className="space-y-0.5">
          {toggleable.map((col) => (
            <label
              key={col.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer text-sm"
            >
              <Checkbox checked={isVisible(col.id)} onCheckedChange={() => toggle(col.id)} />
              <span className="text-slate-700">{col.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
