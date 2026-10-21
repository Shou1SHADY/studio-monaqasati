"use client"

// «خيارات ▾» on a search result (CAT-03): the material's specs as chips, a quantity and its unit, and «أضِفها» —
// the row is filled in one go, without leaving the search. Pick only what matters: the supplier fills the rest.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Chip } from "@/components/module-ui/Chip"
import { MaterialSpecChoices } from "@/components/materials/MaterialSpecChoices"
import { label, pathLabel, pickOf, shortSpecName, specsOf, unitsOf, type MaterialHit, type MaterialIndex } from "@/lib/materials/tree"
import type { MaterialPick, MaterialText, MaterialUnit } from "@/lib/materials/types"

export interface OptionsResult {
  pick: MaterialPick
  unit: MaterialUnit | null
  quantity: string
}

export function MaterialOptionsPanel({ index, hit, onBack, onAdd }: { index: MaterialIndex; hit: MaterialHit; onBack: () => void; onAdd: (r: OptionsResult) => void }) {
  const t = useTranslations("Portal.Materials")
  const locale = useLocale()
  const [specs, setSpecs] = useState<Record<string, MaterialText>>(() => Object.fromEntries(hit.preset.map((p) => [p.spec.ar, p.value])))
  const [quantity, setQuantity] = useState("")
  const units = unitsOf(index, hit.node.id)
  const [unitKey, setUnitKey] = useState<string | null>(units[0]?.key ?? null)
  const unit = units.find((u) => u.key === unitKey) ?? null

  const add = () => {
    const chosen = specsOf(index, hit.node.id)
      .filter((s) => specs[s.ar])
      .map((s) => ({ name: shortSpecName(s), value: specs[s.ar] }))
    const pick = pickOf(index, hit.node.id, chosen)
    if (pick) onAdd({ pick, unit, quantity: quantity.replace(/[^\d.]/g, "") })
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <b className="block text-sm" dir="auto">
            {label(hit.node, locale)}
          </b>
          <small className="text-[11px] text-muted-foreground">{pathLabel(hit.path, locale)}</small>
        </div>
        <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1 text-xs" onClick={onBack}>
          <ChevronLeft size={14} className="ltr:rotate-180" aria-hidden="true" /> {t("options_back")}
        </Button>
      </div>
      <MaterialSpecChoices index={index} nodeId={hit.node.id} value={specs} onChange={setSpecs} />
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          {t("options_quantity")}
          <Input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            className="h-9 w-24 text-end tabular-nums"
            dir="ltr"
          />
        </label>
        {units.length === 1 ? (
          <span className="text-sm font-semibold">{label(units[0], locale)}</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {units.map((u) => (
              <Chip key={u.key} selected={unitKey === u.key} onClick={() => setUnitKey(u.key)}>
                {label(u, locale)}
              </Chip>
            ))}
          </span>
        )}
        <Button type="button" size="sm" className="ms-auto" onClick={add}>
          {t("options_add")}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("options_hint")}</p>
    </div>
  )
}
