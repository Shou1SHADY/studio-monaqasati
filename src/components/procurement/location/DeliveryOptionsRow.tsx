"use client"

// «التسليم» (اختياري) under a group's place (Procurement 2.0, ED-04): who unloads, the time of day, a note for reaching
// the site. Every choice toggles off when pressed again; nothing here is required and the supplier reads what was set.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Plus, Truck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Chip } from "@/components/module-ui/Chip"
import { DELIVERY_NOTE_MAX, SLOT_CHOICES, UNLOAD_CHOICES, type DeliveryOptions } from "@/lib/procurement/delivery-options"

export function DeliveryOptionsRow({ value, onChange }: { value?: DeliveryOptions; onChange: (next: DeliveryOptions) => void }) {
  const t = useTranslations("Portal.ProcEditor")
  const d = value || {}
  const [noteOpen, setNoteOpen] = useState(false)
  const set = (patch: DeliveryOptions) => onChange({ ...d, ...patch })
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2" role="group" aria-label={t("deliv_label")}>
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Truck size={14} aria-hidden="true" />
        {t("deliv_label")} <em className="font-normal not-italic opacity-80">({t("deliv_optional")})</em>
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {UNLOAD_CHOICES.map((u) => (
          <Chip key={u} selected={d.unload === u} className="min-h-8 py-1" onClick={() => set({ unload: d.unload === u ? null : u })}>
            {t(`deliv_unload_${u}`)}
          </Chip>
        ))}
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
        {SLOT_CHOICES.map((s) => (
          <Chip key={s} selected={d.slot === s} className="min-h-8 py-1" onClick={() => set({ slot: d.slot === s ? null : s })}>
            {t(`deliv_slot_${s}`)}
          </Chip>
        ))}
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
        {noteOpen || d.note ? (
          <Input
            value={d.note || ""}
            onChange={(e) => set({ note: e.target.value })}
            maxLength={DELIVERY_NOTE_MAX}
            placeholder={t("deliv_note_ph")}
            aria-label={t("deliv_note")}
            className="h-8 w-72 max-w-full text-xs"
            dir="auto"
            autoFocus={noteOpen && !d.note}
          />
        ) : (
          <Chip selected={false} icon={Plus} className="min-h-8 border-dashed py-1" onClick={() => setNoteOpen(true)}>
            {t("deliv_note")}
          </Chip>
        )}
      </div>
    </div>
  )
}
