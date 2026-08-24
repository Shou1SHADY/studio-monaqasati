import { redirect } from "@/i18n/routing"

/** The supplier CRM's module root — see the contractor twin for why this is a
 * redirect rather than a page of its own. */
export default async function SupplierCrmPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect({ href: "/supplier/crm/leads", locale })
}
