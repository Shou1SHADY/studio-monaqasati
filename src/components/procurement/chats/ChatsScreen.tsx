"use client"

import { useTranslations } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { ChatsPage } from "./ChatsPage"

/** «محادثاتي» inside the contractor portal: the Procurement head (its counts keep the sidebar's chat counter current) and the list. */
export function ChatsScreen() {
  const t = useTranslations("Portal.ProcChats")
  return (
    <PortalLayout>
      <div className="space-y-6">
        <ProcurementHeader title={t("title")} description={t("desc")} />
        <ChatsPage />
      </div>
    </PortalLayout>
  )
}
