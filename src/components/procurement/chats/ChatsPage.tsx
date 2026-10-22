"use client"

// «محادثاتي» (MSG-02, prototype `viewMsgs`): one conversation per SENT order with its supplier — on the platform, or on WhatsApp
// with the order link for one outside it. The list puts what is unread first, then the latest; a search finds a supplier or an
// order number; on a phone the list comes first and a conversation replaces it (with a way back). Everything is read from the
// world the Procurement pages already load, so the list and the sidebar's counter can never disagree.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { ArrowRight, MessageCircle, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Link } from "@/i18n/routing"
import { useUser } from "@/firebase"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { displayPoNumber } from "@/lib/procurement/format"
import { poSiteOf } from "@/lib/procurement/po-state"
import { chatRows, type ChatRow, type PoWithChat, type ThreadReceipt } from "@/lib/procurement/po-messages"
import { cn } from "@/lib/utils"
import { factText } from "./ThreadBody"
import { ConversationPanel } from "./ConversationPanel"

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")

function lastLine(t: ReturnType<typeof useTranslations>, row: ChatRow, no: string, locale: string): string {
  const last = row.last
  if (!last) return t("no_messages_row")
  if (last.sys) return factText(t, last, no, locale)
  const m = last.message
  return `${m.by === "us" ? t("you_prefix") : ""}${m.text || t("file")}`
}

export function ChatsPage() {
  const t = useTranslations("Portal.ProcChats")
  const locale = useLocale()
  const params = useSearchParams()
  const { user } = useUser()
  const world = useProcurementWorld()
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState<string | null>(params.get("po"))
  const [thread, setThread] = useState(Boolean(params.get("po")))

  const receiptsByPo = useMemo(() => {
    const m = new Map<string, ThreadReceipt[]>()
    for (const d of world.deliveries) {
      if (!d.poId) continue
      const list = m.get(d.poId) || []
      list.push({ docNumber: d.docNumber ?? null, status: d.status, confirmedAt: d.confirmedAt ?? null, createdAt: d.createdAt })
      m.set(d.poId, list)
    }
    return m
  }, [world.deliveries])

  const rows = useMemo(() => chatRows(world.orders as PoWithChat[], user?.uid || "", search, (id) => receiptsByPo.get(id) || []), [world.orders, user?.uid, search, receiptsByPo])
  const selected = rows.find((r) => r.po.id === picked) || (thread ? null : rows[0]) || null
  const phoneOf = (po: PoWithChat): string | null =>
    ((world.supplierRecords.find((r) => r.supplierOrgId === po.supplierOrgId) as { contactPhone?: string | null } | undefined)?.contactPhone ||
      (world.offers.find((o) => o.id === po.offerId) as { guestContact?: { phone?: string | null } } | undefined)?.guestContact?.phone ||
      null) as string | null

  const open = (id: string) => {
    setPicked(id)
    setThread(true)
  }

  if (!world.loading && world.orders.every((o) => !o.sentAt)) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center">
        <MessageCircle size={28} className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
        <p className="font-bold">{t("empty_title")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("empty_desc")}</p>
      </div>
    )
  }

  return (
    <div className="grid min-h-[28rem] gap-4 md:grid-cols-[20rem_1fr]">
      <section className={cn("space-y-3", thread && "hidden md:block")} aria-label={t("list_label")}>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground start-3" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search_ph")} aria-label={t("search_ph")} className="h-10 rounded-xl bg-card ps-9 pe-9" dir="auto" />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label={t("search_clear")} className="absolute top-1/2 -translate-y-1/2 end-2 grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">{t("no_results")}</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {rows.map((row) => {
              const no = displayPoNumber(row.po.docNumber, locale)
              const on = selected?.po.id === row.po.id
              return (
                <li key={row.po.id}>
                  <button
                    type="button"
                    onClick={() => open(row.po.id)}
                    aria-current={on ? "true" : undefined}
                    className={cn("flex w-full items-start gap-3 p-3 text-start transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", on && "bg-module/10", row.unread && "font-bold")}
                  >
                    <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold", row.offPlatform ? "bg-warning/15 text-warning" : "bg-module/15 text-module")} aria-hidden="true">
                      {initials(row.po.supplierName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm" dir="auto">
                          {row.po.supplierName}
                        </span>
                        <span className="shrink-0 text-[10px] font-normal text-muted-foreground">{row.lastAt ? new Date(row.lastAt).toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "short" }) : ""}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                        <span dir="ltr">{no}</span>
                        {row.offPlatform && <span className="rounded-full bg-warning/10 px-1.5 text-warning">{t("whatsapp")}</span>}
                      </span>
                      <span className="block truncate text-xs font-normal text-muted-foreground" dir="auto">
                        {lastLine(t, row, no, locale)}
                      </span>
                    </span>
                    {row.unread && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-module" aria-label={t("unread")} />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className={cn("min-w-0 rounded-2xl border bg-card", !thread && "hidden md:block")} aria-label={t("thread_label")}>
        {selected ? (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b p-3">
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 md:hidden" onClick={() => setThread(false)} aria-label={t("back")}>
                <ArrowRight size={16} className="ltr:rotate-180" aria-hidden="true" />
              </Button>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold" dir="auto">
                  {selected.po.supplierName}
                </p>
                <p className="truncate text-xs text-muted-foreground" dir="auto">
                  {[displayPoNumber(selected.po.docNumber, locale), poSiteOf(selected.po)?.name].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/contractor/rfqs/orders?po=${selected.po.id}`}>{t("open_order")}</Link>
              </Button>
            </header>
            <ConversationPanel key={selected.po.id} po={selected.po} side="buyer" orgId={selected.po.organizationId} receipts={receiptsByPo.get(selected.po.id) || []} phone={phoneOf(selected.po)} className="p-3" />
          </>
        ) : (
          <p className="p-10 text-center text-sm text-muted-foreground">{t("pick_one")}</p>
        )}
      </section>
    </div>
  )
}
