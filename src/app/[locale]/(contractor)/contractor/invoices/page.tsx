"use client"

import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Receipt, Sparkles } from "lucide-react"

export default function ContractorInvoicesPage() {
  const t = useTranslations("Portal.Contractor")
  const tShared = useTranslations("Portal.Shared")
  const isRtl = useLocale() === "ar"

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div>
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <Receipt size={22} />
            {t("inv_page_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("inv_page_desc")}</p>
        </div>

        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center border border-dashed rounded-2xl bg-slate-50/50">
          <div className="h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center">
            <Sparkles size={24} className="text-amber-500" />
          </div>
          <div>
            <p className="font-bold text-lg text-foreground">{t("inv_coming_soon_title")}</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t("inv_coming_soon_desc")}</p>
          </div>
          <span className="text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full mt-1">
            {tShared("sec_ghost_badge")}
          </span>
        </div>
      </div>
    </PortalLayout>
  )
}
