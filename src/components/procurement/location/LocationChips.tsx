"use client"

// «موقع التسليم» as chips (Procurement 2.0, ED-03): one press picks the place, like «الأكثر طلباً». A place another group
// of the same request already uses is disabled with its hint, and «+ موقع جديد» opens the dialog that adds one and picks it.

import { useTranslations } from "next-intl"
import { MapPin, Plus, Warehouse, Wrench } from "lucide-react"
import { Chip } from "@/components/module-ui/Chip"
import { siteChips, type DeliverySite } from "@/lib/procurement/delivery-sites"
import { cn } from "@/lib/utils"

const ICON = { site: MapPin, project: MapPin, warehouse: Warehouse, workshop: Wrench } as const

export function LocationChips({
  sites,
  selectedId,
  usedByOtherGroups,
  onPick,
  onNew,
  label,
  className,
}: {
  sites: DeliverySite[]
  selectedId: string | null
  /** Places the request's other groups already use. */
  usedByOtherGroups?: Iterable<string>
  onPick: (site: DeliverySite) => void
  /** Present = the «+ موقع جديد» chip is shown. */
  onNew?: () => void
  label?: string
  className?: string
}) {
  const t = useTranslations("Portal.ProcEditor")
  const chips = siteChips(sites, { usedByOtherGroups, selectedId })
  return (
    <div role="group" aria-label={label ?? t("loc_label")} className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {chips.map(({ site, selected, disabled }) => (
        <Chip
          key={site.id}
          selected={selected}
          icon={ICON[site.kind]}
          disabled={disabled}
          title={disabled ? t("loc_in_other") : undefined}
          onClick={() => !selected && onPick(site)}
          className="max-w-full"
        >
          <span className="truncate" dir="auto">
            {site.name}
          </span>
          {disabled && <span className="sr-only">{t("loc_in_other")}</span>}
        </Chip>
      ))}
      {onNew && (
        <Chip selected={false} icon={Plus} onClick={onNew} className="border-dashed text-module">
          {t("loc_new")}
        </Chip>
      )}
    </div>
  )
}
