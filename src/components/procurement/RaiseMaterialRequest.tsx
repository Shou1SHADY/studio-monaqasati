"use client"

// «طلب مواد» for every member (Procurement 1.5, PUR-10, question 4): the button that opens the team
// request form, wherever the member happens to be — his tasks, his requests page. Only a company
// WITHOUT Project Management has it; with it, materials are requested from the project. The page of
// «طلباتي» names it «طلب مواد جديد» (Procurement 2.0); the short name stays in «الواردة» and «مهامي».

import { useState } from "react"
import { useTranslations } from "next-intl"
import { PackagePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useModules } from "@/hooks/useCompanyModules"
import { TeamRequestDialog } from "@/components/procurement/TeamRequestDialog"
import { cn } from "@/lib/utils"

export function RaiseMaterialRequest({ orgId, onSent, variant = "outline", className, fullName = false }: { orgId: string; onSent?: (number: string) => void; variant?: "outline" | "default"; className?: string; fullName?: boolean }) {
  const t = useTranslations("Portal.Shared")
  const { on, loading } = useModules()
  const [open, setOpen] = useState(false)
  if (loading || on("project-management") || !orgId) return null
  return (
    <>
      <Button type="button" variant={variant} className={cn("gap-1.5", className)} onClick={() => setOpen(true)}>
        <PackagePlus size={15} aria-hidden="true" />
        {fullName ? t("tr_open_new") : t("tr_open")}
      </Button>
      <TeamRequestDialog open={open} onOpenChange={setOpen} orgId={orgId} onSent={onSent} />
    </>
  )
}
