import { getTranslations } from 'next-intl/server'
import { PortalLayout } from '@/components/layout/portal-layout'
import { ComingSoon } from '@/components/shared/ComingSoon'
import { ContractorCatalog } from '@/components/contractor/ContractorCatalog'
import { CATALOG_COMING_SOON } from '@/lib/feature-flags'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Portal.Contractor' })
  return { title: t('catalog_page_title') }
}

export default function CatalogPage() {
  // Held back behind CATALOG_COMING_SOON — the sidebar entry is dimmed, but the
  // route stays reachable by URL and by an old bookmark, so it has to say so
  // itself rather than render the live page.
  if (CATALOG_COMING_SOON) {
    return (
      <PortalLayout>
        <ComingSoon backHref="/contractor/rfqs" />
      </PortalLayout>
    )
  }
  return <ContractorCatalog />
}
