"use client"

import { useTranslations } from "next-intl"
import { Label } from "@/components/ui/label"
import type { PmUnit } from "@/lib/pm/units"
import { NativeSelect } from "@/components/module-ui/NativeSelect"

/** «وحدة التسليم» on a punch item or an inspection request — optional; tied to a unit, it blocks that unit's handover only. */
export function UnitField({ id, units, value, onChange, disabled }: { id: string; units: PmUnit[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const t = useTranslations("Portal.PM")
  const open = units.filter((u) => !u.ho)
  if (!open.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t("units.field")}</Label>
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full max-md:h-11"
      >
        <option value="">{t("units.field_none")}</option>
        {open.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </NativeSelect>
      <p className="text-[11px] text-muted-foreground">{t("units.field_hint")}</p>
    </div>
  )
}
