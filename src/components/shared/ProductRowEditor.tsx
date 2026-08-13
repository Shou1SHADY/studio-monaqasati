"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { CATEGORIES_DATA, SUBCATEGORY_UNIT_MAP, displayCategory, displaySubcategory } from "@/lib/constants"
import { Trash2, Plus, ShieldCheck } from "lucide-react"

export interface ProductRow {
  id: string
  quantity: string
  unit: string
  description: string
  category: string
  subCategory: string
  otherSubCategory?: string
  requiresWarranty?: boolean
}

export function makeEmptyProductRow(id: string): ProductRow {
  return { id, quantity: "", unit: "", description: "", category: "", subCategory: "", requiresWarranty: false }
}

function RequiredStar() {
  return <span className="text-destructive me-1">*</span>
}

interface ProductRowEditorProps {
  rows: ProductRow[]
  onChange: (rows: ProductRow[]) => void
  locale: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  /** Fired after any field on a row changes — parents can use this to clear their own validation errors. */
  onFieldTouched?: (id: string, field: keyof ProductRow) => void
}

export function ProductRowEditor({ rows, onChange, locale, t, onFieldTouched }: ProductRowEditorProps) {
  const addRow = () => onChange([...rows, makeEmptyProductRow(Date.now().toString())])

  const removeRow = (id: string) => {
    if (rows.length > 1) onChange(rows.filter((r) => r.id !== id))
  }

  const updateRow = (id: string, field: keyof ProductRow, value: string | boolean) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
    onFieldTouched?.(id, field)
  }

  return (
    <div>
      <div className="space-y-4">
        {rows.map((row, index) => (
          <div key={row.id} className="p-6 bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold">
                  {index + 1}
                </div>
                <span className="text-base font-bold text-slate-700">{t("newrfq_product_label")}</span>
              </div>
              {rows.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(row.id)}
                  className="text-red-500 hover:bg-red-50 hover:text-red-600 h-8 px-3 rounded-lg cursor-pointer transition-colors"
                >
                  <Trash2 size={16} />
                  <span className="mr-1 text-xs">{t("newrfq_delete_label")}</span>
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-600">
                  {t("newrfq_main_category")}<RequiredStar />
                </Label>
                <SearchableSelect
                  value={row.category}
                  onChange={(v) => {
                    onChange(rows.map((r) => (r.id === row.id ? { ...r, category: v, subCategory: "" } : r)))
                    onFieldTouched?.(row.id, "category")
                  }}
                  options={Object.keys(CATEGORIES_DATA).map((cat) => ({ value: cat, label: displayCategory(cat, locale) }))}
                  placeholder={t("newrfq_select_category")}
                  searchPlaceholder={t("newrfq_search_category")}
                  noResultsText={t("newrfq_no_results")}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-600">
                  {t("newrfq_sub_category")}<RequiredStar />
                </Label>
                <SearchableSelect
                  value={row.subCategory}
                  onChange={(v) => {
                    const autoUnit = SUBCATEGORY_UNIT_MAP[v]
                    onChange(rows.map((r) => (r.id === row.id ? { ...r, subCategory: v, ...(autoUnit ? { unit: autoUnit } : {}) } : r)))
                    onFieldTouched?.(row.id, "subCategory")
                  }}
                  options={[
                    ...(row.category && CATEGORIES_DATA[row.category]
                      ? CATEGORIES_DATA[row.category].map((sub) => ({ value: sub, label: displaySubcategory(sub, locale) }))
                      : []),
                    { value: "أخرى", label: t("newrfq_other_category") },
                  ]}
                  placeholder={t("newrfq_select_sub_category")}
                  searchPlaceholder={t("newrfq_search_sub_category")}
                  noResultsText={t("newrfq_no_results")}
                  disabled={!row.category}
                />
                {row.subCategory === "أخرى" && (
                  <Input
                    placeholder={t("newrfq_other_category_placeholder")}
                    value={row.otherSubCategory || ""}
                    onChange={(e) => updateRow(row.id, "otherSubCategory", e.target.value)}
                    className="h-11 rounded-xl border-slate-200 mt-2"
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-600">
                  {t("newrfq_quantity")}<RequiredStar />
                </Label>
                <Input
                  type="number"
                  placeholder="0"
                  value={row.quantity}
                  onChange={(e) => updateRow(row.id, "quantity", e.target.value)}
                  className="h-11 rounded-xl border-slate-200"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-600">
                  {t("newrfq_unit_of_measure")}<RequiredStar />
                </Label>
                <Input
                  placeholder={t("newrfq_unit_placeholder")}
                  value={row.unit}
                  onChange={(e) => updateRow(row.id, "unit", e.target.value)}
                  className="h-11 rounded-xl border-slate-200"
                />
              </div>
            </div>
            <div className="mt-5">
              <Label className="text-xs font-semibold text-slate-600">{t("newrfq_specifications")}</Label>
              <Textarea
                placeholder={t("newrfq_spec_placeholder")}
                rows={2}
                value={row.description}
                onChange={(e) => updateRow(row.id, "description", e.target.value)}
                className="mt-2 rounded-xl border-slate-200 resize-none"
              />
            </div>
            <div className="mt-4 flex items-center gap-2.5">
              <Switch
                checked={!!row.requiresWarranty}
                onCheckedChange={(checked) => updateRow(row.id, "requiresWarranty", checked)}
              />
              <Label
                className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 cursor-pointer"
                onClick={() => updateRow(row.id, "requiresWarranty", !row.requiresWarranty)}
              >
                <ShieldCheck size={14} className="text-amber-600" />
                {t("newrfq_requires_warranty")}
              </Label>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex justify-center">
        <Button variant="outline" size="sm" onClick={addRow} className="gap-2 border-slate-300 bg-white hover:bg-primary hover:text-white hover:border-primary rounded-xl h-11 px-8 cursor-pointer transition-all shadow-sm">
          <Plus size={18} />
          {t("newrfq_add_product")}
        </Button>
      </div>
    </div>
  )
}
