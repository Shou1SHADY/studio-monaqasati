import type { Metadata } from "next"
import { OrderLinkContent } from "./OrderLinkContent"

// The order link — reached only through an unguessable address sent to one supplier, so it must never be indexed or previewed.
export const metadata: Metadata = {
  title: "أمر شراء | Mdmak Tech Purchase Order",
  robots: { index: false, follow: false },
}

export default function OrderLinkPage() {
  return <OrderLinkContent />
}
