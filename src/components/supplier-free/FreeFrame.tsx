"use client"

// The free supplier's frame (PRD NAV-01…05): a right-hand sidebar with eight items in three groups that folds
// to icons and remembers it, a top bar with the global search, language, the bell and the user, and the room
// where the page and the deal drawer live. No horizontal tabs repeat the sidebar.

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { getAuth, signOut } from "firebase/auth"
import {
  Bell,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Link2,
  LogOut,
  MessageSquare,
  PanelRight,
  Search,
  Send,
  Sparkles,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { useSearchParams } from "next/navigation"
import { Link, usePathname, useRouter } from "@/i18n/routing"
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { profileFacts, profilePct } from "@/lib/supplier-free/profile"
import { useFree } from "./useFree"
import { useFreeNotifications } from "./useFreeNotifications"
import { SubscriptionDialog } from "./SubscriptionDialog"

type Tone = "red" | "blue" | "muted"

interface SideItem {
  key: string
  href: string
  icon: LucideIcon
  label: string
  count: number | string
  tone: Tone
}

const RAIL_KEY = "mdmak.supplierFree.rail"
/** Under this width the sidebar opens over the page (the `md` breakpoint every class of the frame switches at). */
export const OVERLAY_BELOW = 768
/** Under this width the sidebar starts folded until the supplier chooses (NAV-02). */
export const FOLD_BELOW = 1100

/** The session's fold choice, kept even when storage is blocked. */
let railMemory: boolean | null = null

/** Folded or not: the supplier's own choice when he made one, else folded under 1100px. */
export function initialRail(width: number): boolean {
  if (railMemory != null) return railMemory
  let saved: string | null = null
  try {
    saved = window.localStorage.getItem(RAIL_KEY)
  } catch {
    saved = null
  }
  return saved === "1" ? true : saved === "0" ? false : width < FOLD_BELOW
}

export function FreeFrame({ children }: { children: ReactNode }) {
  const f = useFree()
  const { t, L, profile } = f
  const pathname = usePathname()
  const router = useRouter()
  const params = useSearchParams()
  const [rail, setRail] = useState(false)
  const [open, setOpen] = useState(false)
  const [upgrade, setUpgrade] = useState(false)
  const [q, setQ] = useState("")

  // The results page shows what was searched in the box that searched it (NAV-04).
  const searched = pathname === "/supplier/search" ? params.get("q") || "" : null
  useEffect(() => {
    if (searched != null) setQ(searched)
  }, [searched])

  useEffect(() => setRail(initialRail(window.innerWidth)), [])
  const toggleRail = useCallback(() => {
    if (window.innerWidth < OVERLAY_BELOW) {
      setOpen((o) => !o)
      return
    }
    setRail((r) => {
      railMemory = !r
      try {
        window.localStorage.setItem(RAIL_KEY, r ? "0" : "1")
      } catch {
        /* storage blocked: remembered for this session only */
      }
      return !r
    })
  }, [])
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const { unread } = useFreeNotifications()
  const bell = unread.length + f.world.invites.length

  // Every badge's number AND colour come from badges() (NAV-03, G-04): one definition for the frame and the tests.
  const badges = L.badges()
  const pct = useMemo(() => (profile ? profilePct(profileFacts(profile.raw)) : 0), [profile])
  const item = (key: keyof typeof badges, href: string, icon: LucideIcon, label: string): SideItem => ({ key, href, icon, label, count: badges[key].n, tone: badges[key].tone })

  const groups: { label: string | null; items: SideItem[] }[] = [
    { label: null, items: [item("home", "/supplier", Zap, t("tToday"))] },
    {
      label: t("sgBefore"),
      items: [item("opps", "/supplier/rfqs", Search, t("navOpps")), item("offers", "/supplier/offers", Send, t("navOffers"))],
    },
    {
      label: t("sgAfter"),
      items: [item("orders", "/supplier/orders", FileText, t("navOrders")), item("invoices", "/supplier/invoices", Wallet, t("navInvoices"))],
    },
    {
      label: t("sgAcct"),
      items: [
        item("connections", "/supplier/connections", Link2, t("navConnections")),
        item("messages", "/supplier/chats", MessageSquare, t("navMessages")),
        { key: "account", href: "/supplier/profile", icon: Building2, label: t("navAccount"), count: pct < 100 ? `${pct}%` : 0, tone: "muted" },
      ],
    },
  ]
  const isActive = (href: string) => (href === "/supplier" ? pathname === "/supplier" : pathname === href || pathname.startsWith(`${href}/`))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = q.trim()
    if (v) router.push(`/supplier/search?q=${encodeURIComponent(v)}`)
  }
  const logout = async () => {
    await signOut(getAuth())
    router.push("/")
  }
  const initial = (profile?.name || profile?.companyName || "?").trim().charAt(0)

  const FoldIcon = f.isAr ? (rail ? ChevronLeft : ChevronRight) : rail ? ChevronRight : ChevronLeft

  return (
    <div data-accent="cta" className="min-h-screen bg-background text-foreground md:flex">
      {open && <button type="button" aria-label={t("sideClose")} className="fixed inset-0 z-[90] bg-primary/60 md:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={cn(
          "z-[95] flex shrink-0 flex-col overflow-y-auto bg-primary text-sidebar-foreground/80 [scrollbar-width:none]",
          "fixed inset-y-0 start-0 w-[272px] shadow-2xl md:sticky md:top-0 md:h-screen md:shadow-none",
          open ? "flex" : "hidden md:flex",
          rail ? "md:w-[72px]" : "md:w-[256px]"
        )}
      >
        <div className={cn("flex items-center gap-2 px-4 pb-2 pt-4", rail && "md:flex-col md:px-0")}>
          <Link href="/supplier" aria-label={t("tToday")} className="flex min-w-0 flex-1 items-center gap-2 text-white">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 font-black">م</span>
            <span className={cn("min-w-0 leading-tight", rail && "md:hidden")}>
              <b className="block truncate text-sm">{t("brandName")}</b>
              <small className="text-[10px] tracking-wide text-sidebar-foreground/60" dir="ltr">
                MDMAK TECH
              </small>
            </span>
          </Link>
          <button
            type="button"
            onClick={toggleRail}
            aria-label={t(rail ? "sideOpen" : "sideClose")}
            title={t(rail ? "sideOpen" : "sideClose")}
            className="hidden h-8 w-8 place-items-center rounded-lg text-sidebar-foreground/60 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:grid"
          >
            <FoldIcon size={16} aria-hidden="true" />
          </button>
        </div>
        <div className={cn("flex gap-1.5 px-4 pb-2 text-[10px] font-bold", rail && "md:hidden")}>
          <span className="rounded-full bg-white/10 px-2 py-0.5">{t("roleSupplier")}</span>
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-accent">{t("planFree")}</span>
        </div>

        <nav aria-label={t("menu")} className="flex-1 px-3 pb-3">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label ? (
                <h6 className={cn("mx-2.5 mb-1.5 mt-4 text-[11px] font-semibold text-sidebar-foreground/60", rail && "md:mx-2 md:my-3 md:h-px md:overflow-hidden md:bg-white/10 md:text-[0px]")}>{g.label}</h6>
              ) : (
                <div className="h-1" />
              )}
              {g.items.map((it) => {
                const on = isActive(it.href)
                const Icon = it.icon
                return (
                  <Link
                    key={it.key}
                    href={it.href}
                    aria-current={on ? "page" : undefined}
                    title={rail ? it.label : undefined}
                    className={cn(
                      "relative mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      on ? "bg-white/10 font-semibold text-white" : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-white",
                      rail && "md:justify-center md:px-0 md:py-3"
                    )}
                  >
                    <Icon size={17} className={cn("shrink-0", on ? "text-accent" : "text-sidebar-foreground/60")} aria-hidden="true" />
                    <span className={cn("truncate", rail && "md:hidden")}>{it.label}</span>
                    {it.count ? (
                      <span
                        className={cn(
                          "ms-auto grid h-[19px] min-w-5 place-items-center rounded-full px-1.5 text-[10.5px] font-bold text-white tabular-nums",
                          it.tone === "red" ? "bg-destructive" : it.tone === "blue" ? "bg-cta" : "bg-white/10 text-sidebar-foreground",
                          rail && "md:absolute md:end-1.5 md:top-0.5 md:ms-0 md:h-[17px] md:min-w-[17px] md:border-2 md:border-primary md:px-1 md:text-[9.5px]",
                          rail && it.tone === "muted" && "md:hidden"
                        )}
                        dir="ltr"
                      >
                        {it.count}
                      </span>
                    ) : null}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className={cn("mx-3 mb-3 rounded-2xl bg-white/5 p-3 text-xs", rail && "md:hidden")}>
          <b className="flex items-center gap-1.5 text-white">
            <Sparkles size={14} className="text-accent" aria-hidden="true" />
            {t("upCardT")}
          </b>
          <p className="mt-1 leading-relaxed text-sidebar-foreground/60">{t("upCardX")}</p>
          <button type="button" onClick={() => setUpgrade(true)} className="mt-2 w-full rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            {t("upCardBtn")}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setUpgrade(true)}
          aria-label={t("upCardT")}
          title={t("upCardT")}
          className={cn("mx-auto mb-2 hidden h-10 w-11 place-items-center rounded-xl bg-accent/15 text-accent hover:bg-accent/25", rail && "md:grid")}
        >
          <Sparkles size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          title={rail ? t("logout") : undefined}
          className={cn("flex items-center gap-3 border-t border-white/10 px-5 py-3.5 text-[13.5px] text-sidebar-foreground/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", rail && "md:justify-center md:px-0")}
        >
          <LogOut size={17} aria-hidden="true" />
          <span className={cn(rail && "md:hidden")}>{t("logout")}</span>
        </button>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-4 sm:px-6">
            <button
              type="button"
              onClick={toggleRail}
              aria-label={t(rail ? "sideOpen" : "sideClose")}
              className="grid h-9 w-9 place-items-center rounded-lg border bg-card text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              <PanelRight size={17} aria-hidden="true" />
            </button>
            <form onSubmit={submit} role="search" className="relative max-w-md flex-1">
              <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoComplete="off"
                placeholder={t("searchPh")}
                aria-label={t("searchPh")}
                className="h-9 w-full rounded-lg border bg-card ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </form>
            <span className="flex-1" />
            <LanguageSwitcher />
            <Link href="/supplier/notifications" aria-label={t("navNotifs")} className="relative grid h-9 w-9 place-items-center rounded-lg border bg-card text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Bell size={17} aria-hidden="true" />
              {bell > 0 && (
                <span className="absolute -end-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white tabular-nums" dir="ltr">
                  {bell}
                </span>
              )}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-2 rounded-lg border bg-card py-1 pe-3 ps-1 text-start hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">{initial}</span>
                  <span className="hidden min-w-0 leading-tight sm:block">
                    <b className="block max-w-[140px] truncate text-xs" dir="auto">
                      {profile?.name || profile?.companyName}
                    </b>
                    <span className="block max-w-[140px] truncate text-[10px] text-muted-foreground" dir="auto">
                      {t("roleSupplier")}
                    </span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="truncate" dir="auto">
                  {profile?.companyName}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push("/supplier/profile")}>
                  <Building2 size={15} className="me-2" aria-hidden="true" />
                  {t("navAccount")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setUpgrade(true)}>
                  <Sparkles size={15} className="me-2" aria-hidden="true" />
                  {t("upgTitle")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void logout()}>
                  <LogOut size={15} className="me-2" aria-hidden="true" />
                  {t("logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">{children}</main>
      </div>
      {upgrade && <SubscriptionDialog onClose={() => setUpgrade(false)} />}
    </div>
  )
}
