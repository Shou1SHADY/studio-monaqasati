"use client"

// The deal drawer (PRD NAV-05, NAV-06): every card or row opens it over the list it came from, by address
// (`?deal=<id>`); closing it or pressing Esc returns to that list. A five-stage tracker, the next step with its button,
// four figures, and collapsible sections from the request to the transfer — every figure the one the lists show.

import { useEffect } from "react"
import { Building2, Check, Loader2, MapPin, MessageSquare, Phone, Search, Send, Truck, Wallet } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DealPill } from "./Pills"
import { DealStats, NextBox, Tracker } from "./DealNext"
import { SecMsgs, SecOffer, SecPay, SecPo, SecRequest, SecShip, SecWar } from "./DealSections"
import { SecOrderChat } from "./SecOrderChat"
import { VerifiedMark, actionBtn, docWord, useQueryState } from "./ui"
import { useFree } from "./useFree"
import { useCountRfqView } from "@/hooks/useCountRfqView"

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
  // RFQ-02: opening the deal is reading its request — counted in the buyer's «اطّلع عليه» (once per company, on the server).
  useCountRfqView(d?.id)
  if (!id) return null
  // Closing is a step of its own in the history: back reopens the deal, as it does for every address (NAV-06).
  const close = () => q.set({ deal: null, m: null, quote: null, mode: null })
  return (
    <Sheet open onOpenChange={(o) => !o && close()}>
      <SheetContent side={f.isAr ? "left" : "right"} dir={f.isAr ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl" aria-describedby="deal-desc">
        {d ? <Body f={f} d={d} href={q.href} focusMsgs={q.get("m") === "1"} /> : f.ready ? <NotFound f={f} /> : <Loading f={f} />}
        <SheetDescription id="deal-desc" className="sr-only">
          {d ? d.title : f.ready ? f.t("notFound") : f.t("loadingWorld")}
        </SheetDescription>
      </SheetContent>
    </Sheet>
  )
}

/** A deep link (`?deal=`) opened before the world has loaded: a loader, never "not found" (NAV-06). */
function Loading({ f }: { f: ReturnType<typeof useFree> }) {
  return (
    <div className="grid flex-1 place-items-center p-8 text-center" role="status" aria-busy="true">
      <Loader2 size={24} className="animate-spin text-module" aria-hidden="true" />
      <SheetTitle className="sr-only">{f.t("loadingWorld")}</SheetTitle>
    </div>
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
      <SheetHeader className="flex-row items-start gap-3 space-y-0 border-b px-4 py-4 pe-12 text-start sm:px-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
          <Icon size={19} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-lg font-black leading-relaxed text-primary" dir="auto">
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
              <a href={`tel:${c.phone}`} className={actionBtn("outline")}>
                <Phone size={13} aria-hidden="true" />
                {t("call")}
              </a>
            )}
            <Link href={href({ m: "1" }) as never} scroll={false} className={actionBtn("outline")}>
              <MessageSquare size={13} aria-hidden="true" />
              {t("secMsgs")}
              {(d.chat?.unread || 0) > 0 && <span className="min-w-5 rounded-full bg-destructive px-1.5 text-center text-[11px] leading-5 text-destructive-foreground tabular-nums">{d.chat?.unread}</span>}
            </Link>
          </div>
        </div>
      </SheetHeader>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
        <Tracker f={f} d={d} />
        <NextBox f={f} d={d} href={href} />
        <DealStats f={f} d={d} />
        <SecRequest f={f} d={d} />
        {d.offer && L.curV(d) && <SecOffer f={f} d={d} />}
        {d.po && <SecPo f={f} d={d} />}
        {d.po && d.po.acc && <SecShip f={f} d={d} />}
        <SecPay f={f} d={d} />
        {d.war && <SecWar f={f} d={d} />}
        {d.po && <SecOrderChat f={f} d={d} />}
        <SecMsgs f={f} d={d} focus={focusMsgs} />
      </div>
    </>
  )
}
