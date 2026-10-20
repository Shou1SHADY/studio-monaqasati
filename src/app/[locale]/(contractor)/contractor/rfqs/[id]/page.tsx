import { redirect } from "@/i18n/routing"

// The RFQ's flat address opens its one page (PUR-09 #5).
export default async function RfqRedirect({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  redirect({ href: `/contractor/rfqs/${id}/offers`, locale })
}
