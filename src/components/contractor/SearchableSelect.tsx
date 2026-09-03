"use client"

import { useState, useRef, useEffect, useLayoutEffect, useId } from "react"
import { createPortal } from "react-dom"
import { useLocale } from "next-intl"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Search, ChevronDown, Check } from "lucide-react"

export interface SearchableSelectOption {
  value: string
  label: string
}

export interface SearchableSelectProps {
  value: string
  onChange: (v: string) => void
  options: SearchableSelectOption[]
  placeholder: string
  searchPlaceholder: string
  noResultsText: string
  disabled?: boolean
  error?: boolean
  /** "sm" fits inline in compact toolbars/headers (e.g. a table row); "md" matches h-10 filter-bar controls. Default is form-field sized. */
  size?: "default" | "sm" | "md"
}

const POPUP_GAP = 4
const PREFERRED_POPUP_HEIGHT = 280

interface PopupCoords {
  left: number
  width: number
  maxHeight: number
  top?: number
  bottom?: number
}

export function SearchableSelect({ value, onChange, options, placeholder, searchPlaceholder, noResultsText, disabled, error, size = "default" }: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [coords, setCoords] = useState<PopupCoords | null>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const locale = useLocale()
  const isRTL = locale === 'ar'

  // Popup renders in a portal positioned from the trigger's viewport rect — this lets it
  // escape any ancestor's overflow-hidden (e.g. the wizard Card) instead of being clipped.
  // It also flips above the trigger and caps its own height when there isn't enough room
  // below (e.g. a field near the bottom of the screen), so it never runs off-viewport.
  const updateCoords = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const spaceBelow = viewportHeight - rect.bottom - POPUP_GAP
    const spaceAbove = rect.top - POPUP_GAP
    const openUpward = spaceBelow < PREFERRED_POPUP_HEIGHT && spaceAbove > spaceBelow
    // When the trigger sits inside a Radix dialog, the popup must portal INTO the dialog content,
    // not <body>: the dialog's focus trap immediately steals focus back from anything outside it,
    // which made the search input untypable. The dialog content is also CSS-transformed, making it
    // the containing block for position:fixed descendants — so offsets are computed against its
    // rect instead of the viewport's origin.
    const dialog = triggerRef.current.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]')
    const dRect = dialog?.getBoundingClientRect()
    setPortalTarget(dialog ?? null)
    // A trigger squeezed into a table cell can be far too narrow to read the
    // options in — the popup takes a usable minimum width and shifts back from
    // the container edge instead of inheriting the squeeze.
    const containerLeft = dRect?.left ?? 0
    const containerRight = dRect?.right ?? window.innerWidth
    const width = Math.min(Math.max(rect.width, 280), containerRight - containerLeft - 16)
    const left = Math.max(8, Math.min(rect.left - containerLeft, containerRight - containerLeft - width - 8))
    setCoords({
      left,
      width,
      maxHeight: Math.min(PREFERRED_POPUP_HEIGHT, Math.max(120, openUpward ? spaceAbove : spaceBelow)),
      ...(openUpward
        ? { bottom: (dRect ? dRect.bottom : viewportHeight) - rect.top + POPUP_GAP }
        : { top: rect.bottom + POPUP_GAP - (dRect?.top ?? 0) }),
    })
  }

  useLayoutEffect(() => {
    if (open) updateCoords()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        popupRef.current && !popupRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
        setSearch("")
      }
    }
    const handleReposition = () => updateCoords()
    document.addEventListener("mousedown", handleClick)
    window.addEventListener("scroll", handleReposition, true)
    window.addEventListener("resize", handleReposition)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      window.removeEventListener("scroll", handleReposition, true)
      window.removeEventListener("resize", handleReposition)
    }
  }, [open])

  const filtered = options.filter(opt =>
    !search.trim() || opt.label.toLowerCase().includes(search.toLowerCase().trim())
  )
  const selectedLabel = options.find(o => o.value === value)?.label

  // Keep the highlighted option in range as the filtered list shrinks/grows with each keystroke.
  useEffect(() => {
    setActiveIndex(0)
  }, [search, open])

  // Keep the keyboard-highlighted option scrolled into view as the user arrows past the visible edge.
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const selectOption = (opt: SearchableSelectOption) => {
    onChange(opt.value)
    setOpen(false)
    setSearch("")
    triggerRef.current?.focus()
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      setSearch("")
      triggerRef.current?.focus()
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (filtered[activeIndex]) selectOption(filtered[activeIndex])
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { if (!disabled) { setOpen(p => !p); setSearch("") } }}
        className={cn(
          "w-full flex items-center justify-between rounded-xl border bg-white text-start transition-colors",
          size === "sm" ? "h-8 px-3 rounded-lg" : size === "md" ? "h-10 px-3 rounded-xl" : "h-11 px-4",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          disabled
            ? "opacity-50 cursor-not-allowed bg-slate-50 border-slate-200"
            : error
              ? "border-destructive ring-1 ring-destructive"
              : open
                ? "border-primary/60 ring-1 ring-primary/20"
                : value
                  ? "border-slate-200 text-slate-800 hover:border-primary/60"
                  : "border-slate-200 text-slate-400 hover:border-primary/60"
        )}
      >
        <span className={cn("truncate", size === "sm" ? "text-xs" : "text-sm")}>{selectedLabel || placeholder}</span>
        <ChevronDown size={size === "sm" ? 13 : 16} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={popupRef}
          data-searchable-select-popup=""
          style={{
            position: "fixed",
            left: coords.left,
            width: coords.width,
            maxHeight: coords.maxHeight,
            // Radix modal dialogs set pointer-events:none on <body>; this popup portals to body,
            // so it must re-enable pointer events explicitly or it's unclickable inside a dialog.
            pointerEvents: "auto",
            ...(coords.top !== undefined ? { top: coords.top } : { bottom: coords.bottom }),
          }}
          className="z-[60] flex flex-col bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
        >
          <div className="px-3 pt-3 pb-2 shrink-0">
            <div className="relative">
              <Search size={14} className={cn("absolute top-1/2 -translate-y-1/2 text-slate-400", isRTL ? "right-3" : "left-3")} />
              <Input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                dir={isRTL ? "rtl" : "ltr"}
                role="combobox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-activedescendant={filtered[activeIndex] ? `${listboxId}-${filtered[activeIndex].value}` : undefined}
                className={cn("h-9 text-sm rounded-lg bg-slate-100 border-slate-200 focus-visible:ring-primary focus-visible:border-primary", isRTL ? "pr-9 pl-3" : "pl-9 pr-3")}
              />
            </div>
          </div>
          <div ref={listRef} id={listboxId} role="listbox" className="overflow-y-auto divide-y divide-slate-100">
            {filtered.map((opt, idx) => {
              const isSelected = opt.value === value
              const isActive = idx === activeIndex
              return (
                <button
                  key={opt.value}
                  id={`${listboxId}-${opt.value}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => selectOption(opt)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                    isRTL ? "text-right" : "text-left",
                    isActive ? "bg-primary/5" : "hover:bg-primary/5"
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors",
                    isSelected ? "bg-primary border-primary" : "border-slate-300 bg-white"
                  )}>
                    {isSelected && <Check size={8} className="text-white" strokeWidth={3} />}
                  </div>
                  <span className={cn("min-w-0 flex-1 break-words", isSelected ? "font-bold text-primary" : "text-slate-700")}>{opt.label}</span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-4 py-3 text-sm text-slate-400 text-center">{noResultsText}</p>
            )}
          </div>
        </div>,
        portalTarget ?? document.body
      )}
    </>
  )
}
