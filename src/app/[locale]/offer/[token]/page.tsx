import type { Metadata } from "next"
import { GuestOfferContent } from "./GuestOfferContent"

// Guest offer follow-up view — reached only through an unguessable per-offer
// link, so it must never be indexed or previewed by crawlers.
export const metadata: Metadata = {
  title: "متابعة عرض السعر | Mdmak Tech Offer",
  robots: { index: false, follow: false },
}

export default function GuestOfferPage() {
  return <GuestOfferContent />
}
