"use client"

// Messages, notifications and the global search (PRD MSG-01…04, NAV-04). A conversation lives inside its deal; a notification
// starts with the contractor's name and opens the deal it is about; the search matches a request or order number, a
// contractor or a material and says where each result lives.

import { useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import { Bell, Building2, Check, Link2, Loader2, MessageSquare, Search } from "lucide-react"
import { Link, useRouter } from "@/i18n/routing"
import { notificationCopy } from "@/lib/mfg-events"
import type { Translator } from "@/lib/mfg-events"
import { cn } from "@/lib/utils"
import { dayGroup, leadWithName, riyadhDayOf } from "@/lib/supplier-free/format"
import type { Deal } from "@/lib/supplier-free/types"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { FreePage, Pill, docWord, stk } from "./ui"
import { DealPill } from "./Pills"
import { useFree, type Free } from "./useFree"
import { stripEmoji, useFreeNotifications, type FreeNotification } from "./useFreeNotifications"

/** Where a deal lives in the sidebar: used by the search and the notifications. */
export function whereOf(f: Free, d: Deal): { href: string; label: string } {
  const { L } = f
  const st = L.stage(d)
  const k = d.closed ? d.closed.k : ""
  if (st === "new" || k === "noquote") return { href: "/supplier/rfqs", label: f.t("navOpps") }
  if (st === "offered" || ["lost", "noaward", "withdrawn"].includes(k)) return { href: "/supplier/offers", label: f.t("navOffers") }
  if (st === "deliver" || k === "declined" || L.poSt(d) === "wait") return { href: "/supplier/orders", label: f.t("navOrders") }
  if (L.invSt(d)) return { href: "/supplier/invoices", label: f.t("navInvoices") }
  return { href: "/supplier/orders", label: f.t("navOrders") }
}

/** The conversations, newest message first (MSG-02): ordered on the full moment of the last message, not its day. */
export function messageThreads(deals: readonly Deal[]): Deal[] {
  return deals
    .filter((d) => d.chat && (d.chat.last || d.chat.unread))
    .sort((a, b) => (b.chat?.lastTs || 0) - (a.chat?.lastTs || 0) || (b.chat?.lastAt || "").localeCompare(a.chat?.lastAt || ""))
}

export function FreeMessages() {
  const f = useFree()
  const { t, world, L, fmt } = f
  const threads = useMemo(() => messageThreads(world.deals), [world.deals])
  return (
    <FreePage icon={MessageSquare} title={t("navMessages")} description={t("mSub")}>
      {threads.length ? (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {threads.map((d) => {
            const c = L.C(d.c)
            const last = d.chat?.last || ""
            return (
              <li key={d.id}>
                <Link href={`/supplier/chats?deal=${d.id}&m=1` as never} scroll={false} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cta/10 text-cta"><Building2 size={17} aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-sm"><bdi>{c?.name}</bdi></b>
                    <span className="block truncate text-xs text-muted-foreground"><bdi>{d.title}</bdi> — <bdi>{d.chat?.mine ? t("mYou", { x: last }) : last}</bdi></span>
                  </div>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">{d.chat?.lastAt ? fmt.date(d.chat.lastAt) : ""}</span>
                  {(d.chat?.unread || 0) > 0 && <Pill tone="bad">{d.chat?.unread}</Pill>}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState icon={MessageSquare} title={t("mEmpty")} description={t("mEmptyX")} />
      )}
    </FreePage>
  )
}

const KIND_ICON: Record<string, typeof Bell> = { supplier_invite_received: Link2, supplier_connected: Link2, sup_request_accepted: Link2, sup_request_declined: Link2 }

/** Where a notice about a connection with a contractor opens when no deal is behind it: an invitation opens the
 * invitations, an answer to his own request his requests, a made connection the contractors he works with. */
export function connectionHref(type: string): string | null {
  if (type === "supplier_invite_received" || type.startsWith("sup_connection_")) return "/supplier/connections?tab=inv"
  if (type === "sup_request_declined") return "/supplier/connections?tab=req"
  if (type === "supplier_connected" || type === "sup_request_accepted") return "/supplier/connections"
  return null
}

const rowCls = "flex items-center gap-3 border-t px-4 py-3 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"

export function FreeNotifications() {
  const f = useFree()
  const { t, world, fmt, today, L } = f
  const shared = useTranslations("Portal.Shared")
  const { list, unread, markRead, markAll } = useFreeNotifications()
  const dealOf = (n: FreeNotification): Deal | null => {
    if (n.poId) {
      const po = f.pos.find((p) => p.id === n.poId)
      if (po?.rfqId) return world.deals.find((d) => d.id === po.rfqId) || null
    }
    if (n.offerId) {
      const o = world.deals.find((d) => d.chat?.chatId === n.offerId)
      if (o) return o
    }
    if (n.chatId) {
      const o = world.deals.find((d) => d.chat?.chatId === n.chatId)
      if (o) return o
    }
    return n.rfqId ? world.deals.find((d) => d.id === n.rfqId) || null : null
  }
  const text = (n: FreeNotification, d: Deal | null) => {
    const c = n.i18n ? notificationCopy({ title: n.title, message: n.message, i18n: n.i18n as never }, shared as unknown as Translator, f.locale) : { title: n.title, message: n.message }
    const who = (d && L.C(d.c)?.name) || String(n.i18n?.params?.contractor || "")
    return { title: leadWithName(stripEmoji(c.title || n.title), who), message: stripEmoji(c.message || n.message) }
  }
  const total = unread.length + world.invites.length
  let last = ""
  return (
    <FreePage
      icon={Bell}
      title={t("navNotifs")}
      description={t("nSub", { n: f.fmt.n(total) })}
      action={
        unread.length > 0 ? (
          <button type="button" onClick={() => void markAll()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-bold hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Check size={15} aria-hidden="true" />
            {t("markAll")}
          </button>
        ) : undefined
      }
    >
      {world.invites.length > 0 && (
        <Link href="/supplier/connections?tab=inv" className="flex items-center gap-3 rounded-xl border border-cta/30 bg-cta/5 px-4 py-3 text-sm hover:bg-cta/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cta/15 text-cta"><Link2 size={17} aria-hidden="true" /></span>
          <b>{t("nInvite", { c: L.C(world.invites[0].c)?.name || "" })}</b>
          {world.invites.length > 1 && <Pill tone="info">+{world.invites.length - 1}</Pill>}
        </Link>
      )}
      {list.length ? (
        <ul className="overflow-hidden rounded-xl border bg-card">
          {list.map((n) => {
            const d = dealOf(n)
            const when = riyadhDayOf(n.createdAt)
            const g = dayGroup(when, today)
            const group = g === "today" ? t("today") : g === "yesterday" ? t("yesterday") : g ? fmt.date(when, true) : ""
            const head = group !== last ? group : ""
            last = group
            const c = text(n, d)
            const Icon = KIND_ICON[n.type] || Bell
            const conn = d ? null : connectionHref(n.type)
            const inner = (
              <>
                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", n.read ? "bg-muted text-muted-foreground" : "bg-cta/10 text-cta")}><Icon size={17} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <b className="block text-sm" dir="auto">{c.title}</b>
                  {c.message && <span className="block text-xs text-muted-foreground" dir="auto">{c.message}</span>}
                </span>
                {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-label={t("unreadDot")} />}
              </>
            )
            return (
              <li key={n.id}>
                {head && <div className="bg-muted/40 px-4 py-1.5 text-xs font-bold text-muted-foreground">{head}</div>}
                {d || conn ? (
                  <Link href={(d ? `/supplier/notifications?deal=${d.id}` : conn) as never} scroll={false} onClick={() => void markRead(n.id)} className={rowCls}>
                    {inner}
                  </Link>
                ) : (
                  <button type="button" onClick={() => void markRead(n.id)} className={cn(rowCls, "w-full text-start")}>
                    {inner}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState icon={Bell} title={t("nEmpty")} />
      )}
    </FreePage>
  )
}

export function FreeSearch({ q }: { q: string }) {
  const f = useFree()
  const { t, L, world } = f
  const needle = q.trim()
  const list = useMemo(() => (needle ? world.deals.filter((d) => L.matchQ(d, needle)) : []), [needle, world.deals, L])
  return (
    <FreePage icon={Search} title={t("searchT")} description={needle ? t("searchSub", { q: needle, n: f.pl("pl_deal", list.length) }) : t("searchEmpty")}>
      {list.length ? (
        <div className={stk.wrap}>
          <table className={stk.table}>
            <thead className={stk.thead}>
              <tr>
                <th className="px-3 py-2 text-start">{t("thRequest")}</th>
                <th className="px-3 text-start">{t("thContractor")}</th>
                <th className="px-3 text-start">{t("thWhere")}</th>
                <th className="px-3 text-start">{t("thState")}</th>
              </tr>
            </thead>
            <tbody className={stk.tbody}>
              {list.map((d) => {
                const w = whereOf(f, d)
                return (
                  <tr key={d.id} className={cn("border-b last:border-b-0 hover:bg-muted/30", stk.tr)}>
                    <td className={cn("px-3 py-2.5", stk.head)}>
                      <Link href={`/supplier/search?q=${encodeURIComponent(needle)}&deal=${d.id}` as never} scroll={false} className="block text-sm font-bold hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">{d.title}</Link>
                      <span className="text-xs text-muted-foreground">{docWord(f, "rfq", d.rfq)}{d.po ? ` · ${docWord(f, "po", d.po.no)}` : ""}</span>
                    </td>
                    <td className={cn("px-3 text-sm", stk.cell)} data-l={t("thContractor")}><bdi>{L.C(d.c)?.name}</bdi></td>
                    <td className={cn("px-3 text-sm", stk.cell)} data-l={t("thWhere")}><Link href={w.href as never} className="text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{w.label}</Link></td>
                    <td className={cn("px-3", stk.cell)} data-l={t("thState")}><DealPill f={f} d={d} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Search} title={needle ? t("listEmptyF") : t("searchEmpty")} />
      )}
    </FreePage>
  )
}

/** Where an old conversation link (`/supplier/chat/<offer>`, from a push or an e-mail) lands for a free account: its
 * deal, opened on the conversation — the free journey has no separate chat page (MSG-01). */
export function freeChatTarget(deals: readonly Deal[], chatId: string): string {
  const d = deals.find((x) => x.chat?.chatId === chatId || x.id === chatId)
  return d ? `/supplier/chats?deal=${d.id}&m=1` : "/supplier/chats"
}

export function FreeChatRedirect({ chatId }: { chatId: string }) {
  const { ready, world } = useFree()
  const router = useRouter()
  useEffect(() => {
    if (ready) router.replace(freeChatTarget(world.deals, chatId) as never)
  }, [ready, world.deals, chatId, router])
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <Loader2 className="animate-spin text-module" size={24} aria-hidden="true" />
    </div>
  )
}
