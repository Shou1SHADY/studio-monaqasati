// The free supplier's home and frame numbers, from his world (Supplier 1.0 inside the unified portal, 15 Oct 2026):
// the portal home's three figures, its decisions, its tiles' counts, and the sidebar's counts. Every number is read
// from the world logic's one function for it — the same the pages read — so a figure is the same on the home, on its
// page and beside its sidebar item (G-04, NAV-03). Pure: no React, no I/O.

import type { HomeDecision, HomeKpi } from "@/components/portal-home/PortalHomeView"
import type { NavBadge, PortalComponentId } from "@/lib/portal-components"
import { profileFacts, profilePct } from "@/lib/supplier-free/profile"
import { TASK_DOMAIN, type Task, type TaskDomain, type WorldLogic } from "@/lib/supplier-free/world-logic"
import { taskView } from "./TaskCard"
import type { Free } from "./useFree"

/** The module a task's card belongs to: quotes are Sales'; delivery, money and contractors are Order Management's. */
export const DOMAIN_MODULE: Record<TaskDomain, PortalComponentId> = {
  offers: "procurement",
  supply: "project-management",
  money: "project-management",
  links: "project-management",
}

/** The list that owns a task's deal — its drawer opens over that list. */
export function taskPage(a: Task): string {
  switch (a.kind) {
    case "aInviteRfq":
      return "/supplier/rfqs"
    case "aReduce":
    case "aSample":
      return "/supplier/offers"
    case "aAcceptPO":
    case "aLate":
    case "aShipSoon":
      return "/supplier/orders"
    case "aInvoice":
    case "aPaySent":
      return "/supplier/invoices"
    default:
      return "/supplier/connections"
  }
}

/** Where a decision card leads: the deal's drawer over the page that owns it; an invitation opens the contractors. */
export function taskHref(a: Task): string {
  return a.deal ? `${taskPage(a)}?deal=${encodeURIComponent(a.deal)}` : "/supplier/connections?tab=inv"
}

type HomeFree = Pick<Free, "t" | "L" | "fmt" | "pl" | "rel" | "world" | "profile">

/** A new account: no deals, or a first few with nothing asked of him and nothing owed — "nothing yet", never zeros (TDY-07). */
export function isFresh(f: Pick<Free, "L" | "world">): boolean {
  const { L, world } = f
  const k = L.dashK()
  return world.deals.length === 0 || (world.deals.length <= 3 && !L.allActs().length && !k.accUnsent && !k.owed)
}

/** The profile's completion (ACC-04); 100 when there is no profile to judge. */
export const profileCompletion = (profile: Free["profile"]): number => (profile ? profilePct(profileFacts(profile.raw)) : 100)

export interface FreeHomeModel {
  fresh: boolean
  pct: number
  kpis: HomeKpi[]
  decisions: HomeDecision[]
  tileStats: Partial<Record<PortalComponentId, string>>
  badges: Map<PortalComponentId, number>
  urgentTiles: Set<PortalComponentId>
}

export function freeHomeModel(f: HomeFree): FreeHomeModel {
  const { t, L, fmt, world } = f
  const all = L.allActs()
  const k = L.dashK()
  const b = L.badges()
  const fresh = isFresh(f)
  const pct = profileCompletion(f.profile)
  // The riyal sign stands left of the figure in both scripts (SAMA); a left-to-right isolate makes that the visual order in an Arabic page too.
  const money = (v: number) => `⁦${fmt.cur} ${fmt.kM(v)}⁩`

  // The banner's three figures (TDY-01): awaiting your reply · yours to deliver (before VAT) · owed to you (with VAT).
  const kpis: HomeKpi[] = fresh
    ? []
    : [
        { key: "acts", value: all.length, label: t("hsActs"), dot: all.some((a) => !!a.due && L.daysTo(a.due) < 0) },
        { key: "unsent", value: money(k.accUnsent), label: t("hsUnsent") },
        { key: "owed", value: money(k.owed), label: t("dkOwed") },
      ]

  // "Needs your reply", in the one working order (G-12): each task a decision card.
  const decisions: HomeDecision[] = all.map((a, i) => {
    const v = taskView(f as Free, a, () => taskHref(a))
    const n = a.due ? L.daysTo(a.due) : null
    const chip: HomeDecision["chip"] =
      a.due == null || n == null ? null : n < 0 ? { label: f.pl("pl_late", -n), tone: "destructive" } : n <= 1 ? { label: f.rel(a.due), tone: "warning" } : null
    return {
      id: `${a.kind}:${a.deal || a.c || ""}:${i}`,
      moduleId: DOMAIN_MODULE[TASK_DOMAIN[a.kind]],
      title: v.title,
      chip,
      metrics: v.facts.map(([label, value]) => ({ label, value })),
      actionLabel: v.action.label,
      href: taskHref(a),
    }
  })

  // Tiles: red counts wait on the supplier (urgent); blue ones are information, said in the tile's line.
  const badges = new Map<PortalComponentId, number>()
  const urgentTiles = new Set<PortalComponentId>()
  const sales = b.offers.n
  const orders = b.orders.n + b.invoices.n
  if (sales > 0) {
    badges.set("procurement", sales)
    urgentTiles.add("procurement")
  }
  if (orders > 0) {
    badges.set("project-management", orders)
    urgentTiles.add("project-management")
  }
  const tileStats: Partial<Record<PortalComponentId, string>> = fresh
    ? {}
    : {
        procurement: t("tileSales", { open: k.opps, fresh: k.oppsNew }),
        "project-management": t("tileOrders", { orders: k.supply, invites: world.invites.length }),
      }
  if (pct < 100) tileStats.users = t("tileAccount", { pct })

  return { fresh, pct, kpis, decisions, tileStats, badges, urgentTiles }
}

/** The sidebar's counts by item address (NAV-03): `badges()` for the pages, the profile's completion for the account. */
export function freeNavBadges(b: ReturnType<WorldLogic["badges"]>, pct: number): Record<string, NavBadge> {
  return {
    "/supplier": b.home,
    "/supplier/rfqs": b.opps,
    "/supplier/offers": b.offers,
    "/supplier/orders": b.orders,
    "/supplier/invoices": b.invoices,
    "/supplier/connections": b.connections,
    "/supplier/chats": b.messages,
    ...(pct < 100 ? { "/supplier/profile": { n: `${pct}%`, tone: "muted" as const } } : {}),
  }
}
