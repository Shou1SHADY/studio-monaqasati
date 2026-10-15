"use client"

// The deal drawer (PRD NAV-05, NAV-06): every card or row opens it over the list it came from, by address
// (`?deal=<id>`); closing it or pressing Esc returns to that list. A five-stage tracker, the next step with its button,
// four figures, and collapsible sections from the request to the transfer — every figure the one the lists show.

import { useEffect } from "react"
import { Building2, Check, MapPin, MessageSquare, Phone, Search, Send, Truck, Wallet } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { DealPill } from "./Pills"
import { DealStats, NextBox, Tracker } from "./DealNext"
import { SecMsgs, SecOffer, SecPay, SecPo, SecRequest, SecShip, SecWar } from "./DealSections"
import { VerifiedMark, docWord, useQueryState } from "./ui"
import { useFree } from "./useFree"

const STAGE_ICON = { new: Search, offered: Send, deliver: Truck, collect: Wallet, done: Check } as const

export function DealDrawer() {
  const f = useFree()
  const q = useQueryState()
  const id = q.get("deal")
  const d = id ? f.world.deals.find((x) => x.id === id) || null : null
  const { markSeen } = f
  useEffect(() => {
    if (d) markSeen(d.id)
  }, [d, markSeen])
  if (!id) return null
  const close = () => q.set({ deal: null, m: null, quote: null, mode: null })
  return (
    <Sheet open onOpenChange={(o) => !o && close()}>
      <SheetContent side={f.isAr ? "left" : "right"} className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl" aria-describedby="deal-desc">
        {d ? <Body f={f} d={d} href={q.href} focusMsgs={q.get("m") === "1"} /> : <NotFound f={f} />}
        <SheetDescription id="deal-desc" className="sr-only">
          {d ? d.title : f.t("notFound")}
        </SheetDescription>
      </SheetContent>
    </Sheet>
  )
}

function NotFound({ f }: { f: ReturnType<typeof useFree> }) {
  return (
    <div className="grid flex-1 place-items-center p-8 text-center">
      <SheetTitle className="text-sm font-bold">{f.t("notFound")}</SheetTitle>
    </div>
  )
}

function Body({ f, d, href, focusMsgs }: { f: ReturnType<typeof useFree>; d: NonNullable<ReturnType<typeof useFree>["world"]["deals"][number]>; href: (p: Record<string, string | null>) => string; focusMsgs: boolean }) {
  const { t, L } = f
  const c = L.C(d.c)
  const st = L.stage(d)
  const Icon = STAGE_ICON[st]
  const showCall = !!c && (d.channel === "invite" || !!d.po || !!c.conn)
  useEffect(() => {
    if (!focusMsgs) return
    const el = document.getElementById("sec-msgs")
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 120)
  }, [focusMsgs])
  return (
    <>
      <header className="flex items-start gap-3 border-b px-5 py-4 pe-12">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
          <Icon size={19} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-base font-black leading-snug" dir="auto">
            {d.title}
          </SheetTitle>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Building2 size={13} aria-hidden="true" />
              <bdi>{c?.name}</bdi> <VerifiedMark f={f} verified={!!c?.verified} />
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin size={13} aria-hidden="true" />
              <bdi>{d.city}</bdi>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {docWord(f, "rfq", d.rfq)}
              {d.po ? ` · ${docWord(f, "po", d.po.no)}` : ""}
            </span>
            <DealPill f={f} d={d} />
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {showCall && c && (
              <a href={`tel:${c.phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-bold hover:bg-muted/50">
                <Phone size={13} aria-hidden="true" />
                {t("call")}
              </a>
            )}
            <Link href={href({ m: "1" }) as never} scroll={false} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-bold hover:bg-muted/50")}>
              <MessageSquare size={13} aria-hidden="true" />
              {t("secMsgs")}
              {(d.chat?.unread || 0) > 0 && <span className="rounded-full bg-destructive px-1.5 text-[10px] text-white tabular-nums">{d.chat?.unread}</span>}
            </Link>
          </div>
        </div>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <Tracker f={f} d={d} />
        <NextBox f={f} d={d} href={href} />
        <DealStats f={f} d={d} />
        <SecRequest f={f} d={d} />
        {d.offer && L.curV(d) && <SecOffer f={f} d={d} />}
        {d.po && <SecPo f={f} d={d} />}
        {d.po && d.po.acc && <SecShip f={f} d={d} />}
        <SecPay f={f} d={d} />
        {d.war && <SecWar f={f} d={d} />}
        <SecMsgs f={f} d={d} focus={focusMsgs} />
      </div>
    </>
  )
}
