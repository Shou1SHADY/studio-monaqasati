"use client"

// The shared pieces of the free journey's pages (PRD NAV-07): the page template — title, description and main
// action, three page figures each opening its list, segments with counts, tools, the list — plus the small parts
// every list shares: the figure card, the deal pills, the cards/rows switch (remembered per page, working even
// when browser storage is blocked), the show-more row.

import { useCallback, useEffect, useState, type ElementType, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { LayoutGrid, List, Search, ShieldCheck } from "lucide-react"
import { usePathname, useRouter } from "@/i18n/routing"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { ModuleHeader, type ModuleKpi, type ModuleTab } from "@/components/module-ui/ModuleHeader"
import { usePortalFrame } from "@/components/layout/portal-frame-context"
import { FREE_SUPPLIER_NAV } from "@/lib/company-modules"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Deal } from "@/lib/supplier-free/types"
import { useWorldReady } from "./FreeWorldProvider"
import type { Free } from "./useFree"

// ---- The page template ----------------------------------------------------------------------------

export interface PageKpi {
  id: string
  icon: ElementType
  label: string
  value: string | number
  unit?: string
  sub?: string
  tone?: "warn" | "up" | "down" | "neutral"
  href?: string
}

/** A page figure as the module header shows it: the unit (the riyal sign) LEFT of the figure, kept together. */
function toModuleKpi(k: PageKpi): ModuleKpi {
  const value = String(k.value)
  return {
    id: k.id,
    icon: k.icon,
    label: k.label,
    value: k.unit ? `${k.unit}\u00a0${value}` : value,
    note: k.sub,
    tone: k.tone === "warn" ? "warn" : k.tone === "up" ? "good" : k.tone === "down" ? "bad" : "neutral",
    href: k.href,
  }
}

/** The sibling pages of the module this page belongs to, as the header's tab rail (every Mdmak module page has one),
 * with the sidebar's counts. */
function useModuleTabs(): { tabs: ModuleTab[]; active?: string } {
  const pathname = usePathname()
  const frame = usePortalFrame()
  const t = useTranslations("Portal.Sidebar")
  const nav = Object.values(FREE_SUPPLIER_NAV).find((items) => items?.some(([href]) => href === pathname))
  if (!nav) return { tabs: [] }
  const tabs = nav
    .filter(([href]) => href !== "/supplier")
    .map(([href, titleKey]): ModuleTab => {
      const b = frame?.navBadges?.[href]
      return { id: href, href, label: t(titleKey), count: typeof b?.n === "number" ? b.n : undefined, urgent: b?.tone === "red" }
    })
  return { tabs, active: pathname }
}

export function FreePage({
  icon,
  title,
  description,
  action,
  kpis,
  children,
}: {
  icon: ElementType
  title: string
  description?: string
  action?: ReactNode
  kpis?: PageKpi[]
  children: ReactNode
}) {
  const ready = useWorldReady()
  const { tabs, active } = useModuleTabs()
  return (
    <div className="space-y-4">
      <ModuleHeader
        icon={icon}
        title={title}
        description={description}
        actions={action}
        kpis={ready ? kpis?.map(toModuleKpi) : undefined}
        tabs={tabs}
        activeTab={active}
        tabsLabel={title}
      />
      {!ready ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-3" role="status" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
      ) : (
        children
      )}
    </div>
  )
}

/** The small action button of a row, card or drawer: the shared Button's look (focus ring, disabled state) at the compact size
 * the lists use, on a link or a plain button. */
export function actionBtn(tone: "primary" | "outline" | "danger" = "primary", size: "sm" | "md" = "sm") {
  return cn(
    buttonVariants({ variant: tone === "primary" ? "default" : "outline", size: "sm" }),
    size === "sm" && "h-8 gap-1.5 px-3 text-xs",
    tone === "danger" && "border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
  )
}

/** The whole card or row opens its deal, not only the title (the prototype's `data-go`): a click on a link, button or field inside keeps its own job. */
export function useRowGo() {
  const router = useRouter()
  return (url: string) => ({
    onClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("a,button,input,label,select,textarea,[role='button']")) return
      router.push(url as never, { scroll: false })
    },
  })
}

// ---- Address state: every screen, drawer and quote form opens by its address (NAV-06) -------------------

/** The page's query string, read and rewritten without a scroll jump. Empty values leave the address. Every change is
 * a new history entry — a segment, a tab, opening or closing the drawer — so the browser's back button walks them back
 * (NAV-06); `{ replace: true }` is for what should not stack up, such as a form that leads straight to its result. */
