"use client"

// The Manufacturing frame: the module title with what this tab is for, the
// role the viewer's Today is shown as (only when they hold more than one of
// the five roles), the tab's one create action, and the tab rail — each tab a
// real URL with the count that says whether it needs attention.
//
// No KPIs here: headline figures belong to each role's Today, and the Workshop
// has none (WS-01). No "request manufacturing" button either: requests arrive
// from Sales and Procurement, never from inside the module (REQ-01).

import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarCheck2, ClipboardList, Factory, Inbox, Layers, Plus, Search, SlidersHorizontal, UserCog } from "lucide-react"
import { Link, useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { Persona } from "@/lib/manufacturing-engine"
import { compareWorkshop, matchesSearch, myStations } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { sourceNameOf } from "./MfgOrderBits"

export type MfgTabId = "today" | "workshop" | "requests" | "products" | "settings"

interface TabDef {
  id: MfgTabId
  segment: string
  labelKey: string
  icon: ElementType
}

const TABS: TabDef[] = [
  { id: "today", segment: "", labelKey: "mfw_tab_today", icon: CalendarCheck2 },
  { id: "workshop", segment: "workshop", labelKey: "mfw_tab_workshop", icon: ClipboardList },
  { id: "requests", segment: "requests", labelKey: "mfw_tab_requests", icon: Inbox },
  { id: "products", segment: "products", labelKey: "mfw_tab_products", icon: Layers },
  { id: "settings", segment: "settings", labelKey: "mfw_tab_settings", icon: SlidersHorizontal },
]

/** The Workshop's own search field — Ctrl/⌘K focuses it on that tab. */
export const WORKSHOP_SEARCH_ID = "mfw-search"

export function MfgShell({ tab, children }: { tab: MfgTabId; children: ReactNode }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const router = useRouter()
  const ui = useMfgUi()
  const { data, perms, base } = ui

  const full = perms.canManage || perms.canCost || perms.canView
  const visible = TABS.filter((tb) => tb.id === "today" || tb.id === "workshop" || full)

  const counts: Partial<Record<MfgTabId, number>> = {
    today: ui.decisions.length,
    workshop: ui.views.filter((v) => v.live).length,
    requests: data.requests.filter((r) => r.status === "new").length,
    products: data.products.filter((p) => !p.archived).length,
  }

  const subtitle = tab === "today" ? t(`mfw_sub_today_${ui.persona || "none"}`) : t(`mfw_sub_${tab}`)

  const switchPersona = (p: Persona) => {
    ui.setPersona(p)
    // Switching the role returns to Today (TD-03).
    if (tab !== "today") router.push(base)
  }

  return (
    <div className="min-w-0 space-y-5" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-warning/10 text-warning">
            <Factory size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-primary">{t("mfw_module_title")}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ms-auto">
          {ui.personas.length > 1 && ui.persona && <PersonaSwitch value={ui.persona} onChange={switchPersona} />}
          {tab !== "workshop" && <MfgJumpSearch />}
          {tab === "workshop" && perms.canManage && (
            <Button className="h-10 gap-2" onClick={() => ui.openGlobal({ kind: "stockOrder" })} disabled={!data.products.length}>
              <Plus size={16} aria-hidden="true" />
              {t("mfw_action_stock_order")}
            </Button>
          )}
          {tab === "products" && perms.canManage && (
            <Button className="h-10 gap-2" onClick={() => ui.openGlobal({ kind: "product" })}>
              <Plus size={16} aria-hidden="true" />
              {t("mfw_action_new_product")}
            </Button>
          )}
        </div>
      </div>

      <nav aria-label={t("mfw_module_title")} className="border-b border-border">
        <ul className="-mb-px flex items-center gap-1 overflow-x-auto">
          {visible.map((tb) => {
            const href = tb.segment ? `${base}/${tb.segment}` : base
            const isActive = tb.id === tab
            const Icon = tb.icon
            const count = counts[tb.id]
            return (
              <li key={tb.id}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive ? "border-warning text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  )}
                >
                  <Icon size={15} className={cn("shrink-0", isActive && "text-warning")} aria-hidden="true" />
                  {t(tb.labelKey)}
                  {count != null && count > 0 && (
                    <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums", isActive ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
                      {count}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <ShortcutK tab={tab} />
      {children}
    </div>
  )
}

/** "Today as …" — only the five manufacturing roles the viewer holds. */
function PersonaSwitch({ value, onChange }: { value: Persona; onChange: (p: Persona) => void }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const leadStations = useMemo(() => {
    const ids = myStations(ui.data.engineActor, ui.data.departments, "lead")
    return ui.data.departments.filter((d) => ids.includes(d.id)).map((d) => d.name)
  }, [ui.data.engineActor, ui.data.departments])
  const label = (p: Persona) => (p === "lead" && leadStations.length ? t("mfg4_role_lead_of", { stations: leadStations.join(t("mfw_list_sep")) }) : t(`mfg4_persona_${p}`))
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <UserCog size={14} aria-hidden="true" /> {t("mfg4_view_as")}
      </span>
      <Select value={value} onValueChange={(v) => onChange(v as Persona)}>
        <SelectTrigger className="h-10 w-auto min-w-[160px] max-w-[260px] gap-2 text-xs font-semibold" aria-label={t("mfg4_view_as")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ui.personas.map((p) => (
            <SelectItem key={p} value={p} className="text-xs">
              {label(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Ctrl/⌘K: on the Workshop it focuses the Workshop search; elsewhere the
 * header search, whose Enter opens the Workshop filtered by the query. */
function ShortcutK({ tab }: { tab: MfgTabId }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return
      e.preventDefault()
      const id = tab === "workshop" ? WORKSHOP_SEARCH_ID : "mfw-jump-search"
      const el = document.getElementById(id) as HTMLInputElement | null
      el?.focus()
      el?.select()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tab])
  return null
}

/** Search every order from any tab: the best hits open the order in place,
 * Enter shows every match in the Workshop. */
function MfgJumpSearch() {
  const t = useTranslations("Portal.Shared")
  const router = useRouter()
  const ui = useMfgUi()
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  const { views, nextStepOf } = ui
  const hits = useMemo(() => {
    if (!q.trim()) return []
    const matched = views.filter((v) => matchesSearch(v, q))
    const withStep = new Set(matched.filter((v) => nextStepOf(v)).map((v) => v.id))
    return matched.sort(compareWorkshop((v) => withStep.has(v.id))).slice(0, 5)
  }, [q, views, nextStepOf])

  const go = () => {
    const query = q.trim()
    if (!query) return
    setOpen(false)
    router.push(`${ui.base}/workshop?q=${encodeURIComponent(query)}`)
  }

  return (
    <div ref={boxRef} className="relative w-full sm:w-64">
      <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        id="mfw-jump-search"
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go()
          if (e.key === "Escape") setOpen(false)
        }}
        placeholder={t("mfw_jump_placeholder")}
        aria-label={t("mfw_jump_placeholder")}
        className="h-10 w-full rounded-xl border border-input bg-white pe-12 ps-8 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <kbd className="pointer-events-none absolute end-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground sm:block" dir="ltr">
        Ctrl K
      </kbd>
      {open && q.trim() && (
        <div className="absolute inset-x-0 top-11 z-40 overflow-hidden rounded-xl border bg-white shadow-lg">
          {hits.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t("mfw_jump_empty")}</p>}
          {hits.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                setOpen(false)
                ui.openOrder(v.id)
              }}
              className="flex min-h-[40px] w-full items-center gap-2 px-3 py-2 text-start text-xs hover:bg-warning/5 focus-visible:bg-warning/5 focus-visible:outline-none"
            >
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground" dir="ltr">
                {v.ref}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{v.product.name}</span>
              <span className="max-w-[35%] truncate text-[11px] text-muted-foreground">{sourceNameOf(v, t)}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={go}
            className="w-full border-t bg-muted/30 px-3 py-2 text-start text-[11px] font-semibold text-cta hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {t("mfw_jump_all", { q: q.trim() })}
          </button>
        </div>
      )}
    </div>
  )
}
