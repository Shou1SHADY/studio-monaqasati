import { redirect } from "@/i18n/routing"

/**
 * The old launcher page. The portal home IS the launcher now — the same tile
 * grid for a contractor and a supplier, every module with its numbers, locked
 * ones with "request access" — so a second, plainer grid here only made the
 * two portals look different. Kept as a redirect so links and bookmarks land.
 */
export default async function SupplierAppsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect({ href: "/supplier", locale })
}
