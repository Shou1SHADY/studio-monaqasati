import { redirect } from "@/i18n/routing"

/**
 * The old employees list became HR 1.0's People (the record, pay kept apart,
 * the undeletable log). Kept as a redirect so links and bookmarks still land.
 */
export default async function SupplierEmployeesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect({ href: "/supplier/hr/people", locale })
}
