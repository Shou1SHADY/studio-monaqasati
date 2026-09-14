"use client"

import { MfgPage } from "@/components/manufacturing/MfgPage"

/** The module lands on Today — every role's first page (PRD D1, TD-03). */
export default function SupplierManufacturingPage() {
  return <MfgPage portal="supplier" tab="today" />
}
