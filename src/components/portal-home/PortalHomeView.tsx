"use client"

// The portal home — ONE screen for both portals (a supplier subscribing lands on
// the same page a contractor does): a greeting with three live numbers, a tile
// per module (locked ones offer "request access"), what was touched last, and
// the decisions waiting today. Each portal feeds it its own numbers
// (ContractorHome / SupplierHome); the layout, the access requests and the
// locked-tile toggle live here once, so a change to the home is made once.

import { useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { addDoc, collection, query, where } from "firebase/firestore"
import { Check, ChevronLeft, ChevronRight, Crown, History, KeyRound, Loader2, Lock, Sparkles, UsersRound } from "lucide-react"
import { usePortalFrame } from "@/components/layout/portal-frame-context"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { Link } from "@/i18n/routing"
import { COMPONENT_ACCENT_CLASSES, isComponentVisible, type AccentToken, type PortalComponentDef, type PortalComponentId } from "@/lib/portal-components"
import { cn } from "@/lib/utils"

// Solid accent classes for the tile hover-bar and the decision-card rail — the
// shared COMPONENT_ACCENT_CLASSES only carries the soft 10% variants.
const ACCENT_SOLID: Record<AccentToken, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  accent: "bg-accent",
  success: "bg-success",
  cta: "bg-cta",
  warning: "bg-warning",
  destructive: "bg-destructive",
  indigo: "bg-indigo",
  violet: "bg-violet",
  pm: "bg-pm",
  teal: "bg-teal",
}

export interface HomeKpi {
  key: string
  value: number | string
  label: string
  dot?: boolean
}

export interface HomeRecent {
  id: string
  name: string
  href: string
  ms: number
}

export interface HomeDecision {
  id: string
  /** The module the card belongs to — its chip and colour rail. */
  moduleId: PortalComponentId
  title: string
  chip?: { label: string; tone: "destructive" | "warning" } | null
  metrics?: Array<{ label: string; value: string | number }>
  actionLabel: string
  href: string
}

export interface PortalHomeViewProps {
  /** The signed-in member's resolved profile; the skeleton shows until it is there. */
  profile: Record<string, unknown> | null
  orgId: string | null | undefined
  companyName: string | null | undefined
  /** The portal's modules after the company's switches (useModuleComponents). */
  modules: PortalComponentDef[]
  kpis: HomeKpi[]
  tileStats: Partial<Record<PortalComponentId, string>>
  badges: ReadonlyMap<PortalComponentId, number>
  urgentTiles: ReadonlySet<PortalComponentId>
  recent: HomeRecent[]
  decisions: { loading: boolean; items: HomeDecision[] }
  /** A short note under the greeting (a new free account: nothing yet, and how to complete the profile — TDY-07). */
  banner?: ReactNode
  /** Opt-in: "+N more" becomes a button that lists every decision here ("All tasks (N)" — Supplier TDY-04). */
  allDecisions?: { all: string; fewer: string }
  /** A section of the portal's own under the decisions (the free supplier's open requests — TDY-05). */
  after?: ReactNode
}

type HomeT = ReturnType<typeof useTranslations<"Portal.Home">>

