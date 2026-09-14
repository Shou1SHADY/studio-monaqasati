"use client"

import { MfgPage } from "@/components/manufacturing/MfgPage"

/** The module lands on Today — every role's first page (PRD D1, TD-03). */
export default function ContractorManufacturingPage() {
  return <MfgPage portal="contractor" tab="today" />
}
