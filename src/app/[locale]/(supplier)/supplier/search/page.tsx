"use client"

import { useSearchParams } from "next/navigation"
import { PlanSwitch } from "@/components/supplier-free/PlanSwitch"
import { FreeSearch } from "@/components/supplier-free/FreeInbox"
import { useRouter } from "@/i18n/routing"
import { useEffect } from "react"
import { useSupplierPlan } from "@/hooks/useSupplierPlan"

function Content() {
  const params = useSearchParams()
  return <FreeSearch q={params.get("q") || ""} />
}

// The global search belongs to the free journey; the full portal has its own search and sends this address home.
function Home() {
  const router = useRouter()
  const { loading } = useSupplierPlan()
  useEffect(() => {
    if (!loading) router.replace("/supplier")
  }, [loading, router])
  return null
}

export default function Page() {
  return <PlanSwitch free={<Content />} full={<Home />} />
}
