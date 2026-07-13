import { getTranslations } from 'next-intl/server'
import { ContractorCatalog } from '@/components/contractor/ContractorCatalog'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Portal.Contractor' })
  return { title: t('catalog_page_title') }
}

export default function CatalogPage() {
  return <ContractorCatalog />
}
