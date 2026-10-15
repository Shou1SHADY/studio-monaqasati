"use client"

// Messages, notifications and the global search (PRD MSG-01…04, NAV-04). A conversation lives inside its deal; a notification
// starts with the contractor's name and opens the deal it is about; the search matches a request or order number, a
// contractor or a material and says where each result lives.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Bell, Building2, Check, Link2, MessageSquare, Search } from "lucide-react"
import { Link } from "@/i18n/routing"
import { notificationCopy } from "@/lib/mfg-events"
import type { Translator } from "@/lib/mfg-events"
import { cn } from "@/lib/utils"
import type { Deal } from "@/lib/supplier-free/types"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { FreePage, Pill, docWord } from "./ui"
import { DealPill } from "./Pills"
import { useFree, type Free } from "./useFree"
import { useFreeNotifications, type FreeNotification } from "./useFreeNotifications"

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

export function FreeMessages() {
  const f = useFree()
  const { t, world, L, fmt } = f
  const threads = useMemo(
    () => world.deals.filter((d) => d.chat && (d.chat.last || d.chat.unread)).sort((a, b) => (b.chat?.lastAt || "").localeCompare(a.chat?.lastAt || "")),
    [world.deals]
  )
  return (
    <FreePage icon={MessageSquare} title={t("navMessages")} description={t("mSub")}>
      {threads.length ? (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {threads.map((d) => {
            const c = L.C(d.c)
            return (
              <li key={d.id}>
                <Link href={`/supplier/chats?deal=${d.id}&m=1` as never} scroll={false} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cta/10 text-cta"><Building2 size={17} aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-sm"><bdi>{c?.name}</bdi></b>
                    <span className="block truncate text-xs text-muted-foreground"><bdi>{d.title}</bdi> — {d.chat?.last}</span>
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

const KIND_ICON: Record<string, typeof Bell> = { supplier_invite_received: Link2, supplier_connected: Link2 }

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
  const text = (n: FreeNotification) => {
    const c = n.i18n ? notificationCopy({ title: n.title, message: n.message, i18n: n.i18n as never }, shared as unknown as Translator, f.locale) : { title: n.title, message: n.message }
    return { title: c.title || n.title, message: c.message || n.message }
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
          <button type="button" onClick={() => void markAll()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-bold hover:bg-muted/50">
            <Check size={15} aria-hidden="true" />
            {t("markAll")}
          </button>
        ) : undefined
      }
    >
      {world.invites.length > 0 && (
        <Link href="/supplier/connections?tab=inv" className="flex items-center gap-3 rounded-xl border border-cta/30 bg-cta/5 px-4 py-3 text-sm hover:bg-cta/10">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cta/15 text-cta"><Link2 size={17} aria-hidden="true" /></span>
          <b>{t("nInvite", { c: L.C(world.invites[0].c)?.name || "" })}</b>
          {world.invites.length > 1 && <Pill tone="info">+{world.invites.length - 1}</Pill>}
        </Link>
      )}
      {list.length ? (
        <ul className="overflow-hidden rounded-xl border bg-card">
          {list.map((n) => {
            const d = dealOf(n)
            const when = (n.createdAt || "").slice(0, 10)
            const dn = when ? L.daysTo(when, today) : 0
            const group = !when ? "" : dn === 0 ? t("today") : dn === 1 ? t("yesterday") : fmt.date(when, true)
            const head = group !== last ? group : ""
            last = group
            const c = text(n)
            const Icon = KIND_ICON[n.type] || Bell
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
                {d ? (
                  <Link href={`/supplier/notifications?deal=${d.id}` as never} scroll={false} onClick={() => void markRead(n.id)} className="flex items-center gap-3 border-t px-4 py-3 hover:bg-muted/30">
                    {inner}
                  </Link>
                ) : (
                  <button type="button" onClick={() => void markRead(n.id)} className="flex w-full items-center gap-3 border-t px-4 py-3 text-start hover:bg-muted/30">
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
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-start">
            <thead className="border-b bg-muted/40 text-[11px] font-bold text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{t("thRequest")}</th>
                <th className="px-3 text-start">{t("thContractor")}</th>
                <th className="px-3 text-start">{t("thWhere")}</th>
                <th className="px-3 text-start">{t("thState")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const w = whereOf(f, d)
                return (
                  <tr key={d.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-3 py-2.5">
                      <Link href={`/supplier/search?q=${encodeURIComponent(needle)}&deal=${d.id}` as never} scroll={false} className="block text-sm font-bold hover:text-module" dir="auto">{d.title}</Link>
                      <span className="text-xs text-muted-foreground">{docWord(f, "rfq", d.rfq)}{d.po ? ` · ${docWord(f, "po", d.po.no)}` : ""}</span>
                    </td>
                    <td className="px-3 text-sm"><bdi>{L.C(d.c)?.name}</bdi></td>
                    <td className="px-3 text-sm"><Link href={w.href as never} className="text-module hover:underline">{w.label}</Link></td>
                    <td className="px-3"><DealPill f={f} d={d} /></td>
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
