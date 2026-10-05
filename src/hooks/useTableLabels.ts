"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import type { DataTableLabels } from "@/components/module-ui/DataTable"

/** The words every DataTable needs, in the reader's language. */
export function useTableLabels(): DataTableLabels {
  const t = useTranslations("Portal.Shared")
  return useMemo(() => ({ sortBy: (column: string) => t("table_sort_by", { column }), showMore: (count: number) => t("table_show_more", { count }) }), [t])
}
