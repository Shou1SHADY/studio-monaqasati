"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { FinanceProjectsDesk } from "@/components/accounting/FinanceProjectsDesk"

export default function ContractorFinanceProjectsDeskPage() {
  return (
    <PortalLayout>
      <FinanceProjectsDesk portal="contractor" />
    </PortalLayout>
  )
}
