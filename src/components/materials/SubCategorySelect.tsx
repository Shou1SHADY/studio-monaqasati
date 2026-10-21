"use client"

// One sub-category of the material tree, picked by search (PUR-04): the same list every other
// picker reads. Used where a record carries a single category (an inventory item).

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { subOptions } from "@/lib/materials/subs"

export function SubCategorySelect({ value, onChange, disabled, id, className }: { value: string; onChange: (id: string) => void; disabled?: boolean; id?: string; className?: string }) {
  const t = useTranslations("Portal.Materials")
  const locale = useLocale()
  const { index } = useMaterialTree()
  const options = useMemo(() => subOptions(index, locale).map((o) => ({ value: o.value, label: o.label.includes(" › ") ? o.label.slice(o.label.indexOf(" › ") + 3) : o.label, group: o.root, keywords: o.label })), [index, locale])
  return (
    <SearchableSelect
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={index ? t("sub_pick") : t("loading")}
      searchPlaceholder={t("subs_search")}
      noResultsText={t("no_match")}
      disabled={disabled || !index}
      ariaLabel={t("sub_optional")}
      className={className}
    />
  )
}
