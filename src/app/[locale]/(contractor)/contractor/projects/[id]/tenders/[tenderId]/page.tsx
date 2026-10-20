import { redirect } from "@/i18n/routing"

// One page per RFQ (Procurement 1.5, PUR-09 #5): a project's tender IS an RFQ and opens at
// `/contractor/rfqs/{id}/offers`. This address stays so older links and bookmarks still resolve.
export default async function TenderRedirect({ params }: { params: Promise<{ locale: string; tenderId: string }> }) {
  const { locale, tenderId } = await params
  redirect({ href: `/contractor/rfqs/${tenderId}/offers`, locale })
}
