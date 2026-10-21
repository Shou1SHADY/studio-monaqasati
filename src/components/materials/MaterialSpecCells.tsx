"use client"

// The row's specification cells (PUR-04): each spec of the material is a small cell
// with its options («المقاس 16 مم», «الدرجة G60»), and «+» adds an unchosen spec, a
// brand of the material's category, or a free spec typed as words. The same cells
// wherever a material is asked for.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Plus, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { brandsOf, label, shortSpecName, specsOf, type MaterialIndex } from "@/lib/materials/tree"
import type { MaterialPick, MaterialSpec, MaterialText } from "@/lib/materials/types"

const optionKey = (o: MaterialText) => `${o.ar}|${o.en}`

const cellClass =
  "inline-flex min-h-8 items-center gap-1 rounded-md border bg-background px-2 text-xs transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function MaterialSpecCells({ index, pick, onChange, readOnly }: { index: MaterialIndex | null; pick: MaterialPick; onChange?: (p: MaterialPick) => void; readOnly?: boolean }) {
  const t = useTranslations("Portal.Materials")
  const locale = useLocale()
  const [freeOpen, setFreeOpen] = useState(false)
  const [freeName, setFreeName] = useState("")
  const [freeValue, setFreeValue] = useState("")
  const specs: MaterialSpec[] = index && !pick.outside ? specsOf(index, pick.nodeId) : []
  const brands = index && !pick.outside ? brandsOf(index, pick.nodeId) : []
  const valueOf = (s: MaterialSpec) => pick.specs.find((x) => !x.free && x.name.ar === shortSpecName(s).ar)
  const shown = specs.filter((s) => valueOf(s))
  const unchosen = specs.filter((s) => !valueOf(s))

  const setSpec = (s: MaterialSpec, value: MaterialText | null) => {
    const name = shortSpecName(s)
    const rest = pick.specs.filter((x) => x.free || x.name.ar !== name.ar)
    onChange?.({ ...pick, specs: value ? [...rest, { name, value }] : rest })
  }

  if (readOnly || !onChange) {
    return (
      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {pick.specs.map((x) => (
          <span key={`${x.name.ar}-${x.value.ar}`}>
            {label(x.name, locale)}{" "}
            <b className="font-semibold text-foreground" dir="auto">
              {label(x.value, locale)}
            </b>
          </span>
        ))}
        {pick.brand && <b className="font-semibold text-foreground">{label(pick.brand, locale)}</b>}
        {!pick.specs.length && !pick.brand && <span>—</span>}
      </span>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((s) => {
        const v = valueOf(s)!
        return (
          <DropdownMenu key={s.ar}>
            <DropdownMenuTrigger className={cellClass} aria-label={`${label(shortSpecName(s), locale)}: ${label(v.value, locale)}`}>
              <span className="text-muted-foreground">{label(shortSpecName(s), locale)}</span>
              <b className="font-semibold" dir="auto">
                {label(v.value, locale)}
              </b>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              <DropdownMenuRadioGroup value={optionKey(v.value)} onValueChange={(val) => setSpec(s, s.options.find((o) => optionKey(o) === val) || null)}>
                {s.options.map((o, i) => (
                  <DropdownMenuRadioItem key={`${optionKey(o)}-${i}`} value={optionKey(o)}>
                    <span dir="auto">{label(o, locale)}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setSpec(s, null)} className="text-destructive">
                {t("remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}
      {pick.specs
        .filter((x) => x.free)
        .map((x) => (
          <span key={`f-${x.name.ar}`} className={cn(cellClass, "pe-1")}>
            <span className="text-muted-foreground">{x.name.ar}</span>
            <b className="font-semibold" dir="auto">
              {x.value.ar}
            </b>
            <button type="button" onClick={() => onChange({ ...pick, specs: pick.specs.filter((y) => y !== x) })} aria-label={t("remove")} className="rounded p-0.5 hover:bg-muted">
              <X size={12} />
            </button>
          </span>
        ))}
      {pick.brand && (
        <span className={cn(cellClass, "pe-1")}>
          <b className="font-semibold">{label(pick.brand, locale)}</b>
          <button type="button" onClick={() => onChange({ ...pick, brand: null })} aria-label={t("remove")} className="rounded p-0.5 hover:bg-muted">
            <X size={12} />
          </button>
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(cellClass, "text-muted-foreground")} aria-label={t("add_spec")}>
          <Plus size={12} aria-hidden="true" />
          {!shown.length && !pick.brand && !pick.specs.length && <span>{t("spec")}</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {unchosen.map((s) => (
            <div key={s.ar}>
              <DropdownMenuLabel className="text-xs">{label(shortSpecName(s), locale)}</DropdownMenuLabel>
              {s.options.slice(0, 14).map((o, i) => (
                <DropdownMenuItem key={`${optionKey(o)}-${i}`} onSelect={() => setSpec(s, o)}>
                  <span dir="auto">{label(o, locale)}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </div>
          ))}
          {brands.length > 0 && !pick.brand && (
            <>
              <DropdownMenuLabel className="text-xs">{t("brand")}</DropdownMenuLabel>
              {brands.map((b) => (
                <DropdownMenuItem key={b.ar} onSelect={() => onChange({ ...pick, brand: b })}>
                  {label(b, locale)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => setFreeOpen(true)}>{t("add_free_spec")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={freeOpen} onOpenChange={setFreeOpen}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("add_free_spec")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input value={freeName} onChange={(e) => setFreeName(e.target.value)} placeholder={t("free_spec_name")} aria-label={t("free_spec_name")} dir="auto" />
            <Input value={freeValue} onChange={(e) => setFreeValue(e.target.value)} placeholder={t("free_spec_value")} aria-label={t("free_spec_value")} dir="auto" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={!freeName.trim() || !freeValue.trim()}
              onClick={() => {
                onChange({ ...pick, specs: [...pick.specs, { name: { ar: freeName.trim(), en: freeName.trim() }, value: { ar: freeValue.trim(), en: freeValue.trim() }, free: true }] })
                setFreeName("")
                setFreeValue("")
                setFreeOpen(false)
              }}
            >
              {t("add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
