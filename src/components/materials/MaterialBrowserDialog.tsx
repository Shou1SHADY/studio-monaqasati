"use client"

// «تصفّح شجرة المواد» (PUR-04, page 2): the twenty categories with their sub-category
// counts, down to the material; then its specs as choices, its unit, and «+ علامة أو
// مواصفة» — one step ends with the material, its specs and its unit on the row. A
// material outside the list («غير موجود؟ اكتبه كما هو») still names its sub-category,
// because suppliers are reached by it.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, PenLine, Search } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { Chip } from "@/components/module-ui/Chip"
import { MaterialSpecChoices } from "./MaterialSpecChoices"
import { cn } from "@/lib/utils"
import { isHeavyEquipmentRental, otherEquipmentSub } from "@/lib/materials/equipment"
import { OTHER_SPEC, brandsOf, isMaterial, label, pathLabel, pathOf, pickOf, searchMaterials, shortSpecName, specsOf, unitsOf, type MaterialIndex } from "@/lib/materials/tree"
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
  startAt,
  target,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  index: MaterialIndex | null
  initialQuery?: string
  /** Set when the words are kept as they are: the dialog asks only for the sub-category. */
  freeText?: string | null
  /** The category the tree opens in (a row's material changed «من الشجرة»); the root when absent. */
  startAt?: string | null
  /** «الصف 6» — set when the material replaces a row's; absent when it is added as a new row. */
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
  const [freeSpec, setFreeSpec] = useState("")
  const [outside, setOutside] = useState<string | null>(freeText ?? null)

  useEffect(() => {
    if (!open) return
    setQ(initialQuery)
    setAt(freeText && isHeavyEquipmentRental(freeText) ? otherEquipmentSub(index)?.id ?? null : startAt ?? null)
    setSpecs({})
    setUnitKey(null)
    setBrand(null)
    setFreeSpec("")
    setOutside(freeText ?? null)
  }, [open, initialQuery, freeText, index, startAt])

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
    setFreeSpec("")
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
    const free = freeSpec.trim() ? [{ name: OTHER_SPEC, value: { ar: freeSpec.trim(), en: freeSpec.trim() }, free: true }] : []
    const pick = pickOf(index, node.id, [...chosen, ...free], brand)
    if (!pick) return
    onAdd({ pick, unit, repeat })
    if (repeat) {
      setSpecs({})
      setBrand(null)
      setFreeSpec("")
    }
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
            <Input id="mat-outside" value={outside} onChange={(e) => setOutside(e.target.value)} placeholder={t("free_material")} dir="auto" />
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
        ) : q.trim() && !showsDetail ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("tree_no_match")}</p>
        ) : showsDetail && node ? (
          <div className="space-y-4">
            <p className="text-sm font-bold">{pathLabel(path, locale, true)}</p>
            <MaterialSpecChoices index={index} nodeId={node.id} value={specs} onChange={setSpecs} />
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
              <div className="flex flex-wrap items-center gap-2">
                {brandsOf(index, node.id).length > 0 && (
                  <NativeSelect
                    value={brand ? brand.ar : ""}
                    onChange={(e) => setBrand(brandsOf(index, node.id).find((b) => b.ar === e.target.value) || null)}
                    aria-label={t("brand")}
                    className="h-9 w-56"
                  >
                    <option value="">{t("brand_any")}</option>
                    {brandsOf(index, node.id).map((b) => (
                      <option key={b.ar} value={b.ar}>
                        {label(b, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                <Input value={freeSpec} onChange={(e) => setFreeSpec(e.target.value)} placeholder={t("free_spec")} aria-label={t("free_spec")} className="h-9 w-56" dir="auto" />
              </div>
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
                      pickedSub && "border-module bg-module/10",
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
          <div className="space-y-1">
            {outside == null ? (
              <button type="button" onClick={() => setOutside(q || "")} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
                <PenLine size={13} aria-hidden="true" /> {t("not_listed")} {t("write_as_is")} · {t("tagged_outside")}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">{outsideSub ? t("outside_sub_chosen", { sub: label(outsideSub, locale) }) : t("outside_pick_sub")}</p>
            )}
            {!showsDetail && <p className="text-xs text-muted-foreground">{outside == null ? t("tree_cap_mat") : t("tree_cap_sub")}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {outside == null && !target && (
              <Button type="button" variant="outline" disabled={!showsDetail || (units.length > 1 && !unit)} onClick={() => submit(true)}>
                {t("add_and_repeat")}
              </Button>
            )}
            <Button type="button" disabled={outside != null ? !outsideSub || !outside.trim() : !showsDetail || (units.length > 1 && !unit)} onClick={() => submit(false)}>
              {target ? t("put_in_row") : t("add_to_row")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
