"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { HrShell } from "@/components/hr/HrShell"
import { HrTodayView } from "@/components/hr/HrTodayView"
import { HrLetterQueue } from "@/components/hr/HrLetters"

export default function HrTodayPage() {
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="today">
        {(access) => (
          <div className="space-y-6">
            {/* EM-08 — letters waiting for this viewer's signature, until Today lists them itself. */}
            <HrLetterQueue access={access} portal="supplier" />
            <HrTodayView access={access} portal="supplier" />
          </div>
        )}
      </HrShell>
    </PortalLayout>
  )
}
