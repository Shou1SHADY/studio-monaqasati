"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { HrPayrollView } from "@/components/hr/HrPayrollView"
import { HrShell } from "@/components/hr/HrShell"

export default function HrPayrollPage() {
  return (
    <PortalLayout>
      <HrShell portal="contractor" tab="payroll">
        {(access) => <HrPayrollView access={access} portal="contractor" />}
      </HrShell>
    </PortalLayout>
  )
}
