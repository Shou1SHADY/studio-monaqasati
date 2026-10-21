"use client"

// Procurement 2.0's pieces of the order drawer that are not Finance's or the supplier's: «التواصل مع المورّد» (the section's shell —
// the channel, the order's last four events, the way to the full conversation and to a call; messaging itself is a later wave) and
// the pay-later row «قريباً». The Section wrapper stays in the drawer; these only fill it.

import { useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Check, Coins, MessageSquare, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { useDateText } from "./PoBits"

export interface ChatEvent {
  at: string
  text: string
}

/** The order's conversation as the drawer shows it: who he is reached by, the last four events, then the doors to more. */
export function PoChatBody({ registered, events, phone, className }: { registered: boolean; events: ChatEvent[]; phone: string | null; className?: string }) {
  const t = useTranslations("Portal.ProcOrders")
  const fmt = useDateText()
  const last = events.slice(-4)
  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-xs text-muted-foreground">{t(registered ? "chat.channel_portal" : "chat.channel_link")}</p>
      {events.length > 4 && <p className="text-[11px] text-muted-foreground">{t("chat.older", { count: events.length - 4 })}</p>}
      {last.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("chat.empty")}</p>
      ) : (
        <ol className="space-y-1.5">
          {last.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span dir="auto">
                {e.text} · {fmt(e.at)}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">{t("chat.messaging_soon")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href="/contractor/chats">
            <MessageSquare size={14} aria-hidden="true" />
            {t("chat.full")}
          </Link>
        </Button>
        {phone && (
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
              <Phone size={14} aria-hidden="true" />
              {t("chat.call")}
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}

/** «ادفع هذا الأمر بالأجل على دفعات» + «قريباً»: opens the explanation, writes nothing. */
export function PoBnplRow({ className }: { className?: string }): ReactNode {
  const t = useTranslations("Portal.ProcOrders")
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className={cn("flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm", className)}>
        <Coins size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1" dir="auto">
          {t("bnpl.row")}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t("bnpl.soon")}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-start">
            <DialogTitle>{t("bnpl.title")}</DialogTitle>
            <DialogDescription>{t("bnpl.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)}>
              {t("bnpl.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
