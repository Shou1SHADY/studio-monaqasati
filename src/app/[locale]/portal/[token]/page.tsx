import type { Metadata } from "next"
import { PortalLinkContent } from "./PortalLinkContent"

// The consultant's portal — reached only through an unguessable per-project
// link, so it must never be indexed or previewed by crawlers.
export const metadata: Metadata = {
  title: "بوابة الاستشاري | Mdmak Tech",
  robots: { index: false, follow: false },
}

export default function ConsultantPortalPage() {
  return <PortalLinkContent />
}
