"use client"

// «مورّد من خارج المنصة» (RFQ-08): what a visitor to the link typed, and nothing else. Nothing about him is verified, he is new
// to us, his official quote and CR are asked with the order — and none of this stops the award. Reached on WhatsApp with his
// own offer link, invited to the platform, or added to our suppliers.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, MessageCircle, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useUser } from "@/firebase"
import { buildWhatsAppLink } from "@/utils/guest-offer-workflow"
import { daysAgo, type OfferRowModel } from "@/lib/procurement/rfq-offers-view"
import { GuestOfferProof } from "@/components/procurement/guest/GuestOfferProof"
import { AddGuestSupplierButton } from "@/components/procurement/AddGuestSupplierButton"
import type { RfqOfferView } from "./rfqOfferView"

/** The private link to his own offer, the one he edits and answers from — minted by the server for the buyer. */
export async function fetchGuestOfferUrl(idToken: string, offerId: string): Promise<string | null> {
  try {
    const res = await fetch("/api/rfq-share/guest-link", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ offerId }) })
    if (!res.ok) return null
    const json = (await res.json()) as { url?: string; data?: { url?: string } }
    return json.url || json.data?.url || null
  } catch {
    return null
  }
}

export function OffPlatformBox({ row, rfqTitle, today, canAct, inOurs, onInvite }: { row: OfferRowModel; rfqTitle: string; today: string; canAct: boolean; inOurs: boolean; onInvite: () => void }) {
  const t = useTranslations("Portal.Procurement.rfqpage.off")
  const { user } = useUser()
  const [opening, setOpening] = useState(false)
  const [added, setAdded] = useState(false)
  const offer = row.offer as RfqOfferView
  const contact = offer.guestContact || null
  const ago = daysAgo(row.submittedAt, today)
  const verified = (what: string) => <span className="text-[11px] font-semibold text-muted-foreground">{what}</span>

  const openWhatsApp = async () => {
    if (!contact?.phone) return
    setOpening(true)
    try {
      const token = user ? await user.getIdToken() : null
      const url = token ? await fetchGuestOfferUrl(token, row.id) : null
      const message = url ? t("wa_message_link", { rfq: rfqTitle, url }) : t("wa_message", { rfq: rfqTitle })
      const href = buildWhatsAppLink(contact.phone, message)
      if (href) window.open(href, "_blank", "noopener,noreferrer")
    } finally {
      setOpening(false)
    }
  }

  const value = (v: string | null | undefined, ltr = false) => (v ? <span dir={ltr ? "ltr" : "auto"}>{v}</span> : <span className="text-muted-foreground">{t("missing")}</span>)

  return (
    <section className="space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-3" aria-label={t("title")} data-testid="off-platform-box">
      <header>
        <h4 className="text-sm font-black">{t("title")}</h4>
        <p className="text-xs text-muted-foreground">{ago == null ? t("sub_unknown") : ago === 0 ? t("sub_today") : t("sub_ago", { days: ago })}</p>
      </header>
      <div>
        <KeyValueRow label={t("mobile")} value={<span className="flex items-center gap-2">{value(contact?.phone, true)}{contact?.phone && (contact.phoneVerified ? <span className="text-[11px] font-semibold text-success">{t("code_verified")}</span> : verified(t("unverified")))}</span>} />
        <KeyValueRow label={t("contact")} value={value(contact?.name)} />
        <KeyValueRow label={t("cr")} value={<span className="flex items-center gap-2">{(offer.guestPapers || []).some((p) => p.kind === "cr") ? <GuestOfferProof offer={{ guestContact: null, guestPapers: (offer.guestPapers || []).filter((p) => p.kind === "cr") }} /> : <span className="text-muted-foreground">{t("missing")}</span>}{verified(t("unverified"))}</span>} />
        <KeyValueRow label={t("vat")} value={<span className="flex items-center gap-2">{value(contact?.vatNumber, true)}{contact?.vatNumber && verified(t("unverified"))}</span>} />
      </div>
      <Callout tone="warn">{t("new")}</Callout>
      {canAct && (
        <div className="flex flex-wrap gap-2">
          {contact?.phone && (
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={openWhatsApp} disabled={opening}>
              {opening ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <MessageCircle size={14} aria-hidden="true" />}
              {t("whatsapp")}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onInvite}>
            <UserPlus size={14} aria-hidden="true" />
            {offer.guestInvite?.at ? t("invited") : t("invite")}
          </Button>
          {inOurs || added ? (
            <span className="inline-flex items-center rounded-full bg-success/10 px-2.5 text-xs font-bold text-success">{t("in_ours")}</span>
          ) : (
            <AddGuestSupplierButton target={{ offerId: row.id }} size="sm" variant="outline" onAdded={() => setAdded(true)} />
          )}
        </div>
      )}
      {canAct && !inOurs && !added && <p className="text-[11px] text-muted-foreground">{t("add_hint")}</p>}
    </section>
  )
}
