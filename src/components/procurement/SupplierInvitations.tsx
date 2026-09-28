"use client"

// «دعوات الانضمام إلى منصة مدماك» (prototype invSec). The system does not
// message anybody: it opens the sender's own WhatsApp or mail with a ready
// text carrying the join link in the supplier's name, records which way it
// left, and offers the link to copy for any other tool.

import { useTranslations } from "next-intl"
import { Copy, Mail, MessageCircle } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { daysBetween, todayOf } from "@/lib/procurement/po"
import { inviteJoinUrl, inviteMessage, mailtoLink, waLink } from "@/lib/procurement/supplier-file"
import { markInvitationSent } from "@/lib/procurement/supplier-writes"

export interface InvitationDoc {
  id: string
  companyName?: string | null
  email?: string | null
  phone?: string | null
  message?: string | null
  invitedBy?: string | null
  invitedByName?: string | null
  createdAt?: unknown
  status?: string | null
  type?: string | null
  inviteToken?: string | null
  sentChannel?: "wa" | "email" | null
}

export const invitationDay = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v.slice(0, 10)
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? todayOf(ts.toDate()) : null
}

export const portalOrigin = () => (typeof window !== "undefined" && window.location.origin) || "https://mdmaktech.sa"

export function SupplierInvitations({ invitations, canManage, orgName, now }: { invitations: InvitationDoc[]; canManage: boolean; orgName: string; now: Date }) {
  const t = useTranslations("Portal.ProcSuppliers")
  const firestore = useFirestore()
  const { toast } = useToast()
  if (!canManage || !invitations.length) return null
  const pending = invitations.filter((i) => i.status === "pending").length
  const today = todayOf(now)

  const textFor = (inv: InvitationDoc, url: string) => inviteMessage(inv.message, t("inv.sentence", { company: orgName, url }))
  const send = (inv: InvitationDoc, channel: "wa" | "email") => {
    if (!inv.inviteToken) return
    const url = inviteJoinUrl(portalOrigin(), inv.inviteToken)
    const body = textFor(inv, url)
    if (channel === "wa") window.open(waLink(inv.phone || "", body), "_blank", "noopener,noreferrer")
    else window.location.href = mailtoLink(inv.email || "", t("inv.subject"), body)
    if (firestore) markInvitationSent(firestore, inv.id, channel, now).catch(() => toast({ title: t("err.generic"), variant: "destructive" }))
  }
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: t("inv.copied") })
    } catch {
      toast({ title: url })
    }
  }
  const ago = (inv: InvitationDoc) => {
    const d = invitationDay(inv.createdAt)
    return d ? t("inv.ago", { days: Math.max(0, daysBetween(d, today)) }) : ""
  }
  const sorted = [...invitations].sort((a, b) => (invitationDay(b.createdAt) || "").localeCompare(invitationDay(a.createdAt) || ""))

  return (
    <section className="overflow-hidden rounded-2xl border bg-card" aria-labelledby="sup-invitations">
      <header className="border-b px-4 py-3">
        <h2 id="sup-invitations" className="flex items-center gap-2 text-sm font-black text-foreground">
          {t("inv.title")}
          <span className="rounded-full bg-muted px-2 text-xs font-bold tabular-nums text-muted-foreground">{pending}</span>
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("inv.desc")}</p>
      </header>
      <ul className="divide-y">
        {sorted.map((inv) => {
          const url = inv.inviteToken ? inviteJoinUrl(portalOrigin(), inv.inviteToken) : null
          const contact = inv.phone || inv.email || ""
          return (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-bold text-foreground" dir="auto">
                  {inv.companyName || inv.email || inv.phone}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {contact && <span dir="ltr">{contact}</span>}
                  {contact && " · "}
                  {t("inv.invited_by", { name: inv.invitedByName || "—" })} {ago(inv)}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {inv.sentChannel ? t(`inv.sent_${inv.sentChannel}`) : t("inv.not_sent")}
                  {url && (
                    <>
                      {" · "}
                      <span dir="ltr" className="select-all">
                        {url.length > 60 ? `${url.slice(0, 57)}…` : url}
                      </span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {inv.status === "accepted" ? (
                  <StatusPill tone="ok">{t("inv.joined")}</StatusPill>
                ) : inv.status === "declined" ? (
                  <StatusPill tone="bad">{t("inv.declined")}</StatusPill>
                ) : (
                  <>
                    {inv.phone && url && (
                      <Button size="sm" className="gap-1.5" onClick={() => send(inv, "wa")}>
                        <MessageCircle size={14} aria-hidden="true" />
                        {t("inv.send_wa")}
                      </Button>
                    )}
                    {inv.email && url && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => send(inv, "email")}>
                        <Mail size={14} aria-hidden="true" />
                        {t("inv.send_email")}
                      </Button>
                    )}
                    {url && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy(url)}>
                        <Copy size={14} aria-hidden="true" />
                        {t("inv.copy")}
                      </Button>
                    )}
                    <StatusPill tone="warn">{t("inv.not_joined")}</StatusPill>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
