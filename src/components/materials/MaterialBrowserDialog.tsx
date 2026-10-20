"use client"

// «تصفّح شجرة المواد» (PUR-04, page 2): the twenty categories with their sub-category
// counts, down to the material; then its specs as choices, its unit, and «+ علامة أو
// مواصفة» — one step ends with the material, its specs and its unit on the row. A
// material outside the list («غير موجود؟ اكتبه كما هو») still names its sub-category,
// because suppliers are reached by it.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, PenLine, Plus, Search, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Chip } from "@/components/module-ui/Chip"
import { cn } from "@/lib/utils"
import { brandsOf, isMaterial, label, pathLabel, pathOf, pickOf, searchMaterials, shortSpecName, specsOf, unitsOf, type MaterialIndex } from "@/lib/materials/tree"
import type { MaterialNode, MaterialPick, MaterialText, MaterialUnit } from "@/lib/materials/types"

export interface BrowserResult {
  pick: MaterialPick
  /** The unit the line takes: the material's only one, or the one chosen. */
  unit: MaterialUnit | null
  /** For a material outside the list: the words typed. */
  name?: string
  repeat: boolean
}

export function MaterialBrowserDialog({
  open,
  onOpenChange,
  index,
  initialQuery = "",
  freeText,
  target,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  index: MaterialIndex | null
  initialQuery?: string
  /** Set when the words are kept as they are: the dialog asks only for the sub-category. */
  freeText?: string | null
  /** «الصف 6» — where the material lands. */
  target?: string
  onAdd: (r: BrowserResult) => void
}) {
  const t = useTranslations("Portal.Materials")
  const locale = useLocale()
  const dir = locale === "ar" ? "rtl" : "ltr"
  const [q, setQ] = useState(initialQuery)
  const [at, setAt] = useState<string | null>(null)
  const [specs, setSpecs] = useState<Record<string, MaterialText>>({})
  const [unitKey, setUnitKey] = useState<string | null>(null)
  const [brand, setBrand] = useState<MaterialText | null>(null)
  const [extra, setExtra] = useState<Array<{ name: string; value: string }>>([])
  const [outside, setOutside] = useState<string | null>(freeText ?? null)

  useEffect(() => {
    if (!open) return
    setQ(initialQuery)
    setAt(null)
    setSpecs({})
    setUnitKey(null)
    setBrand(null)
    setExtra([])
    setOutside(freeText ?? null)
  }, [open, initialQuery, freeText])

  const node = at && index ? index.byId.get(at) || null : null
  const path = node && index ? pathOf(index, node.id) : []
  const showsDetail = !!node && isMaterial(node) && outside == null
  const children = (node ? node.children : index?.roots || []).filter((c) => !c.hidden)
  const hits = useMemo(() => (index && q.trim() && !showsDetail ? searchMaterials(index, q, 20) : []), [index, q, showsDetail])

  const open1 = (n: MaterialNode, preset: Record<string, MaterialText> = {}) => {
    setAt(n.id)
    setSpecs(preset)
    setUnitKey(null)
    setBrand(null)
    setExtra([])
    setQ("")
  }

  const units = node && index ? unitsOf(index, node.id) : []
  const unit = units.length === 1 ? units[0] : units.find((u) => u.key === unitKey) || null
  // A material outside the list needs a sub-category (or a first-level leaf) to reach suppliers.
  const outsideSub = outside != null && node && (node.level === 2 || (node.level === 1 && isMaterial(node))) ? node : null

  const submit = (repeat: boolean) => {
    if (!index || !node) return
    if (outside != null) {
      if (!outsideSub || !outside.trim()) return
      const pick = pickOf(index, outsideSub.id, [], null, true)
      if (pick) onAdd({ pick, unit: unitsOf(index, outsideSub.id)[0] || null, name: outside.trim(), repeat })
      return
    }
    const chosen = specsOf(index, node.id)
      .filter((s) => specs[s.ar])
      .map((s) => ({ name: shortSpecName(s), value: specs[s.ar] }))
    const free = extra.filter((x) => x.name.trim() && x.value.trim()).map((x) => ({ name: { ar: x.name.trim(), en: x.name.trim() }, value: { ar: x.value.trim(), en: x.value.trim() }, free: true }))
    const pick = pickOf(index, node.id, [...chosen, ...free], brand)
    if (pick) onAdd({ pick, unit, repeat })
  }

  const crumbs = (
    <nav aria-label={t("browse")} className="flex flex-wrap items-center gap-1 text-xs">
      <button type="button" onClick={() => setAt(null)} className="rounded px-1.5 py-1 font-semibold text-module hover:bg-module/10">
        {t("tree_title")}
      </button>
      {path.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1">
          <ChevronLeft size={12} className="text-muted-foreground ltr:rotate-180" aria-hidden="true" />
          <button type="button" onClick={() => setAt(p.id)} className="rounded px-1.5 py-1 hover:bg-muted">
            {label(p, locale)}
          </button>
        </span>
      ))}
    </nav>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{outside != null ? t("outside_title") : t("tree_title")}</DialogTitle>
          <DialogDescription>{outside != null ? t("outside_desc", { name: outside || "…" }) : t("tree_desc")}</DialogDescription>
        </DialogHeader>

        {outside != null && (
          <div className="space-y-1.5">
            <label htmlFor="mat-outside" className="text-xs font-semibold text-muted-foreground">
              {t("outside_name")}
            </label>
            <Input id="mat-outside" value={outside} onChange={(e) => setOutside(e.target.value)} dir="auto" />
          </div>
        )}

        {!showsDetail && (
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("tree_search")} aria-label={t("tree_search")} className="ps-9" dir="auto" />
          </div>
        )}

        {crumbs}

        {!index ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("loading")}</p>
        ) : hits.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {hits.map((h) => (
              <li key={h.node.id}>
                <button
                  type="button"
                  onClick={() => open1(h.node, Object.fromEntries(h.preset.map((p) => [p.spec.ar, p.value])))}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-start hover:bg-muted"
                >
                  <span className="text-sm font-semibold">{label(h.node, locale)}</span>
                  <span className="text-[11px] text-muted-foreground">{pathLabel(h.path, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : showsDetail && node ? (
          <div className="space-y-4">
            <p className="text-sm font-bold">{pathLabel(path, locale, true)}</p>
            {specsOf(index, node.id).map((s) => (
              <fieldset key={s.ar} className="space-y-2">
                <legend className="text-xs font-semibold text-muted-foreground">{label(shortSpecName(s), locale)}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {s.options.map((o) => {
                    const on = specs[s.ar]?.ar === o.ar
                    return (
                      <Chip key={o.ar} selected={on} onClick={() =>
                          setSpecs((cur) => {
                            const next = { ...cur }
                            if (on) delete next[s.ar]
                            else next[s.ar] = o
                            return next
                          })
                        }
                      >
                        <span dir="auto">{label(o, locale)}</span>
                      </Chip>
                    )
                  })}
                </div>
              </fieldset>
            ))}
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-muted-foreground">{t("unit")}</legend>
              {units.length === 1 ? (
                <p className="text-sm">
                  <b>{label(units[0], locale)}</b> <span className="text-xs text-muted-foreground">· {t("only_unit")}</span>
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {units.map((u) => (
                    <Chip key={u.key} selected={unitKey === u.key} onClick={() => setUnitKey(u.key)}>
                      {label(u, locale)}
                    </Chip>
                  ))}
                </div>
              )}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-muted-foreground">
                {t("other")} <span className="font-normal">({t("optional")})</span>
              </legend>
              {brandsOf(index, node.id).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {brandsOf(index, node.id).map((b) => (
                    <Chip key={b.ar} selected={brand?.ar === b.ar} onClick={() => setBrand(brand?.ar === b.ar ? null : b)}>
                      {label(b, locale)}
                    </Chip>
                  ))}
                </div>
              )}
              {extra.map((x, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={x.name} onChange={(e) => setExtra((cur) => cur.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} placeholder={t("free_spec_name")} aria-label={t("free_spec_name")} className="h-9" dir="auto" />
                  <Input value={x.value} onChange={(e) => setExtra((cur) => cur.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} placeholder={t("free_spec_value")} aria-label={t("free_spec_value")} className="h-9" dir="auto" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setExtra((cur) => cur.filter((_, j) => j !== i))} aria-label={t("remove")}>
                    <X size={14} />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setExtra((cur) => [...cur, { name: "", value: "" }])}>
                <Plus size={14} /> {t("add_free_spec")}
              </Button>
            </fieldset>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((c) => {
              const subs = c.children.filter((x) => !x.hidden).length
              const leaf = isMaterial(c)
              const pickedSub = outside != null && outsideSub?.id === c.id
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => open1(c)}
                    className={cn(
                      "flex min-h-14 w-full flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-start transition-colors hover:border-module/40 hover:bg-module/5",
                      pickedSub && "border-module bg-module/10"
                    )}
                  >
                    <span className="text-sm font-semibold">{label(c, locale)}</span>
                    <span className="text-[11px] text-muted-foreground">{leaf ? t("a_material") : t("subs_count", { count: subs })}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {outside == null ? (
            <button type="button" onClick={() => setOutside(q || "")} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <PenLine size={13} aria-hidden="true" /> {t("type_as_is_tagged")}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">{outsideSub ? t("outside_sub_chosen", { sub: label(outsideSub, locale) }) : t("outside_pick_sub")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {outside == null && (
              <Button type="button" variant="outline" disabled={!showsDetail || (units.length > 1 && !unit)} onClick={() => submit(true)}>
                {t("add_and_repeat")}
              </Button>
            )}
            <Button type="button" disabled={outside != null ? !outsideSub || !outside.trim() : !showsDetail || (units.length > 1 && !unit)} onClick={() => submit(false)}>
              {target ? t("add_to", { target }) : t("add")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
