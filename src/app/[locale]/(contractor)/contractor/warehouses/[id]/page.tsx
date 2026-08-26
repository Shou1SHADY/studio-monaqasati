"use client"

import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Link } from "@/i18n/routing"
import { useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { doc } from "firebase/firestore"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { WarehouseInventoryPanel } from "@/components/contractor/WarehouseInventoryPanel"

export default function ContractorWarehouseDetailPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const params = useParams()
  const warehouseId = params.id as string
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

  // The warehouse document is not read here any more — the panel subscribes to it
  // for the header it now owns, and a second listener on the same doc was waste.

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        {/* Only the back link lives here — the panel renders the warehouse's name,
            badge and location, so duplicating them produced two identical headings. */}
        <Link
          href="/contractor/warehouses"
          aria-label={t("wh_page_title")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
        >
          <ArrowRight size={16} className={cn(isRtl ? "" : "rotate-180")} />
          {t("wh_page_title")}
        </Link>
        <WarehouseInventoryPanel warehouseId={warehouseId} orgId={myOrgId} variant="full" />
      </div>
    </PortalLayout>
  )
}
