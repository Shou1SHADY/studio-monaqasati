"use client"

// The shared pieces of the free journey's pages (PRD NAV-07): the page template — title, description and main
// action, three page figures each opening its list, segments with counts, tools, the list — plus the small parts
// every list shares: the figure card, the deal pills, the cards/rows switch (remembered per page, working even
// when browser storage is blocked), the show-more row.

import { useCallback, useEffect, useState, type ElementType, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { LayoutGrid, Rows3, ShieldCheck } from "lucide-react"
import { Link, usePathname, useRouter } from "@/i18n/routing"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { cn } from "@/lib/utils"
import type { Deal } from "@/lib/supplier-free/types"
import type { Free } from "./useFree"

// ---- The page template ----------------------------------------------------------------------------

export interface PageKpi {
  id: string
  icon: ElementType
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  tone?: "warn" | "up" | "down" | "neutral"
  href?: string
}

const KPI_SUB: Record<NonNullable<PageKpi["tone"]>, string> = {
  warn: "bg-warning/10 text-warning",
  up: "bg-success/10 text-success",
  down: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
}

export function Kpi({ k }: { k: PageKpi }) {
  const Icon = k.icon
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon size={14} className="shrink-0 text-module" aria-hidden="true" />
        <span className="line-clamp-2">{k.label}</span>
      </p>
      <p className="mt-1.5 text-2xl font-black tabular-nums text-foreground" dir="ltr">
        {k.value}
        {k.unit && <small className="ms-1 text-xs font-bold text-muted-foreground">{k.unit}</small>}
      </p>
      {k.sub && <p className={cn("mt-1.5 inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold", KPI_SUB[k.tone ?? "neutral"])}>{k.sub}</p>}
    </>
  )
  const cls = "block rounded-xl border bg-card p-4 text-start transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  return k.href ? (
    <Link href={k.href as never} className={cls}>
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border bg-card p-4">{body}</div>
  )
}

export function FreePage({
  icon: Icon,
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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-black text-foreground">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-module/10 text-module">
              <Icon size={18} aria-hidden="true" />
            </span>
            {title}
          </h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {kpis && kpis.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {kpis.map((k) => (
            <Kpi key={k.id} k={k} />
          ))}
        </div>
      )}
      {children}
    </div>
  )
}

// ---- Address state: every screen, drawer and quote form opens by its address (NAV-06) -------------------

/** The page's query string, read and rewritten without a scroll jump. Empty values leave the address. */
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
    (patch: Record<string, string | null | undefined>, opts?: { push?: boolean }) => {
      const url = href(patch)
      if (opts?.push) router.push(url as never, { scroll: false })
      else router.replace(url as never, { scroll: false })
    },
    [href, router]
  )
  return { get, set, href, params }
}

// ---- Cards or rows, remembered per page ------------------------------------------------------------------

export type ViewMode = "cards" | "rows"

export function useViewMode(page: string): [ViewMode, (v: ViewMode) => void] {
  const [view, setView] = useState<ViewMode>("cards")
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`mdmak.supplierFree.view.${page}`)
      if (saved === "rows" || saved === "cards") setView(saved)
    } catch {
      /* storage blocked: the default view stays */
    }
  }, [page])
  const set = useCallback(
    (v: ViewMode) => {
      setView(v)
      try {
        window.localStorage.setItem(`mdmak.supplierFree.view.${page}`, v)
      } catch {
        /* the choice just is not remembered */
      }
    },
    [page]
  )
  return [view, set]
}

export function ViewToggle({ view, onChange, f }: { view: ViewMode; onChange: (v: ViewMode) => void; f: Free }) {
  const items: [ViewMode, ElementType, string][] = [
    ["cards", LayoutGrid, f.t("vCards")],
    ["rows", Rows3, f.t("vRows")],
  ]
  return (
    <div role="group" aria-label={f.t("viewAs")} className="inline-flex rounded-lg border bg-card p-0.5">
      {items.map(([k, Icon, label]) => (
        <button
          key={k}
          type="button"
          aria-pressed={view === k}
          onClick={() => onChange(k)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            view === k ? "bg-module text-module-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon size={14} aria-hidden="true" />
          {label}
        </button>
      ))}
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
export function GroupHead({ label, n, value, tone }: { label: string; n: number; value?: string; tone?: "r" | "a" | "m" | "g" }) {
  const dot = tone === "r" ? "bg-destructive" : tone === "a" ? "bg-warning" : tone === "g" ? "bg-success" : "bg-muted-foreground/40"
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
  const key = kind === "rfq" ? "dwRfq" : kind === "po" ? "dwPo" : kind === "grn" ? "dwGrn" : "dwInv"
  return f.t(key, { no: kind === "grn" ? no.replace(/^\D+-?/, "") : no })
}

export const dealPlace = (d: Deal) => d.city.split(" — ")[1] || d.city

/** "100% after 30 days" / "50% after 15 days, 50% after 30 days". */
export function termsText(f: Free, terms: { pct: number; days: number }[]): string {
  if (terms.length === 1) return f.t("termsFull", { d: f.pl("pl_day", terms[0].days) })
  return terms.map((x) => f.t("termsPart", { p: f.fmt.n(x.pct), d: f.pl("pl_day", x.days) })).join(f.t("termsJoin")) + f.t("termsTail")
}
