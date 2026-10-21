"use client"

// A material's specifications as choices: each spec a row of option chips, one value at most. The browser dialog and
// the search result's «خيارات» panel pick the same way.

import { useLocale } from "next-intl"
import { Chip } from "@/components/module-ui/Chip"
import { label, shortSpecName, specsOf, type MaterialIndex } from "@/lib/materials/tree"
import type { MaterialText } from "@/lib/materials/types"

export function MaterialSpecChoices({ index, nodeId, value, onChange }: { index: MaterialIndex; nodeId: string; value: Record<string, MaterialText>; onChange: (next: Record<string, MaterialText>) => void }) {
  const locale = useLocale()
  return (
    <>
      {specsOf(index, nodeId).map((s) => (
        <fieldset key={s.ar} className="space-y-2">
          <legend className="text-xs font-semibold text-muted-foreground">{label(shortSpecName(s), locale)}</legend>
          <div className="flex flex-wrap gap-1.5">
            {s.options.map((o, i) => {
              const on = value[s.ar]?.ar === o.ar && value[s.ar]?.en === o.en
              return (
                <Chip
                  key={`${o.ar}|${o.en}|${i}`}
                  selected={on}
                  onClick={() => {
                    const next = { ...value }
                    if (on) delete next[s.ar]
                    else next[s.ar] = o
                    onChange(next)
                  }}
                >
                  <span dir="auto">{label(o, locale)}</span>
                </Chip>
              )
            })}
          </div>
        </fieldset>
      ))}
    </>
  )
}
