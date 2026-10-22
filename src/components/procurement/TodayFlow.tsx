"use client"

// The route strip (TDY-01): واردة جديدة · في عروض · في أوامر · في الطريق · اكتملت — each with its count and its sub-line, each
// opening its own page. The orders' value says what it includes (G-18).

import { useTranslations } from "next-intl"
import { Link } from "@/i18n/routing"
import { sarLtr } from "@/lib/riyal"
import type { FlowTile } from "@/lib/procurement/today"

export function TodayFlow({ tiles }: { tiles: FlowTile[] }) {
  const t = useTranslations("Portal.ProcToday")
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label={t("flow.label")} data-testid="today-flow">
      {tiles.map((tile) => (
        <li key={tile.id} className="min-w-0">
          <Link
            href={tile.href}
            className="block h-full rounded-2xl border bg-card p-3.5 shadow-sm transition-colors hover:border-module/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <p className="text-xs font-semibold text-muted-foreground">{t(`flow.${tile.id}.label`)}</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-foreground" dir="ltr">
              {tile.count.toLocaleString("en-US")}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-muted-foreground" dir="auto">
              {t(tile.subKey, { amount: tile.amount == null ? "" : sarLtr(tile.amount.toLocaleString("en-US", { maximumFractionDigits: 1 })) })}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
