"use client"

// Small pieces every accounting screen shares. Kept out of AccountingViews so
// the screens in their own files can use them without importing each other.

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { BookOpen, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export function EmptyBooks() {
  const t = useTranslations("Portal.Shared")
  return (
    <div className="p-12 text-center text-muted-foreground border border-dashed rounded-xl">
      <BookOpen size={36} className="mx-auto mb-3 opacity-20" />
      <p className="text-sm font-semibold text-foreground">{t("acc_empty_title")}</p>
      <p className="text-xs mt-1 max-w-md mx-auto">{t("acc_empty_desc")}</p>
    </div>
  )
}

export function LoadingBooks() {
  return (
    <div className="flex items-center justify-center p-16">
      <Loader2 className="animate-spin text-muted-foreground" size={28} />
    </div>
  )
}

export function Kpi({
  label,
  value,
  hint,
  tone = "default",
  footer,
}: {
  label: string
  value: string
  hint?: string
  tone?: "default" | "good" | "warn" | "bad"
  footer?: ReactNode
}) {
  return (
    <div className="p-4 rounded-xl border bg-white">
      <p className="text-xs text-muted-foreground font-semibold">{label}</p>
      <p
        className={cn(
          "text-xl font-black mt-1 tabular-nums",
          tone === "good" && "text-success",
          tone === "warn" && "text-warning",
          tone === "bad" && "text-destructive"
        )}
        dir="ltr"
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
      {footer}
    </div>
  )
}

export const SOURCE_LABEL_KEY: Record<string, string> = {
  opening: "acc_src_opening",
  ipc_claim: "acc_src_ipc_claim",
  ipc_collection: "acc_src_ipc_collection",
  sales_quotation: "acc_src_sales_quotation",
  sales_payment: "acc_src_sales_payment",
  sales_delivery: "acc_src_sales_delivery",
  sales_invoice: "acc_src_sales_invoice",
  sales_credit_note: "acc_src_sales_credit_note",
  purchase_invoice: "acc_src_purchase_invoice",
  supplier_payment: "acc_src_supplier_payment",
  goods_receipt: "acc_src_goods_receipt",
  material_issue: "acc_src_material_issue",
  waste: "acc_src_waste",
  work_order_issue: "acc_src_work_order_issue",
  work_order_delivery: "acc_src_work_order_delivery",
  mfg_material_receipt: "acc_src_mfg_material_receipt",
  mfg_scrap: "acc_src_mfg_scrap",
  mfg_remnant_receipt: "acc_src_mfg_remnant_receipt",
  payroll: "acc_src_payroll",
  payroll_payment: "acc_src_payroll_payment",
  expense: "acc_src_expense",
  depreciation: "acc_src_depreciation",
  guarantee_margin: "acc_src_guarantee_margin",
  guarantee_release: "acc_src_guarantee_release",
  retention_release: "acc_src_retention_release",
  vat_settlement: "acc_src_vat_settlement",
  zakat_provision: "acc_src_zakat_provision",
  zakat_payment: "acc_src_zakat_payment",
  wht_remittance: "acc_src_wht_remittance",
  wip_revenue: "acc_src_wip_revenue",
  manual_voucher: "acc_src_manual_voucher",
  settlement: "acc_src_settlement",
}

