import { redirect } from "@/i18n/routing"

/**
 * The CRM is four pages now — Dashboard, Leads, Opportunities and Activities.
 * This module root is kept as a redirect so old links, bookmarks and the
 * app-switcher's stored "last visited" href all still land somewhere useful
 * instead of 404ing.
 */
export default async function ContractorCrmPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect({ href: "/contractor/crm/dashboard", locale })
}
