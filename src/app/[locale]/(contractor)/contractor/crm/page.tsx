"use client"

import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Contact } from "lucide-react"

export default function ContractorCrmPage() {
  const t = useTranslations("Portal.Contractor")
  const isRtl = useLocale() === "ar"

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div>
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <Contact size={22} />
            {t("crm_page_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("crm_page_desc")}</p>
        </div>

        <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-4">
          <Contact size={48} className="text-muted-foreground/40" />
          <div>
            <p className="font-bold text-lg text-foreground">{t("crm_empty_title")}</p>
            <p className="text-muted-foreground text-sm mt-1">{t("crm_empty_desc")}</p>
          </div>
        </div>
      </div>
    </PortalLayout>
  )
}