function relativeTimeLabel(ms: number, t: HomeT): string {
  const minutes = Math.floor((Date.now() - ms) / 60000)
  if (minutes < 1) return t("time_ago_now")
  if (minutes < 60) return t("time_ago_minutes", { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t("time_ago_hours", { count: hours })
  return t("time_ago_days", { count: Math.floor(hours / 24) })
}

/** A figure long enough (an amount with its unit) to need wrapping in a phone-width hero cell. */
const longFigure = (v: unknown) => typeof v === "string" && v.length > 8

export function PortalHomeView({ profile, orgId, companyName, modules, kpis, tileStats, badges, urgentTiles, recent, decisions, banner, allDecisions, after }: PortalHomeViewProps) {
  const openSubscription = usePortalFrame()?.openSubscription
  const firestore = useFirestore()
  const { user } = useUser()
  const t = useTranslations("Portal.Home")
  const tSidebar = useTranslations("Portal.Sidebar")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const { toast } = useToast()
  const { can, isOrgOwner, groups } = usePermissions()
  const [showLocked, setShowLocked] = useState(true)
  const [justRequested, setJustRequested] = useState<Set<string>>(new Set())
  const [requestingModule, setRequestingModule] = useState<string | null>(null)

  const name = typeof profile?.name === "string" ? profile.name : ""
  const firstName = name.trim().split(/\s+/)[0] || ""
  const greeting = new Date().getHours() < 12 ? t("greet_morning") : t("greet_evening")
  const todayLabel = new Date().toLocaleDateString(isRtl ? "ar-SA" : "en-US", { weekday: "long", day: "numeric", month: "long" })
  const myGroup = groups.find((g) => g.id === profile?.defaultGroupId)
  const roleChip = isOrgOwner ? t("role_owner_chip") : myGroup?.name || null
  const ChevronIcon = isRtl ? ChevronLeft : ChevronRight

  const sortedComponents = modules.filter((c) => c.launcher !== false).sort((a, b) => a.displayOrder - b.displayOrder)
  // Permission-aware tiles: a module the member can't open anything inside is
  // shown locked (or hidden via the toggle) — same gate as sidebar/launcher.
  const accessibleById = new Map(sortedComponents.map((c) => [c.id, isComponentVisible(c, can)]))
  const accessibleCount = sortedComponents.filter((c) => accessibleById.get(c.id)).length
  const lockedCount = sortedComponents.length - accessibleCount
  // A member's own modules come FIRST, in their usual order; what is locked
  // follows — a one-module member no longer scrolls past locked tiles to reach
  // the one they work in. The owner opens everything, so his order does not change.
  const openFirst = [...sortedComponents.filter((c) => accessibleById.get(c.id)), ...sortedComponents.filter((c) => !accessibleById.get(c.id))]
  const gridComponents = showLocked ? openFirst : openFirst.filter((c) => accessibleById.get(c.id))

  // Access requests this member already sent — locked tiles show "request sent"
  // instead of the button, and the create is skipped while one is pending.
  const myAccessRequestsQuery = useMemoFirebase(() => {
    if (!firestore || !user || isOrgOwner || !orgId) return null
    return query(collection(firestore, "accessRequests"), where("requesterId", "==", user.uid), where("organizationId", "==", orgId))
  }, [firestore, user, isOrgOwner, orgId])
  const { data: myAccessRequests } = useCollection(myAccessRequestsQuery)
  const pendingRequestModules = new Set(
    ((myAccessRequests || []) as { moduleId?: string; status?: string }[]).filter((r) => r.status === "pending").map((r) => r.moduleId)
  )

  const handleRequestAccess = async (componentId: PortalComponentId, moduleLabel: string) => {
    if (!firestore || !user || !orgId || requestingModule) return
    setRequestingModule(componentId)
    try {
      const requesterName = name || (typeof profile?.companyName === "string" ? profile.companyName : "") || user.email || ""
      await addDoc(collection(firestore, "accessRequests"), {
        organizationId: orgId,
        requesterId: user.uid,
        requesterName,
        moduleId: componentId,
        status: "pending",
        createdAt: new Date().toISOString(),
      })
      await addDoc(collection(firestore, "users", orgId, "notifications"), {
        title: t("access_request_notif_title"),
        message: t("access_request_notif_msg", { name: requesterName, module: moduleLabel }),
        type: "access_request",
        createdAt: new Date().toISOString(),
        read: false,
      })
      setJustRequested((prev) => new Set(prev).add(componentId))
      toast({ title: t("access_request_sent_toast") })
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    } finally {
      setRequestingModule(null)
    }
  }

  if (!profile) {
    return (
      <div className="space-y-8 pb-10">
        <Skeleton className="h-40 rounded-3xl w-full" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
        <Skeleton className="h-48 rounded-2xl w-full" />
      </div>
    )
  }

  const [showAllDecisions, setShowAllDecisions] = useState(false)
  const top3 = decisions.items.slice(0, 3)
  const shownDecisions = allDecisions && showAllDecisions ? decisions.items : top3

  return (
    <div className="space-y-6 pb-10">
      {/* Hero — rounded card, greeting block at the start, KPIs at the end,
          over a navy→blue gradient with a brick-outline wall and a teal glow. */}
      <div
        className="relative overflow-hidden rounded-[20px] text-white px-6 py-5 sm:px-7 flex items-center gap-5 flex-wrap shadow-[0_14px_34px_rgba(11,26,43,.2)]"
        style={{ background: "linear-gradient(115deg, #0a1a2a 0%, #123152 55%, #0d4d75 100%)" }}
      >
        <svg className="absolute inset-0 h-full w-full opacity-50 pointer-events-none" aria-hidden="true">
          <defs>
            <pattern id="hero-bricks" width="64" height="36" patternUnits="userSpaceOnUse">
              <path d="M6 2h52l-6 14H0z" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
              <path d="M38 20h52l-6 14H32z" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
              <path d="M-26 20h52l-6 14h-52z" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hero-bricks)" />
        </svg>
        <span
          className="absolute -top-[230px] -start-[110px] h-[440px] w-[440px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(44,182,236,.3), rgba(44,182,236,0) 65%)" }}
        />

        <div className="relative min-w-0">
          <h1 suppressHydrationWarning className="flex items-center gap-3 flex-wrap text-xl sm:text-2xl font-bold leading-[1.4] text-white">
            <span>
              {greeting}
              {isRtl ? "،" : ","} <em className="not-italic text-cyan-300">{firstName || companyName || t("welcome_fallback")}</em>
            </span>
            {roleChip && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-[11.5px] font-bold text-slate-200 whitespace-nowrap">
                {isOrgOwner ? <Crown className="h-3 w-3" /> : <UsersRound className="h-3 w-3" />}
                {roleChip}
              </span>
            )}
          </h1>
          <p suppressHydrationWarning className="mt-0.5 flex items-center gap-2.5 flex-wrap text-[12.5px] text-slate-300/80 font-medium">
            {companyName && (
              <>
                <span>{companyName}</span>
                <i className="h-[3px] w-[3px] rounded-full bg-slate-500" />
              </>
            )}
            <span>{todayLabel}</span>
            <i className="h-[3px] w-[3px] rounded-full bg-slate-500" />
            <span>
              {sortedComponents.some((c) => c.planLocked)
                ? t("home_plan_free")
                : isOrgOwner || lockedCount === 0
                  ? t("home_perms_all")
                  : t("home_perms_partial", { n: accessibleCount, total: sortedComponents.length })}
            </span>
          </p>
        </div>

        {/* Live KPIs — end side on desktop, full-width divider row on mobile. None for an account with nothing yet. */}
        {kpis.length > 0 && (
        <div className="relative flex items-stretch ms-auto max-sm:basis-full max-sm:w-full max-sm:ms-0 max-sm:border-t max-sm:border-white/10 max-sm:pt-3">
          {kpis.map((kpi, i) => (
            <div key={kpi.key} className={cn("px-5 sm:px-6 text-start max-sm:min-w-0 max-sm:flex-1", longFigure(kpi.value) ? "max-sm:px-2" : "max-sm:px-3", i > 0 && "border-s border-white/[.13]")}>
              <b className={cn("block text-[21px] font-bold leading-[1.25] tabular-nums whitespace-nowrap", longFigure(kpi.value) ? "max-sm:whitespace-normal max-sm:text-[15px] max-sm:leading-tight" : "max-sm:text-[17px]")}>{kpi.value}</b>
              <span className="flex items-center gap-1.5 text-xs text-slate-300/80 whitespace-nowrap max-sm:whitespace-normal">
                {kpi.dot && <span className="h-1.5 w-1.5 rounded-full bg-red-300" />}
                {kpi.label}
              </span>
            </div>
          ))}
        </div>
        )}
      </div>

      {banner}

      {/* Component tile grid — one tile per portal component, with a real stats
          line and a "needs action" footer. Modules outside this member's
          permissions render locked (same gate as sidebar/launcher). */}
      <div className="flex items-center justify-between gap-3 flex-wrap -mb-3">
        <h2 className="text-sm font-black text-foreground">{t("tiles_section_title")}</h2>
        {lockedCount > 0 && (
          <label className="flex items-center gap-2 text-[11.5px] font-medium text-muted-foreground cursor-pointer select-none">
            <span className="text-muted-foreground/60">{t("tiles_locked_count", { count: lockedCount })}</span>
            <Checkbox checked={showLocked} onCheckedChange={(v) => setShowLocked(v === true)} aria-label={t("tiles_show_locked")} className="h-3.5 w-3.5" />
            {t("tiles_show_locked")}
          </label>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
        {gridComponents.map((component) => {
          const accent = COMPONENT_ACCENT_CLASSES[component.accentToken]
          const count = badges.get(component.id) || 0
          const statsLine = tileStats[component.id]

          if (!accessibleById.get(component.id)) {
            return (
              <div key={component.id} className="flex flex-col gap-2 p-[18px] rounded-[18px] bg-white border border-dashed border-border min-h-[174px] text-start">
                <span className="relative h-[46px] w-[46px] rounded-[14px] grid place-items-center mb-0.5 bg-muted text-muted-foreground/60">
                  <component.icon size={23} strokeWidth={1.65} />
                  <span className="absolute -bottom-1 -end-1 h-[18px] w-[18px] rounded-full bg-white border border-border grid place-items-center text-muted-foreground">
                    <Lock size={10} />
                  </span>
                </span>
                <span className="text-[15px] font-bold text-muted-foreground leading-[1.4]">{tSidebar(component.labelKey)}</span>
                <span className="text-xs text-muted-foreground/50">—</span>
                <div className="mt-auto pt-2.5 border-t border-border/40 flex items-center min-h-[34px]">
                  {component.planLocked ? (
                    // Part of the subscription, not a permission: say what it adds (SUB-02) — never "request access".
                    openSubscription ? (
                      <button
                        type="button"
                        onClick={openSubscription}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-cta/30 text-cta text-xs font-semibold hover:bg-cta/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Sparkles size={13} aria-hidden="true" />
                        {t("tile_in_subscription")}
                      </button>
                    ) : (
                      <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/60">
                        <Lock size={13} />
                        {t("tile_in_subscription")}
                      </span>
                    )
                  ) : isOrgOwner ? (
                    <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/60">
                      <Lock size={13} />
                      {t("tile_no_permission")}
                    </span>
                  ) : pendingRequestModules.has(component.id) || justRequested.has(component.id) ? (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-success">
                      <Check size={13} />
                      {t("tile_request_sent")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRequestAccess(component.id, tSidebar(component.labelKey))}
                      disabled={requestingModule === component.id}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-cta/30 text-cta text-xs font-semibold hover:bg-cta/5 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {requestingModule === component.id ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                      {t("tile_request_access")}
                    </button>
                  )}
                </div>
              </div>
            )
          }

          return (
            <Link
              key={component.id}
              href={component.homeHref}
              className="group relative overflow-hidden flex flex-col gap-2 p-[18px] rounded-[18px] bg-white border border-border/60 shadow-sm hover:shadow-lg hover:-translate-y-[3px] min-h-[174px] text-start transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className={cn("absolute top-0 start-0 h-[3px] w-0 group-hover:w-full transition-[width] duration-300", ACCENT_SOLID[component.accentToken])} />
              <span className={cn("h-[46px] w-[46px] rounded-[14px] grid place-items-center mb-0.5 transition-transform group-hover:scale-105", accent.tile)}>
                <component.icon size={23} strokeWidth={1.65} />
              </span>
              <span className="text-[15px] font-bold text-foreground leading-[1.4]">{tSidebar(component.labelKey)}</span>
              {statsLine && (
                <span className="text-xs text-muted-foreground leading-relaxed" suppressHydrationWarning>
                  {statsLine}
                </span>
              )}
              <div className="mt-auto pt-2.5 border-t border-border/40 flex items-center gap-2 text-xs font-semibold whitespace-nowrap">
                {component.id === "documents" ? (
                  <span className="text-muted-foreground/70">{t("tile_documents_footer")}</span>
                ) : count > 0 ? (
                  <span className={cn("flex items-center gap-2", urgentTiles.has(component.id) ? "text-destructive" : "text-cta")}>
                    <span className="h-[7px] w-[7px] rounded-full bg-current shrink-0" />
                    <b className="font-bold">{count}</b> {t("tile_needs_action_word")}
                  </span>
                ) : (
                  <span className="text-muted-foreground/70">{t("tile_all_clear")}</span>
                )}
              </div>
            </Link>
          )
        })}

        {/* Continue where you left off — the records touched most recently. */}
        {recent.length > 0 && (
          <div className="flex flex-col rounded-[18px] bg-muted/30 border border-border/60 p-[18px] gap-3 min-h-[174px] text-start">
            <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <History size={13} />
              {t("home_continue_title")}
            </span>
            <div className="flex flex-col gap-0.5 -mx-2">
              {recent.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="h-[7px] w-[7px] rounded-full bg-accent shrink-0" />
                  <span className="text-xs font-semibold text-foreground truncate flex-1 min-w-0" dir="auto">
                    {item.name}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground whitespace-nowrap" suppressHydrationWarning>
                    {relativeTimeLabel(item.ms, t)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Needs your decision today — the three most urgent items this member
          can act on, as action cards with one primary action each. */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-foreground">{t("home_priorities_title")}</h2>
          {decisions.items.length > 3 &&
            (allDecisions ? (
              <button
                type="button"
                aria-expanded={showAllDecisions}
                onClick={() => setShowAllDecisions((v) => !v)}
                className="rounded text-[12.5px] font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showAllDecisions ? allDecisions.fewer : allDecisions.all}
              </button>
            ) : (
              <span className="text-[12.5px] font-semibold text-cta">{t("home_priorities_more", { count: decisions.items.length - 3 })}</span>
            ))}
        </div>
        {decisions.loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          </div>
        ) : top3.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-white shadow-sm p-8 text-center text-sm text-muted-foreground">{t("home_priorities_empty")}</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {shownDecisions.map((item) => {
              const moduleComponent = modules.find((c) => c.id === item.moduleId)
              const moduleAccent = moduleComponent ? COMPONENT_ACCENT_CLASSES[moduleComponent.accentToken] : null
              const ModuleIcon = moduleComponent?.icon
              return (
                <div key={item.id} className="relative overflow-hidden flex flex-col gap-3 rounded-[18px] border border-border/60 bg-white shadow-sm p-[18px] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
                  {/* Accent rail in the module's colour. */}
                  <span className={cn("absolute start-0 top-0 bottom-0 w-[3px]", moduleComponent ? ACCENT_SOLID[moduleComponent.accentToken] : "bg-accent")} />
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold", moduleAccent?.tile || "bg-muted text-muted-foreground")}>
                      {ModuleIcon && <ModuleIcon size={13} strokeWidth={1.9} />}
                      {moduleComponent ? tSidebar(moduleComponent.labelKey) : ""}
                    </span>
                    {item.chip && (
                      <span
                        className={cn(
                          "ms-auto inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap",
                          item.chip.tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
                        )}
                        suppressHydrationWarning
                      >
                        {item.chip.label}
                      </span>
                    )}
                  </div>
                  <h3 className="text-[13.5px] font-semibold leading-[1.65] text-foreground line-clamp-2 min-h-[45px]" dir="auto">
                    {item.title}
                  </h3>
                  {item.metrics && item.metrics.length > 0 && (
                    <div className="flex items-stretch gap-4 flex-wrap rounded-xl bg-muted/30 border border-border/50 px-3 py-2.5">
                      {item.metrics.map((m) => (
                        <div key={m.label} className="leading-[1.3]">
                          <span className="block text-[10.5px] text-muted-foreground">{m.label}</span>
                          <b className="text-[13px] font-bold text-foreground tabular-nums" suppressHydrationWarning>
                            {m.value}
                          </b>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-auto flex items-center gap-2">
                    <Link
                      href={item.href}
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[10px] bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {item.actionLabel}
                      <ChevronIcon size={14} />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {after}
    </div>
  )
}
