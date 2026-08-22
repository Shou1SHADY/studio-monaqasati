import type { Metadata } from "next"
import { PublicRfqContent } from "./PublicRfqContent"

// Guest RFQ view — reached only through an unguessable share link, so it
// must never be indexed or previewed by crawlers.
export const metadata: Metadata = {
  title: "طلب عروض أسعار | Mdmak Tech RFQ",
  robots: { index: false, follow: false },
}

export default function PublicRfqPage() {
  return <PublicRfqContent />
}
