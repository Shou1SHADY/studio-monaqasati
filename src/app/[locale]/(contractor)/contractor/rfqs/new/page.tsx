"use client"

import { RfqForm } from "@/components/contractor/RfqForm"

// Standalone RFQ creation — no project required. For a quick, non-competitive price request
// (e.g. a small job needing just one material) where creating a full project is overkill.
export default function NewStandaloneRfqPage() {
  return <RfqForm />
}
