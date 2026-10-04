"use client"

// «مورّدونا» — one row per supplier we work with (PRD 3.0 §7.2). The record
// columns are computed from our own orders and receipts, never typed; the
// status column names the first thing that would stop an order: an expired CR,
// a missing VAT number, a CR about to end.

import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { displayCategory, displayCity } from "@/lib/constants"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import type { PlatformSupplier } from "@/hooks/useSupplierDirectory"
import type { SupplierScore } from "@/lib/procurement/po"
import { effectiveCrExpiry, effectiveVat, profileVatMark, supplierDocs, type DocsState } from "@/lib/procurement/supplier-file"
import { useDateText } from "./PoBits"

export type SupplierRow = PlatformSupplier & { score: SupplierScore; open: number }

const DOCS_TONE: Record<DocsState, PillTone> = { ok: "ok", cr_expired: "bad", no_vat: "warn", cr_ending: "warn" }

export function OurSuppliersTable({ rows, today, onOpen }: { rows: SupplierRow[]; today: string; onOpen: (orgId: string) => void }) {
  const t = useTranslations("Portal.ProcSuppliers")
  const locale = useLocale()
  const fmt = useDateText()
  const sep = locale === "ar" ? "، " : ", "
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 text-start font-semibold">{t("col.supplier")}</th>
            <th scope="col" className="px-4 py-3 text-start font-semibold">{t("col.supplies")}</th>
            <th scope="col" className="px-4 py-3 text-end font-semibold">{t("col.on_time")}</th>
            <th scope="col" className="px-4 py-3 text-end font-semibold">{t("col.rejected")}</th>
            <th scope="col" className="px-4 py-3 text-start font-semibold">{t("col.status")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((s) => {
            const kind = s.record?.kind || "mat"
            const docs = supplierDocs(effectiveVat(s.record, profileVatMark(s)), effectiveCrExpiry(s.record, s.profileCrExpiry), today)
            const onTime = s.score.onTimePercent
            return (
              <tr key={s.orgId} className="cursor-pointer hover:bg-muted/40" onClick={() => onOpen(s.orgId)}>
                <td className="px-4 py-3 align-middle">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(s.orgId)
                    }}
                    className="rounded text-start font-bold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    dir="auto"
                  >
                    {s.isFavorite && <span className="me-1 text-warning" aria-hidden="true">★</span>}
                    {s.name}
                  </button>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                    <span>{t(`kind.${kind}`)}</span>
                    {s.city && <span>· {displayCity(s.city, locale)}</span>}
                    <span>·</span>
                    <StatusPill tone="module" className="px-2 py-0 text-[10.5px]">{t("badge.platform")}</StatusPill>
                    {s.international && <StatusPill tone="info" className="px-2 py-0 text-[10.5px]">{t("badge.international")}</StatusPill>}
                    {s.record?.source === "guest_link" && <StatusPill tone="mute" className="px-2 py-0 text-[10.5px]">{t("badge.guest_link")}</StatusPill>}
                    {s.record?.verified === false && <StatusPill tone="warn" className="px-2 py-0 text-[10.5px]">{t("badge.unverified")}</StatusPill>}
                  </p>
                </td>
                <td className="px-4 py-3 align-middle text-foreground">
                  {kind === "sub" ? (
                    <StatusPill tone="info">{t("badge.contract_in_pm")}</StatusPill>
                  ) : s.categories.length ? (
                    <span className="line-clamp-2">{s.categories.map((c) => displayCategory(c, locale)).join(sep)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-end align-middle">
                  {onTime == null ? (
                    <span className="text-xs text-muted-foreground">{t("no_record")}</span>
                  ) : (
                    <>
                      <b className={cn("tabular-nums", onTime < 80 ? "text-destructive" : onTime < 90 ? "text-warning" : "text-success")} dir="ltr">
                        {onTime}%
                      </b>
                      <p className="text-[11px] text-muted-foreground">{t("of_orders", { count: s.score.orders })}</p>
                    </>
                  )}
                </td>
                <td className="px-4 py-3 text-end align-middle tabular-nums" dir="ltr">
                  {s.score.orders && s.score.rejectPercent != null ? `${s.score.rejectPercent}%` : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-3 align-middle">
                  <div className="flex flex-col items-start gap-1">
                    <StatusPill tone={DOCS_TONE[docs.state]}>
                      {docs.state === "cr_ending" ? t("docs.cr_ending", { date: fmt(docs.crExpiry) }) : t(`docs.${docs.state}`)}
                    </StatusPill>
                    {s.open > 0 && <span className="text-[11px] text-muted-foreground">{t("open_orders", { count: s.open })}</span>}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
