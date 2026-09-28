"use client"

import { useTranslations } from "next-intl"
import { FileText } from "lucide-react"
import type { RfqOfferView } from "@/components/procurement/rfq/rfqOfferView"

// On a guest offer's card: «(موثّق برمز)» when his mobile was proven by a code,
// and «أوراقه: …» — the CR / VAT certificate he uploaded through the link.
export function GuestOfferProof({ offer }: { offer: Pick<RfqOfferView, "guestContact" | "guestPapers"> }) {
  const t = useTranslations("Portal.Procurement.rfqextras.card")
  const papers = (offer.guestPapers || []).filter((p) => p?.url)
  return (
    <>
      {offer.guestContact?.phoneVerified && <span className="text-xs font-semibold text-success">{t("otp_verified")}</span>}
      {papers.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {t("papers")}
          {papers.map((p, i) => (
            <a key={p.kind} href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <FileText size={11} aria-hidden="true" />
              {t(`paper_${p.kind}`)}
              {i < papers.length - 1 ? " ·" : ""}
            </a>
          ))}
        </span>
      )}
    </>
  )
}
