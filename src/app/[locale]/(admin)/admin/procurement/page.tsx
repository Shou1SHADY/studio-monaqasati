import { getTranslations } from "next-intl/server"
import { buildPageMetadata } from "@/lib/seo"
import { MdmakProcurementQueue } from "@/components/admin/MdmakProcurementQueue"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "Portal.Admin.Procurement" })
  return buildPageMetadata({
    locale,
    title: t("page_title"),
    description: t("page_desc"),
    path: "/admin/procurement",
  })
}

export default function AdminProcurementPage() {
  return <MdmakProcurementQueue />
}
