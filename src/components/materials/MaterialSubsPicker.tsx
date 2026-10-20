"use client"

// Choosing sub-categories from the material tree (PUR-04/05): a supplier's specialties,
// an invitation's specialties. Search by a sub-category or by a material under it; the
// twenty categories open to their sub-categories; the chosen ones stay on top as chips.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronDown, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { foldSearchText } from "@/lib/search-text"
import { label, type MaterialIndex } from "@/lib/materials/tree"
import type { MaterialNode } from "@/lib/materials/types"

function words(n: MaterialNode): string {
  const out: string[] = [n.ar, n.en]
  const walk = (x: MaterialNode) => {
    out.push(x.ar, x.en, ...x.keywords)
    x.children.forEach(walk)
  }
  n.children.forEach(walk)
  return foldSearchText(out.join(" "))
}

export function MaterialSubsPicker({
  index,
  value,
  onChange,
  disabled,
  className,
}: {
  index: MaterialIndex | null
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  className?: string
}) {
  const t = useTranslations("Portal.Materials")
  const locale = useLocale()
  const [q, setQ] = useState("")
  const [openRoot, setOpenRoot] = useState<string | null>(null)
  const chosen = new Set(value)

  const groups = useMemo(() => {
    if (!index) return []
    const term = foldSearchText(q)
    return index.roots
      .map((root) => {
        const subs = index.subs.filter((s) => s.id === root.id || index.parentOf.get(s.id) === root.id)
        const shown = term ? subs.filter((s) => words(s).includes(term) || foldSearchText(`${root.ar} ${root.en}`).includes(term)) : subs
        return { root, subs: shown }
      })
      .filter((g) => g.subs.length)
  }, [index, q])

  const toggle = (id: string) => onChange(chosen.has(id) ? value.filter((x) => x !== id) : [...value, id])

  if (!index) return <p className="text-sm text-muted-foreground">{t("loading")}</p>

  return (
    <div className={cn("space-y-3", className)}>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("chosen_subs")}>
          {value.map((id) => {
            const n = index.byId.get(id)
            if (!n) return null
            return (
              <li key={id}>
                <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-module/30 bg-module/10 ps-3 pe-1 text-xs font-semibold text-module">
                  {label(n, locale)}
                  <button type="button" disabled={disabled} onClick={() => toggle(id)} aria-label={`${t("remove")} ${label(n, locale)}`} className="rounded-full p-1 hover:bg-module/20">
                    <X size={12} />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("subs_search")} aria-label={t("subs_search")} className="ps-9" dir="auto" disabled={disabled} />
      </div>
      <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
        {groups.map(({ root, subs }) => {
          const open = !!q || openRoot === root.id
          const picked = subs.filter((s) => chosen.has(s.id)).length
          return (
            <li key={root.id}>
              <button
                type="button"
                onClick={() => setOpenRoot(open && !q ? null : root.id)}
                aria-expanded={open}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-start text-sm font-semibold hover:bg-muted"
              >
                <span>{label(root, locale)}</span>
                <span className="inline-flex items-center gap-2 text-xs font-normal text-muted-foreground">
                  {picked > 0 && <span className="rounded-full bg-module/10 px-2 text-module">{picked}</span>}
                  <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
                </span>
              </button>
              {open && (
                <ul className="grid grid-cols-1 gap-1 px-3 pb-3 sm:grid-cols-2">
                  {subs.map((s) => (
                    <li key={s.id}>
                      <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted">
                        <Checkbox checked={chosen.has(s.id)} onCheckedChange={() => toggle(s.id)} disabled={disabled} />
                        <span>{label(s, locale)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
        {!groups.length && <li className="px-3 py-4 text-center text-sm text-muted-foreground">{t("no_match")}</li>}
      </ul>
    </div>
  )
}
