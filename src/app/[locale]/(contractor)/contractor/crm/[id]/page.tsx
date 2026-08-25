import { redirect } from "@/i18n/routing"

/**
 * Contact detail moved to `/contractor/crm/leads/[id]` when the CRM was split
 * into three pages. This route stays as a redirect so links and bookmarks
 * saved before that split still resolve instead of 404ing.
 *
 * Next.js gives the static `leads` / `opportunities` / `rfqs` segments
 * priority over this dynamic one, so those pages are unaffected.
 */
export default async function ContractorCrmContactRedirect({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  redirect({ href: `/contractor/crm/leads/${id}`, locale })
}