export function useQueryState() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const get = useCallback((k: string) => params.get(k) || "", [params])
  const href = useCallback(
    (patch: Record<string, string | null | undefined>, base?: string) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === "" || v == null) next.delete(k)
        else next.set(k, v)
      }
      const qs = next.toString()
      return `${base ?? pathname}${qs ? `?${qs}` : ""}`
    },
    [params, pathname]
  )
  const set = useCallback(
    (patch: Record<string, string | null | undefined>, opts?: { replace?: boolean }) => {
      const url = href(patch)
      if (opts?.replace) router.replace(url as never, { scroll: false })
      else router.push(url as never, { scroll: false })
    },
    [href, router]
  )
  return { get, set, href, params }
}

// ---- Cards or rows, remembered per page ------------------------------------------------------------------

export type ViewMode = "cards" | "rows"

/** The choice kept for the session even when browser storage is blocked (RFQ-08): read before storage, so moving
 * between pages keeps it; storage then carries it across visits when it may. */
const viewMemory = new Map<string, ViewMode>()
const viewKey = (page: string) => `mdmak.supplierFree.view.${page}`

export function readView(page: string): ViewMode {
  const kept = viewMemory.get(page)
  if (kept) return kept
  try {
    const saved = window.localStorage.getItem(viewKey(page))
    if (saved === "rows" || saved === "cards") {
      viewMemory.set(page, saved)
      return saved
    }
  } catch {
    /* storage blocked: the default view */
  }
  return "cards"
}

export function writeView(page: string, v: ViewMode): void {
  viewMemory.set(page, v)
  try {
    window.localStorage.setItem(viewKey(page), v)
  } catch {
    /* the choice lives for this session only */
  }
}

export function useViewMode(page: string): [ViewMode, (v: ViewMode) => void] {
  const [view, setView] = useState<ViewMode>(() => viewMemory.get(page) || "cards")
  useEffect(() => setView(readView(page)), [page])
  const set = useCallback(
    (v: ViewMode) => {
      setView(v)
      writeView(page, v)
    },
    [page]
  )
  return [view, set]
}

// ---- Selection that belongs to the list it was made on (RFQ-10) --------------------------------------------

/** Selected ids, emptied whenever the list changes (a filter, a segment, a search), so a bulk action never reaches a
 * card the supplier can no longer see. */
export function useListSelection(listKey: string) {
  const [sel, setSel] = useState<Record<string, boolean>>({})
  useEffect(() => setSel({}), [listKey])
  return [sel, setSel] as const
}

// ---- Rows that stack on a phone (NFR-03, RFQ-07, OFR-11) --------------------------------------------------

/** A list table that becomes three-line cards under 768px: the head hides, every row is a block, the first cell is the
 * title and every other cell carries its label from `data-l` (the prototype's `.tbl.stk`). No horizontal scroll. */
export const stk = {
  wrap: "rounded-xl border bg-card md:overflow-x-auto",
  table: "w-full text-start max-md:block",
  thead: "border-b bg-muted/40 text-[11px] font-bold text-muted-foreground max-md:hidden",
  tbody: "max-md:block",
  tr: "max-md:block max-md:px-3 max-md:py-2",
  /** The first cell: the title block. */
  head: "max-md:block max-md:max-w-none max-md:px-0 max-md:py-0.5 max-md:text-start",
  /** Any other cell: its label at the start, its value at the end. */
  cell: "max-md:flex max-md:min-w-0 max-md:items-center max-md:justify-between max-md:gap-2.5 max-md:px-0 max-md:py-0.5 max-md:text-end max-md:before:shrink-0 max-md:before:text-[11px] max-md:before:font-semibold max-md:before:text-muted-foreground max-md:before:content-[attr(data-l)]",
  /** Buttons: no label, at the end. */
  act: "max-md:flex max-md:justify-end max-md:px-0 max-md:pt-1.5",
  /** Only on wide screens (a select box, a spacer). */
  wide: "max-md:hidden",
}

