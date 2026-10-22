"use client"

// The list's filters with their counts and its sort (RFQ-06): الكل · كاملة · جزئية · القائمة القصيرة · يلتزم بشروطك · من خارج
// المنصة · مستبعدة — a filter nobody matches is not shown — and «رتّب».

import { useTranslations } from "next-intl"
import { Chip } from "@/components/module-ui/Chip"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { OFFER_SORTS, visibleFilters, type OfferFilter, type OfferSort } from "@/lib/procurement/rfq-offers-view"

export function RfqOfferFilters({ counts, filter, onFilter, sort, onSort }: { counts: Record<OfferFilter, number>; filter: OfferFilter; onFilter: (f: OfferFilter) => void; sort: OfferSort; onSort: (s: OfferSort) => void }) {
  const t = useTranslations("Portal.Procurement.rfqpage")
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("filters.aria")}>
        {visibleFilters(counts, filter).map((f) => (
          <Chip key={f} selected={filter === f} count={counts[f]} onClick={() => onFilter(f)}>
            {t(`filters.${f}`)}
          </Chip>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        {t("sort.label")}
        <NativeSelect value={sort} onChange={(e) => onSort(e.target.value as OfferSort)} className="h-9 text-xs">
          {OFFER_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`sort.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </label>
    </div>
  )
}
