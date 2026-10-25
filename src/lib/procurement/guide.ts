// «كيف تعمل المشتريات؟» (FLW-01..03): the eight stations and the places a request is born, for a package (prototype v5
// `flowStations` / `flowSources`). Pure: it names message keys and addresses, never writes — the page previews a package
// by passing a different one here, so previewing creates nothing (B-10, R-30).

import type { PackageFlags } from "./package"
import type { ProcTabId } from "./tab-gates"

export const GUIDE_HREF = "/contractor/rfqs/guide"
export const MY_REQUESTS_HREF = "/contractor/rfqs/my-requests"
/** «ارفع طلباً نيابةً عنه» opens the «طلب مواد» dialog on «طلباتي» directly (the page reads `?raise=1`). */
export const RAISE_HREF = `${MY_REQUESTS_HREF}?raise=1`
export const INCOMING_HREF = "/contractor/rfqs/requests"

/** Where the guide was opened from (`?from=`): «عُد إلى المشتريات» returns there, else to the viewer's first tab. */
export type GuideFrom = "incoming" | "mine"
export const guideHref = (from?: GuideFrom): string => (from ? `${GUIDE_HREF}?from=${from}` : GUIDE_HREF)
export function guideBackHref(from: string | null | undefined, firstTabHref: string | undefined, holdsIncoming: boolean): string {
  if (from === "mine") return MY_REQUESTS_HREF
  if (from === "incoming" && holdsIncoming) return INCOMING_HREF
  return firstTabHref ?? MY_REQUESTS_HREF
}

export const ROLE_IDS = ["req", "pm", "buy", "app", "sup", "rcv", "inv", "fin", "mfg"] as const
export type RoleId = (typeof ROLE_IDS)[number]

export const STATION_IDS = ["request", "incoming", "publish", "offers", "award", "supply", "receive", "close"] as const
export type StationId = (typeof STATION_IDS)[number]

export type SeesKey = "with_proc" | "in_rfq" | "in_po" | "in_po_arriving" | "arrived" | "complete"

/** A plain link to a real page. `tab` names the rail tab that gates it: a viewer who does not hold the tab is not shown the link. */
export interface GuideLinkDef {
  href: string
  labelKey: string
  tab?: ProcTabId
}

export interface GuideStation {
  n: number
  id: StationId
  who: RoleId[]
  whatKey: string
  more: string[]
  sees: SeesKey
  /** Whose work the "sees" line speaks of: the requester, or — with Projects — the project manager. */
  seesBy: "requester" | "pm"
  links: GuideLinkDef[]
  /** Without Projects in the preview but with it in the subscription: the station says the preview creates nothing. */
  previewOnly: boolean
}

export type SourceId = "team" | "pm" | "buy" | "inv" | "mfg"

export interface GuideSource {
  id: SourceId
  role: RoleId
  link: GuideLinkDef | null
}

/** The roles the page's legend shows for a package: no requester with Projects, no project manager without, finance and workshop only when in it. */
export const legendRoles = (pkg: PackageFlags): RoleId[] => ROLE_IDS.filter((r) => (r !== "pm" || pkg.pm) && (r !== "req" || !pkg.pm) && (r !== "fin" || pkg.fin) && (r !== "mfg" || pkg.mfg))

const link = (href: string, labelKey: string, tab?: ProcTabId): GuideLinkDef => ({ href, labelKey, ...(tab ? { tab } : {}) })

/** `pkg` is the package being read (the preview); `actual` is the company's own — only the first station's buttons depend on it. */
export function flowStations(pkg: PackageFlags, actual: PackageFlags = pkg): GuideStation[] {
  const st = (n: number, id: StationId, who: RoleId[], whatKey: string, sees: SeesKey, links: GuideLinkDef[], more: string[] = [], previewOnly = false): GuideStation => ({
    n,
    id,
    who,
    whatKey,
    more,
    sees,
    seesBy: pkg.pm && n < 8 ? "pm" : "requester",
    links,
    previewOnly,
  })
  return [
    st(1, "request", pkg.pm ? ["pm"] : ["req"], pkg.pm ? "station.request.what_pm" : "station.request.what_team", "with_proc", pkg.pm || actual.pm ? [] : [link(MY_REQUESTS_HREF, "btn.open_mine_as"), link(RAISE_HREF, "btn.on_behalf_him")], [...(pkg.pm ? [] : ["approval"]), "need_line", ...(pkg.mfg ? ["mfg_sends"] : [])], !pkg.pm && actual.pm),
    st(2, "incoming", ["buy", "inv"], "station.incoming.what", "with_proc", [link("/contractor/rfqs/requests", "btn.incoming", "requests")], ["inv_asked", ...(pkg.mfg ? ["mfg_asked"] : [])]),
    st(3, "publish", ["buy"], "station.publish.what", "in_rfq", [link("/contractor/rfqs/new", "btn.new_rfq", "rfqs")]),
    st(4, "offers", ["sup"], "station.offers.what", "in_rfq", [link("/contractor/rfqs", "btn.open_rfqs", "rfqs")]),
    st(5, "award", ["buy", "app"], "station.award.what", "in_po", [link("/contractor/rfqs", "btn.compare", "rfqs")], [...(pkg.fin ? ["fin"] : []), "bnpl"]),
    st(6, "supply", ["sup"], "station.supply.what", "in_po_arriving", [link("/contractor/chats", "btn.chats")]),
    st(7, "receive", ["rcv"], "station.receive.what", "arrived", [link("/contractor/goods-received", "btn.receipts", "receipts")], ["stock"]),
    st(8, "close", pkg.fin ? ["fin"] : ["buy"], pkg.fin ? "station.close.what_fin" : "station.close.what_nofin", "complete", [link("/contractor/rfqs/orders", "btn.orders", "orders")]),
  ]
}

export function flowSources(pkg: PackageFlags, actual: PackageFlags = pkg): GuideSource[] {
  const out: GuideSource[] = []
  if (!pkg.pm) out.push({ id: "team", role: "req", link: link(MY_REQUESTS_HREF, "btn.open_mine") })
  else out.push({ id: "pm", role: "pm", link: null })
  if (!pkg.pm) out.push({ id: "buy", role: "buy", link: actual.pm ? null : link(RAISE_HREF, "btn.on_behalf") })
  out.push({ id: "inv", role: "inv", link: link("/contractor/rfqs/requests", "btn.incoming", "requests") })
  if (pkg.mfg) out.push({ id: "mfg", role: "mfg", link: null })
  return out
}
