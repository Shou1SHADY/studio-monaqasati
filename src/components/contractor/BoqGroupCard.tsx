"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { CATEGORIES_DATA, displayCategory } from "@/lib/constants"
import type { BoqItem } from "@/lib/boq-parser"
import type { BoqGroup } from "@/utils/boq-groups"
import { CheckCircle2, GripVertical, Scissors, Trash2 } from "lucide-react"

// ── BoqGroupCard ──────────────────────────────────────────────────────────────
export function BoqGroupCard({
  group, groupIdx, isRtl, locale, isDragOver, existingItemNos,
  onUpdateTitle, onUpdateCategory, onDeleteGroup, onSplitItem, onRemoveItem,
  onItemDragStart, onDragOver, onDrop, onDragLeave, t,
}: {
  group: BoqGroup
  groupIdx: number
  isRtl: boolean
  locale: string
  isDragOver: boolean
  existingItemNos: Map<string, string>
  onUpdateTitle: (v: string) => void
  onUpdateCategory: (v: string) => void
  onDeleteGroup: () => void
  onSplitItem: (item: BoqItem) => void
  onRemoveItem: (item: BoqItem) => void
  onItemDragStart: (e: React.DragEvent, item: BoqItem) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragLeave: () => void
  t: (key: string, opts?: any) => string
}) {
  return (
    <Card
      className={cn(
        "border transition-all",
        isDragOver ? "border-primary/60 bg-primary/5 shadow-md" : "border-border",
        group.items.length === 0 && "opacity-60"
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      <CardHeader className="pb-3">
        {/* Group header */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className={cn("flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-black shrink-0 mt-1")}>
            {groupIdx + 1}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {/* Title input */}
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("boq_group_rfq_title")}</Label>
              <Input
                value={group.titleAr}
                onChange={e => onUpdateTitle(e.target.value)}
                className="h-9 text-sm font-bold rounded-lg border-border mt-0.5"
                dir="rtl"
              />
            </div>
            {/* Category select */}
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("boq_group_category")}</Label>
              <Select value={group.categoryAr} onValueChange={onUpdateCategory}>
                <SelectTrigger className="h-8 text-xs rounded-lg border-border mt-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {Object.keys(CATEGORIES_DATA).map(cat => (
                    <SelectItem key={cat} value={cat} className="text-xs">{displayCategory(cat, locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-bold border-primary/20 text-primary bg-primary/5">
              {group.items.length} {isRtl ? "بند" : "items"}
            </Badge>
            <button
              type="button"
              onClick={onDeleteGroup}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={isRtl ? "حذف المجموعة" : "Delete group"}
              title={isRtl ? "حذف المجموعة" : "Delete group"}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-2">
        {group.items.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground border-2 border-dashed border-border rounded-xl">
            {isRtl ? "اسحب البنود هنا" : "Drag items here"}
          </div>
        ) : (
          group.items.map(item => {
            const dupStatus = existingItemNos.get(item.itemNo)
            return (
              <ItemRow
                key={item.id}
                item={item}
                dupStatus={dupStatus}
                onDragStart={e => onItemDragStart(e, item)}
                actions={
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSplitItem(item)}
                      className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      aria-label={t("boq_split_item")}
                      title={t("boq_split_item")}
                    >
                      <Scissors size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveItem(item)}
                      className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      aria-label={t("boq_remove_item")}
                      title={t("boq_remove_item")}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                }
              />
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

// ── ItemRow ───────────────────────────────────────────────────────────────────
export function ItemRow({
  item, dupStatus, onDragStart, actions,
}: {
  item: BoqItem
  dupStatus?: string
  onDragStart: (e: React.DragEvent) => void
  actions: React.ReactNode
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex items-start gap-2 p-2.5 rounded-xl bg-muted/50 hover:bg-muted border border-border cursor-grab active:cursor-grabbing transition-colors group"
    >
      <GripVertical size={14} className="text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 mt-0.5 transition-colors" />

      {/* Item No badge */}
      <span className="text-[10px] font-mono font-bold bg-primary/8 text-primary px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap">
        {item.itemNo}
      </span>

      {/* Descriptions */}
      <div className="flex-1 min-w-0">
        {/* Arabic first */}
        {item.descriptionAr && (
          <p className="text-xs font-bold text-foreground leading-snug text-right" dir="rtl">
            {item.descriptionAr}
          </p>
        )}
        <p className={cn("text-[11px] text-muted-foreground leading-snug", item.descriptionAr ? "mt-0.5" : "font-bold text-foreground text-xs")}>
          {item.descriptionEn}
        </p>
      </div>

      {/* Qty + Unit */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] font-bold bg-muted text-muted-foreground px-1.5 py-0.5 rounded" dir="ltr">
          {item.quantity}
        </span>
        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
          {item.unit}
        </span>
      </div>

      {/* Duplicate badge */}
      {dupStatus && (
        <Badge className={cn(
          "text-[9px] px-1.5 h-4 shrink-0 font-bold border",
          dupStatus === "Published"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-amber-50 text-amber-700 border-amber-200"
        )}>
          {dupStatus === "Published" ? "منشورة" : "مسودة"}
        </Badge>
      )}

      {actions}
    </div>
  )
}

// ── StepDot ───────────────────────────────────────────────────────────────────
export function StepDot({ number, label, active, done }: { number: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className={cn(
        "h-7 w-7 rounded-full flex items-center justify-center text-xs font-black transition-colors",
        done ? "bg-emerald-500 text-white" : active ? "bg-primary text-white" : "bg-muted text-muted-foreground"
      )}>
        {done ? <CheckCircle2 size={14} /> : number}
      </div>
      <span className={cn("text-xs font-bold hidden sm:block", active ? "text-primary" : done ? "text-emerald-600" : "text-muted-foreground")}>
        {label}
      </span>
    </div>
  )
}
