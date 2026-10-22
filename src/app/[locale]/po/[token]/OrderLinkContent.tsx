"use client"

// The order link (`/po/<token>`, Procurement 2.0 MSG-04 / WF-17): a supplier outside the platform opens ONE purchase order from the
// message the buyer sent on WhatsApp, accepts it, asks for a change, declines it, reports a delivery by a day and a note, and
// writes to the buyer — with no account. The server decides what he may do (`view.acts`); this page shows exactly that.

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Clock, Loader2 } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import type { PoLinkView } from "@/lib/po-link"
import { ThreadBody } from "@/components/procurement/chats/ThreadBody"
import { Composer } from "@/components/procurement/chats/Composer"
import { PromoCard } from "@/components/procurement/guest/PromoCard"
import { LinkOrderShell } from "@/components/procurement/guest/LinkOrderShell"
import { LinkOrderView, type LinkOrderActions } from "@/components/procurement/guest/LinkOrderView"
import { OrderLinkError, actOnOrder, loadOrder, uploadOrderFile } from "@/components/procurement/guest/link-order-api"

export function OrderLinkContent() {
  const { token } = useParams<{ token: string }>()
  const locale = useLocale() as "ar" | "en"
  const t = useTranslations("PoLink")
  const tc = useTranslations("Portal.ProcChats")
  const { toast } = useToast()
  const [view, setView] = useState<PoLinkView | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadOrder(token)
      .then(async (v) => {
        if (cancelled) return
        setView(v)
        if (v.unread > 0 && v.acts.reply) setView(await actOnOrder(token, "me").catch(() => v))
      })
      .catch((e) => !cancelled && setCode(e instanceof OrderLinkError ? e.code : "NETWORK"))
    return () => {
      cancelled = true
    }
  }, [token])

  const run = useCallback(
    async (act: Parameters<typeof actOnOrder>[1], body: Record<string, unknown>, done: string) => {
      setBusy(true)
      try {
        setView(await actOnOrder(token, act, { ...body, locale }))
        toast({ title: t(done) })
      } catch (e) {
        toast({ title: t(e instanceof OrderLinkError && e.code === "RATE_LIMITED" ? "err_rate" : "err_action"), variant: "destructive" })
        try {
          setView(await loadOrder(token))
        } catch {
          // the page keeps what it has
        }
      } finally {
        setBusy(false)
      }
    },
    [token, locale, toast, t]
  )

  const actions: LinkOrderActions = {
    accept: (date) => run("accept", date ? { date } : {}, "done_accept"),
    decline: (reason, note) => run("decline", { reason, note: note.trim() || null }, "done_decline"),
    askChange: (text) => run("request-change", { text }, "done_change"),
    report: (offset, note) => run("report-delivery", { offset, note: note.trim() || null }, "done_report"),
    acceptVersion: (n) => run("accept-version", { version: n }, "done_version"),
  }

  const langHref = `/po/${token}`

  if (code) {
    return (
      <LinkOrderShell company="" langHref={langHref}>
        <section className="space-y-3 rounded-md border bg-card p-8 text-center" role="alert">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-warning/10 text-warning">
            <Clock size={22} aria-hidden="true" />
          </span>
          <h1 className="text-lg font-black">{t(code === "NOT_SENT" ? "not_sent_title" : "invalid_title")}</h1>
          <p className="text-sm text-muted-foreground">{t(code === "NOT_SENT" ? "not_sent_desc" : "invalid_desc")}</p>
          <Button asChild variant="outline">
            <Link href="/">{t("go_home")}</Link>
          </Button>
        </section>
      </LinkOrderShell>
    )
  }

  if (!view) {
    return (
      <LinkOrderShell company="" langHref={langHref}>
        <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="animate-spin" size={32} aria-hidden="true" />
          <p className="text-sm">{t("loading")}</p>
        </div>
      </LinkOrderShell>
    )
  }

  return (
    <LinkOrderShell company={view.company} langHref={langHref}>
      <LinkOrderView view={view} actions={actions} busy={busy} />
      {view.state !== "cancelled" && (
        <section className="rounded-md border bg-card" aria-label={tc("thread_title_supplier")}>
          <header className="border-b px-3.5 py-2.5">
            <h2 className="text-sm font-bold">{tc("thread_title_supplier")}</h2>
          </header>
          <div className="space-y-3 p-3.5">
            {view.thread.length === 0 ? <p className="text-sm text-muted-foreground">{tc("no_messages")}</p> : <ThreadBody items={view.thread} side="supplier" no={view.no} supplierName={view.supplierName} company={view.company} />}
            {view.acts.reply && (
              <Composer
                placeholder={tc("write_buyer")}
                onSend={async ({ text, file }) => {
                  setView(await actOnOrder(token, "reply", { text: text.trim() || null, file, locale }))
                }}
                onUpload={(f) => uploadOrderFile(token, f)}
              />
            )}
          </div>
        </section>
      )}
      <PromoCard />
    </LinkOrderShell>
  )
}
