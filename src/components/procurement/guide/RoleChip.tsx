"use client"

import { useTranslations } from "next-intl"
import type { RoleId } from "@/lib/procurement/guide"
import { cn } from "@/lib/utils"

// Tailwind reads class names whole, so every role's literal classes are written out here.
export const ROLE_STYLE: Record<RoleId, { chip: string; solid: string; top: string; soft: string }> = {
  req: { chip: "bg-role-requester-light text-role-requester-ink", solid: "bg-role-requester", top: "border-t-role-requester", soft: "bg-role-requester-light text-role-requester-ink" },
  pm: { chip: "bg-role-pm-light text-role-pm-ink", solid: "bg-role-pm", top: "border-t-role-pm", soft: "bg-role-pm-light text-role-pm-ink" },
  buy: { chip: "bg-role-buyer-light text-role-buyer-ink", solid: "bg-role-buyer", top: "border-t-role-buyer", soft: "bg-role-buyer-light text-role-buyer-ink" },
  app: { chip: "bg-role-approver-light text-role-approver-ink", solid: "bg-role-approver", top: "border-t-role-approver", soft: "bg-role-approver-light text-role-approver-ink" },
  sup: { chip: "bg-role-supplier-light text-role-supplier-ink", solid: "bg-role-supplier", top: "border-t-role-supplier", soft: "bg-role-supplier-light text-role-supplier-ink" },
  rcv: { chip: "bg-role-receiver-light text-role-receiver-ink", solid: "bg-role-receiver", top: "border-t-role-receiver", soft: "bg-role-receiver-light text-role-receiver-ink" },
  inv: { chip: "bg-role-storekeeper-light text-role-storekeeper-ink", solid: "bg-role-storekeeper", top: "border-t-role-storekeeper", soft: "bg-role-storekeeper-light text-role-storekeeper-ink" },
  fin: { chip: "bg-role-finance-light text-role-finance-ink", solid: "bg-role-finance", top: "border-t-role-finance", soft: "bg-role-finance-light text-role-finance-ink" },
  mfg: { chip: "bg-role-workshop-light text-role-workshop-ink", solid: "bg-role-workshop", top: "border-t-role-workshop", soft: "bg-role-workshop-light text-role-workshop-ink" },
}

export function RoleChip({ role, className }: { role: RoleId; className?: string }) {
  const t = useTranslations("Portal.ProcGuide.role")
  return (
    <span data-role={role} className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold", ROLE_STYLE[role].chip, className)}>
      {t(role)}
    </span>
  )
}
