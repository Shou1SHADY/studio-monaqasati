"use client"

import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { HrEmployeeFile } from "@/components/hr/HrEmployeeFile"
import { HrShell } from "@/components/hr/HrShell"
import { useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"

export default function HrEmployeeFilePage() {
  const t = useTranslations("Portal.HR")
  const { id } = useParams<{ id: string }>()
  const { user } = useUser()
  const { profile } = usePermissions()
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="people" title={t("file.title")} description={t("file.description")}>
        {(access) => <HrEmployeeFile access={access} portal="supplier" employeeId={id} actor={{ uid: user?.uid ?? "", name: (profile?.name as string) || null }} />}
      </HrShell>
    </PortalLayout>
  )
}
