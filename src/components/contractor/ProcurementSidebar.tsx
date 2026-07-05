"use client"

import { useState, useMemo, useEffect } from "react"
import { useTranslations, useLocale } from "next-intl"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { collection, query, orderBy } from "firebase/firestore"
import {
  ChevronRight,
  ChevronLeft,
  Search,
  Plus,
  Loader2,
  Package,
} from "lucide-react"

type Material = {
  id: string
  name: string
  nameEn?: string
  unit: string
  refPrice: number
  totalQtyUsed?: number
  category?: string
}

interface ProcurementSidebarProps {
  onAddMaterial: (material: { name: string; unit: string; refPrice: number }) => void
}

export function ProcurementSidebar({ onAddMaterial }: ProcurementSidebarProps) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()

  const [open, setOpen] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("")

  // Starts collapsed on narrow screens — at full width (w-64) this sidebar leaves almost no
  // room for the BOQ table next to it on a phone-sized viewport.
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) setOpen(false)
  }, [])

  const materialsQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return query(collection(firestore, "procurementMaterials"), orderBy("name"))
  }, [firestore])

  const { data: rawMaterials, isLoading } = useCollection(materialsQuery)
  const materials = (rawMaterials || []) as Material[]

  const categories = useMemo(() => {
    const cats = new Set(materials.map((m) => m.category).filter(Boolean))
    return Array.from(cats) as string[]
  }, [materials])

  const filtered = useMemo(() => {
    return materials.filter((m) => {
      const matchesSearch =
        !search ||
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        (m.nameEn || "").toLowerCase().includes(search.toLowerCase())
      const matchesCat = !selectedCategory || m.category === selectedCategory
      return matchesSearch && matchesCat
    })
  }, [materials, search, selectedCategory])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex-shrink-0 flex flex-col items-center justify-center gap-2 w-10 bg-slate-50 border border-slate-200 rounded-xl text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all py-6",
          isRtl ? "border-r-2" : "border-l-2"
        )}
        aria-label={t("procurement_toggle")}
      >
        {isRtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ writingMode: "vertical-rl", transform: isRtl ? "rotate(180deg)" : undefined }}
        >
          {t("procurement_toggle")}
        </span>
      </button>
    )
  }

  return (
    <div
      className={cn(
        "flex-shrink-0 w-64 flex flex-col bg-slate-50 border border-slate-200 rounded-xl overflow-hidden",
        isRtl ? "border-r-2 border-r-primary/20" : "border-l-2 border-l-primary/20"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-1.5">
          <Package size={15} className="text-primary" />
          <span className="text-xs font-bold text-slate-700">{t("procurement_sidebar_title")}</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-slate-700 transition-colors"
          aria-label="Close"
        >
          {isRtl ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-slate-100">
        <div className="relative">
          <Search size={13} className={cn("absolute top-1/2 -translate-y-1/2 text-muted-foreground", isRtl ? "right-2.5" : "left-2.5")} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("procurement_search")}
            className={cn("h-8 text-xs rounded-lg bg-white", isRtl ? "pr-7" : "pl-7")}
          />
        </div>
      </div>

      {/* Category filter */}
      {categories.length > 0 && (
        <div className="px-2 py-1.5 border-b border-slate-100 flex gap-1 flex-wrap">
          <button
            onClick={() => setSelectedCategory("")}
            className={cn(
              "text-[11px] px-2 py-0.5 rounded-full border font-medium transition-colors",
              !selectedCategory
                ? "bg-primary text-white border-primary"
                : "border-slate-200 text-muted-foreground hover:border-slate-300"
            )}
          >
            {t("procurement_all_categories")}
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat === selectedCategory ? "" : cat)}
              className={cn(
                "text-[11px] px-2 py-0.5 rounded-full border font-medium transition-colors",
                selectedCategory === cat
                  ? "bg-primary text-white border-primary"
                  : "border-slate-200 text-muted-foreground hover:border-slate-300"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Materials list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center gap-2">
            <Package size={28} className="text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">{t("procurement_no_materials")}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((material) => (
              <div
                key={material.id}
                className="px-3 py-2.5 hover:bg-white transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800 truncate leading-snug">
                      {material.name}
                    </p>
                    {material.nameEn && locale === "en" && (
                      <p className="text-[10px] text-muted-foreground truncate">{material.nameEn}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {material.refPrice > 0 && (
                        <span className="text-[11px] font-bold text-primary">
                          {material.refPrice.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")} {t("offers_currency_sar")}
                        </span>
                      )}
                      {material.unit && (
                        <span className="text-[10px] text-muted-foreground">/ {material.unit}</span>
                      )}
                    </div>
                    {material.totalQtyUsed != null && material.totalQtyUsed > 0 && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {t("procurement_qty_used")}: {material.totalQtyUsed.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")} {material.unit}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onAddMaterial({ name: material.name, unit: material.unit, refPrice: material.refPrice })}
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 h-6 w-6 flex items-center justify-center rounded-full bg-primary text-white hover:bg-primary/80"
                    aria-label={t("procurement_add_to_boq")}
                    title={t("procurement_add_to_boq")}
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Column headers */}
      <div className="border-t border-slate-200 px-3 py-2 bg-slate-100">
        <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
          <span>{t("procurement_material_name")}</span>
          <span className={isRtl ? "text-left" : "text-right"}>{t("procurement_ref_price")}</span>
        </div>
      </div>
    </div>
  )
}
