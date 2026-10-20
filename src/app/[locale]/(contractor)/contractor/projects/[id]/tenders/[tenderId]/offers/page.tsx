import { redirect } from "@/i18n/routing"

// One page per RFQ (Procurement 1.5, PUR-09 #5) — the project-scoped address forwards to it, its tab with it.
export default async function TenderOffersRedirect({ params, searchParams }: { params: Promise<{ locale: string; tenderId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, tenderId } = await params
  const tab = (await searchParams).tab
  redirect({ href: `/contractor/rfqs/${tenderId}/offers${typeof tab === "string" ? `?tab=${encodeURIComponent(tab)}` : ""}`, locale })
}
