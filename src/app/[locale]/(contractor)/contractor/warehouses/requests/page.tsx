"use client"

import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Link } from "@/i18n/routing"
import { useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { doc } from "firebase/firestore"
import { useCentralWarehouse } from "@/hooks/useCentralWarehouse"
import { usePermissions } from "@/hooks/usePermissions"
import { WarehouseRequestsSection } from "@/components/contractor/WarehouseRequestsSection"
import { ClipboardList, ArrowRight, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export default function ContractorWarehouseRequestsPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { can } = usePermissions()
  const canManageWarehouses = can("warehouses.manage")

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

  const { centrals, projectWarehouses, isLoading } = useCentralWarehouse(myOrgId)
  const warehouseNameById = new Map<string, string>()
  ;[...centrals, ...projectWarehouses].forEach((w) => { if (w) warehouseNameById.set(w.id, w.name) })

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div className="flex items-center gap-3">
          <Link href="/contractor/warehouses" className="text-muted-foreground hover:text-primary transition-colors">
            <ArrowRight size={18} className={cn(isRtl ? "" : "rotate-180")} />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <ClipboardList size={20} className="text-primary" />
              <h1 className="text-xl font-black text-primary">{t("requests_section_title")}</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{t("requests_page_desc")}</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <WarehouseRequestsSection
            centrals={centrals}
            warehouseNameById={warehouseNameById}
            canManage={canManageWarehouses}
            t={t}
            locale={locale}
          />
        )}
      </div>
    </PortalLayout>
  )
}