export function ViewToggle({ view, onChange, f }: { view: ViewMode; onChange: (v: ViewMode) => void; f: Free }) {
  const items: [ViewMode, ElementType, string][] = [
    ["cards", LayoutGrid, f.t("vCards")],
    ["rows", List, f.t("vRows")],
  ]
  return (
    <div role="group" aria-label={f.t("viewAs")} className="flex items-center rounded-xl border bg-card p-1">
      {items.map(([k, Icon, label]) => (
        <button
          key={k}
          type="button"
          aria-pressed={view === k}
          aria-label={label}
          title={label}
          onClick={() => onChange(k)}
          className={cn(
            "grid h-8 w-8 place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            view === k ? "bg-module/10 text-module" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon size={15} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

/** The list's search box, as the portal's lists have it: filters while typing (a short pause, so the address does not
 * stack an entry per letter). */
export function SearchBox({ value, onSearch, placeholder }: { value: string; onSearch: (q: string) => void; placeholder: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  useEffect(() => {
    if (text === value) return
    const id = window.setTimeout(() => onSearch(text.trim()), 250)
    return () => window.clearTimeout(id)
  }, [text])
  return (
    <div className="relative" role="search">
      <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} aria-hidden="true" />
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 w-full rounded-xl bg-card ps-9 sm:w-60" />
    </div>
  )
}

// ---- Pills ------------------------------------------------------------------------------------------------

export function Pill({ tone, children, dot }: { tone: PillTone; children: ReactNode; dot?: boolean }) {
  return (
    <StatusPill tone={tone}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </StatusPill>
  )
}

/** The deadline as a coloured word: closed · today · tomorrow · in N days (red ≤ 1 day, amber ≤ 3). */
export function DeadlinePill({ f, iso }: { f: Free; iso: string }) {
  const n = f.L.daysTo(iso)
  if (n < 0) return <Pill tone="mute">{f.t("dlClosed")}</Pill>
  return (
    <Pill tone={n <= 1 ? "bad" : n <= 3 ? "warn" : "mute"} dot>
      {n === 0 ? f.t("dlToday") : n === 1 ? f.t("dlTomorrow") : f.t("dlIn", { x: f.pl("pl_day", n) })}
    </Pill>
  )
}

export function VerifiedMark({ f, verified }: { f: Free; verified: boolean }) {
  if (!verified) return null
  return (
    <span title={f.t("verified")} className="inline-flex align-middle text-success">
      <ShieldCheck size={14} aria-label={f.t("verified")} />
    </span>
  )
}

/** The due label of a task or quote step: late in red, near in amber, otherwise quiet. */
export function DueText({ f, iso }: { f: Free; iso: string }) {
  const n = f.L.daysTo(iso)
  return <span className={cn("whitespace-nowrap text-xs font-bold", n < 0 ? "text-destructive" : n <= 3 ? "text-warning" : "text-muted-foreground")}>{n < 0 ? f.pl("pl_late", -n) : f.rel(iso)}</span>
}

export function ShowMore({ f, shown, total, onMore }: { f: Free; shown: number; total: number; onMore: () => void }) {
  if (total <= shown) return null
  const next = Math.min(24, total - shown)
  return (
    <button type="button" onClick={onMore} className="mt-3 w-full rounded-xl border bg-card py-3 text-sm font-bold text-module hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {f.t("moreOpps", { n: f.fmt.n(next), m: f.fmt.n(total - shown) })}
    </button>
  )
}

/** A list header for a group: its label, its count from the WHOLE list, optionally its value. */
export function GroupHead({ label, n, value, tone }: { label: string; n: number; value?: string; tone?: "r" | "a" | "b" | "m" | "g" }) {
  const dot = tone === "r" ? "bg-destructive" : tone === "a" ? "bg-warning" : tone === "b" ? "bg-module" : tone === "g" ? "bg-success" : "bg-muted-foreground/40"
  return (
    <div className="mb-2 mt-5 flex items-center gap-2 first:mt-0">
      <span className={cn("h-2.5 w-2.5 rounded-full", dot)} aria-hidden="true" />
      <b className="text-sm">{label}</b>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{n}</span>
      {value && (
        <span className="ms-auto text-xs font-bold tabular-nums text-muted-foreground" dir="ltr">
          {value}
        </span>
      )}
    </div>
  )
}

/** "Request 2026/031" / "Order 2026/041" / "Receipt 1187": the contractor's number written as a word and a number. */
export function docWord(f: Free, kind: "rfq" | "po" | "grn" | "inv", no: string): string {
  // A receipt without a number shows none — never the document id behind it (G-10).
  if (kind === "grn" && !no) return "—"
  const key = kind === "rfq" ? "dwRfq" : kind === "po" ? "dwPo" : kind === "grn" ? "dwGrn" : "dwInv"
  return f.t(key, { no: kind === "grn" ? no.replace(/^\D+-?/, "") : no })
}

export const dealPlace = (d: Deal) => d.city.split(" — ")[1] || d.city

/** "100% after 30 days" / "50% after 15 days, 50% after 30 days". */
export function termsText(f: Free, terms: { pct: number; days: number }[]): string {
  if (terms.length === 1) return f.t("termsFull", { d: f.pl("pl_day", terms[0].days) })
  return terms.map((x) => f.t("termsPart", { p: f.fmt.n(x.pct), d: f.pl("pl_day", x.days) })).join(f.t("termsJoin")) + f.t("termsTail")
}
