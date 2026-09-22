import type { Metadata } from "next"
import { ReceiveLinkContent } from "./ReceiveLinkContent"

// The receiver's link — reached only through an unguessable per-delivery link,
// so it must never be indexed or previewed by crawlers.
export const metadata: Metadata = {
  title: "تأكيد الاستلام | Mdmak Tech",
  robots: { index: false, follow: false },
}

export default function ReceiveLinkPage() {
  return <ReceiveLinkContent />
}
