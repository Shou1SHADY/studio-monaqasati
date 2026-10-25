"use client"

// The row's empty cell (PUR-02/04): typing searches the material tree, the pick fills
// the row (material, its spec cells with the values the words named, its unit).
// Enter takes the highlighted result; «خيارات ▾» on a result opens its specs and a quantity so the row is
// filled in one go; «الأكثر طلباً» under the box adds six common materials in one tap; «تصفّح شجرة المواد» opens
// the browser; «غير موجود؟ اكتبه كما هو» keeps the words as a material outside the list.

import { useId, useMemo, useRef, useState, type Ref } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronDown, FolderTree, PenLine, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { MaterialOptionsPanel, type OptionsResult } from "@/components/materials/MaterialOptionsPanel"
import { cn } from "@/lib/utils"
import { isHeavyEquipmentRental } from "@/lib/materials/equipment"
import { popularChips } from "@/lib/materials/popular"
import { label, pathLabel, searchMaterials, shortSpecName, specsOf, unitsOf, type MaterialHit, type MaterialIndex } from "@/lib/materials/tree"

export function MaterialSearchInput({
  index,
  onPick,
  onBrowse,
  onFreeText,
  onPickOptions,
  onQuick,
  placeholder,
  ariaLabel,
  autoFocus,
  className,
  pmOn = false,
  inputRef,
}: {
  index: MaterialIndex | null
  onPick: (hit: MaterialHit) => void
  onBrowse: (query: string) => void
  onFreeText: (text: string) => void
  /** Shows «خيارات ▾» on each result: the row is added with the specs chosen and a quantity. */
  onPickOptions?: (r: OptionsResult) => void
  /** Shows «الأكثر طلباً» under the box: a chip adds its material with its usual specs. */
  onQuick?: (hit: MaterialHit) => void
  placeholder?: string
  ariaLabel?: string
  autoFocus?: boolean
  className?: string
  /** Project Management is on for this company: a heavy-equipment rental goes to its equipment desk. */
  pmOn?: boolean
  /** The box itself — the editor brings focus back here after Enter in a row's quantity (ED-03). */
  inputRef?: Ref<HTMLInputElement>
}) {
  const t = useTranslations("Portal.Materials")
  const locale = useLocale()
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [optionsFor, setOptionsFor] = useState<MaterialHit | null>(null)
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const hits = useMemo(() => (index && q.trim() ? searchMaterials(index, q, 6) : []), [index, q])
  const chips = useMemo(() => (onQuick ? popularChips(index) : []), [onQuick, index])
  // Two extra rows after the hits: browse, and «type it as is».
  const total = hits.length + 2
  const rental = isHeavyEquipmentRental(q)
  const toDesk = rental && pmOn

  const reset = () => {
    setQ("")
    setActive(0)
    setOpen(false)
    setOptionsFor(null)
  }
  const choose = (i: number) => {
    if (i < hits.length) onPick(hits[i])
    else if (i === hits.length) onBrowse(q)
    else if (q.trim() && !toDesk) onFreeText(q.trim())
    else return
    reset()
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        ref={rootRef}
        className="relative"
        onBlur={(e) => {
          if (rootRef.current?.contains(e.relatedTarget as Node | null)) return
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
              setOpen(false)
              setOptionsFor(null)
            }
          }, 150)
        }}
      >
        <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={inputRef}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
            setActive(0)
            setOptionsFor(null)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setOpen(true)
              setActive((a) => (a + 1) % total)
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((a) => (a - 1 + total) % total)
            } else if (e.key === "Enter") {
              if (!q.trim()) return
              e.preventDefault()
              if (toDesk && !hits.length) return
              choose(hits.length ? active : hits.length + 1)
            } else if (e.key === "Escape") {
              setOpen(false)
              setOptionsFor(null)
            }
          }}
          placeholder={placeholder ?? t("search_placeholder")}
          aria-label={ariaLabel ?? t("search_placeholder")}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="h-10 ps-9 pe-10"
          dir="auto"
        />
        <button
          type="button"
          onClick={() => onBrowse(q)}
          title={t("browse")}
          aria-label={t("browse")}
          className="absolute end-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FolderTree size={16} aria-hidden="true" />
        </button>
        {open && (
          <div id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
            {optionsFor && index ? (
              <div
                onMouseDown={(e) => {
                  if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
                }}
              >
                <MaterialOptionsPanel
                  index={index}
                  hit={optionsFor}
                  onBack={() => setOptionsFor(null)}
                  onAdd={(r) => {
                    onPickOptions?.(r)
                    reset()
                  }}
                />
              </div>
            ) : (
              <>
                {!index && <p className="px-3 py-2 text-xs text-muted-foreground">{t("loading")}</p>}
                {rental && (
                  <p role="note" className="mx-1 mb-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {toDesk ? t("equipment_note_pm") : t("equipment_note")}{" "}
                    {toDesk && (
                      <a href={locale === "en" ? "/en/contractor/projects" : "/contractor/projects"} className="font-semibold underline">
                        {t("equipment_open_pm")}
                      </a>
                    )}
                  </p>
                )}
                {hits.map((h, i) => {
                  const units = unitsOf(index as MaterialIndex, h.node.id)
                  // ED-04: the specs the words did not name, dimmed after the preset ones — what can still be chosen.
                  const rest = specsOf(index as MaterialIndex, h.node.id).filter((s) => !h.preset.some((p) => p.spec.ar === s.ar))
                  return (
                    <div key={h.node.id} className={cn("flex items-center gap-1 rounded-md", i === active ? "bg-module/10" : "hover:bg-muted")}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(i)}
                        onMouseEnter={() => setActive(i)}
                        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-3 py-2 text-start"
                      >
                        <span className="flex w-full items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{label(h.node, locale)}</span>
                          {i === active && (
                            <kbd className="ms-auto rounded border bg-background px-1.5 py-px font-sans text-[10px] font-semibold text-muted-foreground" dir="ltr">
                              {t("enter_key")}
                            </kbd>
                          )}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{pathLabel(h.path, locale)}</span>
                        <span className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                          {h.preset.map((p) => (
                            <span key={p.spec.ar}>
                              {label(shortSpecName(p.spec), locale)}: <b className="font-semibold text-foreground">{label(p.value, locale)}</b>
                            </span>
                          ))}
                          {rest.map((s) => (
                            <span key={`r-${s.ar}`} className="text-muted-foreground/70">
                              {label(shortSpecName(s), locale)}
                            </span>
                          ))}
                          {units.length > 0 && <span>{t("unit_is", { unit: units.map((u) => label(u, locale)).join(" · ") })}</span>}
                        </span>
                      </button>
                      {onPickOptions && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setOptionsFor(h)}
                          aria-label={t("options_for", { name: label(h.node, locale) })}
                          className="me-1 inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border bg-background px-2.5 text-[11px] font-bold text-module hover:bg-module/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t("options")} <ChevronDown size={12} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )
                })}
                {index && q.trim() && hits.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">{t("no_match")}</p>}
                <div className="mt-1 flex flex-wrap gap-1 border-t pt-1">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active === hits.length}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(hits.length)}
                    className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-module", active === hits.length ? "bg-module/10" : "hover:bg-muted")}
                  >
                    <FolderTree size={14} aria-hidden="true" />
                    {t("browse")}
                  </button>
                  {q.trim() && !toDesk && (
                    <button
                      type="button"
                      role="option"
                      aria-selected={active === hits.length + 1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(hits.length + 1)}
                      className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-muted-foreground", active === hits.length + 1 ? "bg-muted" : "hover:bg-muted")}
                    >
                      <PenLine size={14} aria-hidden="true" />
                      {t("not_listed")} {t("write_as_is")}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{t("popular_title")}</span>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onQuick?.(c.hit)}
              className="inline-flex min-h-7 items-center rounded-full border bg-background px-2.5 text-[11px] font-semibold text-foreground transition-colors hover:border-module hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t(`popular_${c.key}`)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onBrowse("")}
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-dashed bg-background px-2.5 text-[11px] font-semibold text-module transition-colors hover:bg-module/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FolderTree size={12} aria-hidden="true" />
            {t("popular_browse")}
          </button>
        </div>
      )}
    </div>
  )
}
