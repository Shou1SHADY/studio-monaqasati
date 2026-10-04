"use client"

// «دليل موردي المنصة» (PRD 3.0 §7.2, prototype vSup:dir) — every supplier on
// the Mdmak platform, verified by the platform and not necessarily ours. Search
// and the two selects filter in place; each option says how many suppliers it
// holds, so a choice that would empty the table is visible before it is made.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Eye, Search, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { cn } from "@/lib/utils"
import { displayCategory, displayCity } from "@/lib/constants"
import { directoryCounts, directoryFiltered, filterDirectory, type DirectoryFilter } from "@/lib/procurement/supplier-file"
import type { PlatformSupplier } from "@/hooks/useSupplierDirectory"
import { Stars } from "./SupplierFileDrawer"

const SELECT = "h-10 rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function SupplierDirectory({ suppliers, onOpen }: { suppliers: PlatformSupplier[]; onOpen: (orgId: string) => void }) {
  const t = useTranslations("Portal.ProcSuppliers")
  const locale = useLocale()
  const [f, setF] = useState<DirectoryFilter>({ q: "", category: "", city: "" })
  const counts = useMemo(() => directoryCounts(suppliers), [suppliers])
  const rows = useMemo(() => filterDirectory(suppliers, f, (c) => displayCategory(c, locale)), [suppliers, f, locale])
  const yearOf = (day: string | null) => (day ? day.slice(0, 4) : "—")

  return (
    <div className="space-y-3">
      <Callout tone="info">{t("dir.info")}</Callout>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={t("dir.search")} aria-label={t("dir.search")} className="ps-9" />
        </div>
        <select aria-label={t("dir.all_categories")} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={cn(SELECT, f.category && "border-module text-module")}>
          <option value="">{t("dir.all_categories")}</option>
          {counts.categories.map(([c, n]) => (
            <option key={c} value={c}>
              {`${displayCategory(c, locale)} · ${n}`}
            </option>
          ))}
        </select>
        <select aria-label={t("dir.all_cities")} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} className={cn(SELECT, f.city && "border-module text-module")}>
          <option value="">{t("dir.all_cities")}</option>
          {counts.cities.map(([c, n]) => (
            <option key={c} value={c}>
              {`${displayCity(c, locale)} · ${n}`}
            </option>
          ))}
        </select>
        {directoryFiltered(f) && (
          <Button variant="ghost" size="sm" onClick={() => setF({ q: "", category: "", city: "" })}>
            {t("dir.clear")}
          </Button>
        )}
        <span className="ms-auto text-xs text-muted-foreground">{t("dir.count", { shown: rows.length, total: suppliers.length })}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Users} title={t("dir.empty_title")} description={t("dir.empty_desc")} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 text-start font-semibold">{t("col.supplier")}</th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">{t("col.supplies")}</th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">{t("col.city")}</th>
                <th scope="col" className="px-4 py-3 text-end font-semibold">{t("col.contractor_rating")}</th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">{t("dir.open_file")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((s) => (
                <tr key={s.orgId} className="cursor-pointer hover:bg-muted/40" onClick={() => onOpen(s.orgId)}>
                  <td className="px-4 py-3 align-middle">
                    <p className="font-bold text-foreground" dir="auto">
                      {s.name}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {s.platformVerified && <StatusPill tone="module" className="px-2 py-0 text-[10.5px]">{t("badge.mdmak_verified")}</StatusPill>}
                      {s.international && <StatusPill tone="info" className="px-2 py-0 text-[10.5px]">{t("badge.international")}</StatusPill>}
                      <span>{t("dir.since", { year: yearOf(s.since) })}</span>
                    </p>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex flex-wrap gap-1">
                      {s.categories.length ? (
                        s.categories.map((c) => (
                          <StatusPill key={c} tone="mute">
                            {displayCategory(c, locale)}
                          </StatusPill>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">{s.city ? displayCity(s.city, locale) : "—"}</td>
                  <td className="px-4 py-3 text-end align-middle">
                    {s.rating ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Stars value={s.rating.avg} />
                        <b className="tabular-nums" dir="ltr">
                          {s.rating.avg.toFixed(1)}
                        </b>
                        <span className="text-xs text-muted-foreground">({s.rating.n})</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("dir.no_ratings")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end align-middle">
                    <span className="inline-flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpen(s.orgId)
                        }}
                      >
                        <Eye size={14} aria-hidden="true" />
                        {t("dir.open_file")}
                      </Button>
                      {s.isMine && <StatusPill tone="ok">{t("dir.in_ours")}</StatusPill>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
