"use client"

import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Link } from "@/i18n/routing"
import { useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { doc } from "firebase/firestore"
import { Warehouse, ArrowRight, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { WarehouseInventoryPanel } from "@/components/contractor/WarehouseInventoryPanel"

type WarehouseDoc = {
  id: string
  name: string
  location: string
  description?: string
  isCentral?: boolean
}

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

  const warehouseRef = useMemoFirebase(() => {
    if (!firestore || !warehouseId) return null
    return doc(firestore, "warehouses", warehouseId)
  }, [firestore, warehouseId])
  const { data: warehouse } = useDoc(warehouseRef)
  const wh = warehouse as WarehouseDoc | null

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div className="flex items-center gap-3">
          <Link href="/contractor/warehouses" className="text-muted-foreground hover:text-primary transition-colors">
            <ArrowRight size={18} className={cn(isRtl ? "" : "rotate-180")} />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Warehouse size={20} className="text-primary" />
              <h1 className="text-xl font-black text-primary">{wh?.name ?? t("wh_page_title")}</h1>
              {wh?.isCentral && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black text-accent bg-accent/10 border border-accent/30 rounded-full px-2 py-0.5">
                  <Star size={10} />
                  {t("wh_central_badge")}
                </span>
              )}
            </div>
          </div>
        </div>
        <WarehouseInventoryPanel warehouseId={warehouseId} orgId={myOrgId} variant="embedded" />
      </div>
    </PortalLayout>
  )
}
